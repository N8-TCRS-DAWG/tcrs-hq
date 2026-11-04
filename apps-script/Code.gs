/**
 * TCRS HQ — Gmail sync (QuickBooks payments + 9am/9pm inbox sweep)
 *
 * PART 1 — QuickBooks payments
 * Runs in nathan@tcremodelingsupply.com's Google account.
 * Every 10 minutes it finds QuickBooks "Payment received" emails and sends
 * them to HQ. HQ matches each one to a customer (or puts it in the review
 * tray) and ignores any it has already seen, so re-sending is harmless.
 * It only reads payment emails; it never changes, labels or deletes email.
 *
 * PART 2 — Inbox sweep (9am and 9pm Central)
 * Sends each recently active thread to HQ. Claude updates or creates the lead's file.
 * For a brand-new lead's first email, HQ returns the first reply (intake questions):
 * it is saved as a Gmail draft, or sent, depending on HQ → Prices & partners → Settings.
 * Setup: run installAll once (or sweepFirstRun to also catch up on the last 14 days).
 */
var HQ_INGEST_URL = 'https://sgucoasieddiorebvlrx.supabase.co/functions/v1/hq-ingest';
var QUERY = 'from:quickbooks@notification.intuit.com subject:"Payment received"';

/** Run once by hand: catches up on the last 180 days. */
function backfill() { syncPayments_('newer_than:180d'); }

/** Run once by hand: turns on the 10-minute schedule. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(10).create();
}

/** Scheduled: looks at the last 3 days each run. */
function sync() { syncPayments_('newer_than:3d'); }

function syncPayments_(window) {
  var threads = GmailApp.search(QUERY + ' ' + window, 0, 200);
  var messages = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (!/^payment received/i.test(m.getSubject())) return;
      messages.push({
        id: m.getId(),
        subject: m.getSubject(),
        date: m.getDate().toISOString(),
        body: m.getPlainBody().slice(0, 20000)
      });
    });
  });
  if (!messages.length) { Logger.log('No QuickBooks payment emails in ' + window); return; }
  var res = UrlFetchApp.fetch(HQ_INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Google-Id-Token': ScriptApp.getIdentityToken() },
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() >= 300) throw new Error('HQ said: ' + res.getContentText());
}

/* ───────────────────────── PART 2: inbox sweep ───────────────────────── */
var HQ_SWEEP_URL = 'https://sgucoasieddiorebvlrx.supabase.co/functions/v1/hq-sweep';
var SWEEP_QUERY = '-in:spam -in:trash -in:drafts -in:chats -category:promotions -category:social -category:forums ' +
  '-from:quickbooks@notification.intuit.com -from:(noreply OR no-reply OR donotreply OR do-not-reply OR mailer-daemon OR notifications)';

/** Run once by hand: payments every 10 minutes + inbox sweep at 9am and 9pm. */
function installAll() {
  installTrigger();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sweep') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sweep').timeBased().atHour(9).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('sweep').timeBased().atHour(21).nearMinute(0).everyDays(1).create();
}

/** Run once by hand (optional): catch up on the last 14 days. First replies are NOT made for old threads. */
function sweepFirstRun() { sweep_(14, true); }

/** Scheduled 9am / 9pm. Covers everything since the last run (1-hour overlap; HQ ignores repeats). */
function sweep() { sweep_(0, false); }

function sweep_(daysBack, noReplies) {
  var props = PropertiesService.getUserProperties();
  var started = Date.now();
  var since = daysBack ? started / 1000 - daysBack * 86400 : (Number(props.getProperty('lastSweep')) || started / 1000 - 2 * 86400) - 3600;
  var threads = GmailApp.search(SWEEP_QUERY + ' after:' + Math.floor(since), 0, 150);
  var stats = { threads: threads.length, created: 0, updated: 0, ignored: 0, seen: 0, drafts: 0, sent: 0, errors: 0, names: [] };
  var token = ScriptApp.getIdentityToken();
  for (var i = 0; i < threads.length; i += 5) {
    if (Date.now() - started > 4.5 * 60 * 1000) { stats.partial = true; break; }   // Apps Script stops at 6 min
    var batch = threads.slice(i, i + 5);
    var reqs = batch.map(function (th) {
      return { url: HQ_SWEEP_URL, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'X-Google-Id-Token': token }, payload: JSON.stringify({ thread: pack_(th), noReply: !!noReplies }) };
    });
    UrlFetchApp.fetchAll(reqs).forEach(function (r, k) {
      var out = {};
      try { out = JSON.parse(r.getContentText()); } catch (e) {}
      if (r.getResponseCode() >= 300) { stats.errors++; Logger.log('HQ error: ' + r.getContentText()); return; }
      if (out.action && stats[out.action] != null) stats[out.action]++;
      if (out.action === 'created') stats.names.push(out.customer);
      if (out.reply && out.reply.body && !noReplies) {
        if (out.reply.mode === 'send') { batch[k].reply(out.reply.body); stats.sent++; }
        else { batch[k].createDraftReply(out.reply.body); stats.drafts++; }
      }
    });
  }
  if (!stats.partial) props.setProperty('lastSweep', String(Math.floor(started / 1000)));
  Logger.log(JSON.stringify(stats));
  UrlFetchApp.fetch(HQ_SWEEP_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Google-Id-Token': token }, payload: JSON.stringify({ summary: stats }) });
}

function pack_(th) {
  var msgs = th.getMessages().slice(-6);   // last 6 messages: new ones + context
  return {
    id: th.getId(),
    subject: th.getFirstMessageSubject(),
    messages: msgs.map(function (m) {
      return {
        mid: m.getHeader('Message-ID') || m.getId(),
        gid: m.getId(),
        from: m.getFrom(), to: m.getTo(), cc: m.getCc(),
        date: m.getDate().toISOString(),
        body: m.getPlainBody().slice(0, 8000),
        attachments: m.getAttachments({ includeInlineImages: false }).slice(0, 10).map(function (a) { return a.getName(); })
      };
    })
  };
}
