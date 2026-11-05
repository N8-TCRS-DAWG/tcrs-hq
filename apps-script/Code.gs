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
    payload: JSON.stringify({ idToken: ScriptApp.getIdentityToken(), messages: messages }),
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

/** service@ only: inbox sweep at 9am and 9pm, no QuickBooks payments. */
function installSweepOnly() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sweep').timeBased().atHour(9).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('sweep').timeBased().atHour(21).nearMinute(0).everyDays(1).create();
}

/** Run by hand to check setup: shows the account, permissions and schedules. */
function checkSetup() {
  var t = ScriptApp.getIdentityToken();
  Logger.log('Account: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Identity token: ' + (t ? 'OK (' + t.length + ' chars)' : 'MISSING'));
  Logger.log('Schedules: ' + ScriptApp.getProjectTriggers().map(function (x) { return x.getHandlerFunction(); }).join(', '));
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
  var stats = { threads: threads.length, created: 0, updated: 0, ignored: 0, seen: 0, drafts: 0, sent: 0, errors: 0, files: 0, bigFiles: 0, names: [] };
  var token = ScriptApp.getIdentityToken();
  for (var i = 0; i < threads.length; i += 5) {
    if (Date.now() - started > 4.5 * 60 * 1000) { stats.partial = true; break; }   // Apps Script stops at 6 min
    var batch = threads.slice(i, i + 5);
    var msgSets = batch.map(function (th) { return th.getMessages().slice(-6); });   // last 6 messages: new ones + context
    var reqs = batch.map(function (th, k) {
      return { url: HQ_SWEEP_URL, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'X-Google-Id-Token': token }, payload: JSON.stringify({ idToken: token, thread: pack_(th, msgSets[k]), noReply: !!noReplies }) };
    });
    UrlFetchApp.fetchAll(reqs).forEach(function (r, k) {
      var out = {};
      try { out = JSON.parse(r.getContentText()); } catch (e) {}
      if (r.getResponseCode() >= 300) { stats.errors++; Logger.log('HQ error: ' + r.getContentText()); return; }
      if (out.action && stats[out.action] != null) stats[out.action]++;
      if (out.action === 'created') stats.names.push(out.customer);
      if (out.cid && out.want && out.want.length && Date.now() - started < 4.5 * 60 * 1000) uploadFiles_(out.cid, out.want, msgSets[k], batch[k].getFirstMessageSubject(), token, stats);
      if (out.reply && out.reply.body && !noReplies) {
        if (out.reply.mode === 'send') { batch[k].reply(out.reply.body); stats.sent++; }
        else { batch[k].createDraftReply(out.reply.body); stats.drafts++; }
      }
    });
  }
  if (Date.now() - started < 4.5 * 60 * 1000) {   // retry a few files Claude couldn't read last time
    try { UrlFetchApp.fetch(HQ_SWEEP_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: token, reread: 3 }) }); } catch (e) {}
  }
  if (!stats.partial) props.setProperty('lastSweep', String(Math.floor(started / 1000)));
  Logger.log(JSON.stringify(stats));
  UrlFetchApp.fetch(HQ_SWEEP_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Google-Id-Token': token }, payload: JSON.stringify({ idToken: token, summary: stats }) });
}

/** Run by hand: Claude re-reads saved files (PDFs, photos) it couldn't read the first time. */
function rereadFiles() {
  var token = ScriptApp.getIdentityToken(), started = Date.now(), left = 1;
  while (left && Date.now() - started < 4.5 * 60 * 1000) {
    var r = UrlFetchApp.fetch(HQ_SWEEP_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: token, reread: 4 }) });
    var out = {}; try { out = JSON.parse(r.getContentText()); } catch (e) {}
    Logger.log(r.getResponseCode() + ' ' + r.getContentText());
    if (r.getResponseCode() >= 300 || out.left == null) break;
    left = out.left;
  }
}

function pack_(th, msgs) {
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
        files: m.getAttachments({ includeInlineImages: false }).slice(0, 10).map(function (a, i) {
          var size = a.getSize();
          var hash = size <= 25 * 1024 * 1024 ? hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, a.getBytes())) : a.getName() + ':' + size;
          return { i: i, name: a.getName(), size: size, type: a.getContentType(), hash: hash };
        })
      };
    })
  };
}

function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

/** Copies the attachments HQ asked for into the lead's Files tab (HQ reads PDFs and photos). */
function uploadFiles_(cid, want, msgs, subject, token, stats) {
  var reqs = [];
  want.forEach(function (w) {
    if (w.big) { stats.bigFiles++; return; }
    var m = msgs.filter(function (x) { return (x.getHeader('Message-ID') || x.getId()) === w.mid; })[0];
    var a = m && m.getAttachments({ includeInlineImages: false })[w.i];
    if (!a) return;
    reqs.push({ url: HQ_SWEEP_URL, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ idToken: token, upload: { cid: cid, name: a.getName(), type: a.getContentType(), hash: w.hash, from: m.getFrom(),
        date: m.getDate().toISOString(), subject: subject, b64: Utilities.base64Encode(a.getBytes()) } }) });
  });
  for (var i = 0; i < reqs.length; i += 3) {
    UrlFetchApp.fetchAll(reqs.slice(i, i + 3)).forEach(function (r) {
      if (r.getResponseCode() < 300 && /"stored":true/.test(r.getContentText())) stats.files++;
      else if (r.getResponseCode() >= 300) Logger.log('File error: ' + r.getContentText());
    });
  }
}
