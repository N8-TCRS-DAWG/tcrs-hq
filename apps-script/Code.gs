/**
 * TCRS HQ — QuickBooks payments sync
 * Runs in nathan@tcremodelingsupply.com's Google account.
 * Every 10 minutes it finds QuickBooks "Payment received" emails and sends
 * them to HQ. HQ matches each one to a customer (or puts it in the review
 * tray) and ignores any it has already seen, so re-sending is harmless.
 * It only reads; it never changes, labels or deletes email.
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
