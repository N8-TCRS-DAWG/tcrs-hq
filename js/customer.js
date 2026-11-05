// One customer, everything in one place.
import * as D from './data.js?v=20261104182925';
import {
  S, STAGES, PRODUCTS, SERVICES, CTYPES, FTYPES, WHOSE, esc, $, $$, n, money, money0, status, score, stageIdx,
  openActions, custActions, custFiles, custLogs, custSizes, custQuote, quoteCalc, revisionInfo, gateMissing, fmtDate,
  todayISO, addDays, daysBetween, toast, canWrite, logEvent, patchCustomer, STATUS_TEXT, settings, referralLines, personName, pendingSaves,
} from './core.js?v=20261104182925';
import { openDrop } from './drop.js?v=20261104182925';
import { renderLayout } from './layout.js?v=20261104182925';
import { renderQuote, learnFromQuote } from './quote.js?v=20261104182925';

let curId = null;
let tab = 'overview';
let sheet = null;
export const currentCustomerId = () => curId;

export async function openCustomer(id) {
  let c = S.customers.find((x) => x.id === id);
  if (!c) {
    try { S.customers = await D.all('customers'); S.actions = await D.all('actions'); S.logs = await D.all('logs'); } catch {}
    c = S.customers.find((x) => x.id === id);
  }
  if (!c) { toast('That customer was not found.'); location.hash = 'board'; return; }
  if (curId !== id) tab = 'overview';
  curId = id;
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'sheet-bg';
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeCustomer(); });
    document.body.appendChild(sheet);
    document.addEventListener('keydown', escClose);
  }
  draw();
}
async function saveAndClose() {
  const btn = $('#cSave', sheet); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const a = document.activeElement;
  if (a && sheet?.contains(a) && a.blur) a.blur();
  const note = $('#lSum', sheet)?.value.trim();
  if (note && curId) await logEvent(curId, $('#lKind', sheet)?.value || 'note', note).catch(() => {});
  await new Promise((r) => setTimeout(r, 30));
  const res = await Promise.allSettled([...pendingSaves]);
  const bad = res.find((r) => r.status === 'rejected');
  if (bad) { toast('Not saved: ' + (bad.reason?.message || bad.reason)); if (btn) { btn.disabled = false; btn.textContent = 'Save & close'; } return; }
  closeCustomer(); toast('Saved.');
}

/* Delete a lead for good (duplicates, junk, mis-reads). Snapshot first so Undo can put everything back for 8 s. */
const CHILD = ['logs', 'actions', 'files', 'sizes', 'layouts', 'quotes'];
function deleteLead(c) {
  const kids = Object.fromEntries(CHILD.map((t) => [t, (S[t] || []).filter((r) => r.customer_id === c.id)]));
  const pays = (S.payments || []).filter((p) => p.customer_id === c.id);
  const counts = [['logs', 'history line'], ['actions', 'step'], ['files', 'file'], ['layouts', 'layout'], ['quotes', 'quote']].filter(([t]) => kids[t].length).map(([t, l]) => `${kids[t].length} ${l}${kids[t].length === 1 ? '' : 's'}`);
  modal(`<h2>Delete ${esc(c.name || 'this lead')}?</h2>`,
    `<p>This removes the lead${counts.length ? ` and its ${esc(counts.join(', '))}` : ''}. ${pays.length ? `${pays.length} QuickBooks payment${pays.length > 1 ? 's go' : ' goes'} back to the review tray. ` : ''}Use <b>Mark lost</b> instead if it was a real lead you lost.</p>
     ${c.email || c.phone ? `<label class="small row"><input type="checkbox" id="dBlock" checked> Don't let the inbox read re-create it from ${esc(c.email || c.phone)}</label>` : ''}
     <div class="row" style="margin-top:12px"><button class="btn danger" type="button" id="dOk">Delete lead</button><button class="btn" type="button" id="dNo">Cancel</button></div>`,
    (box, close) => {
      $('#dNo', box).onclick = close;
      $('#dOk', box).onclick = async () => {
        const block = $('#dBlock', box)?.checked;
        const snap = { ...c }; delete snap.updated_at;
        close(); closeCustomer();
        try {
          for (const p of pays) await D.update('payments', p.id, { customer_id: null, status: 'review', match_note: 'lead deleted' });
          await D.remove('customers', c.id);
        } catch (e) { toast('Could not delete: ' + e.message); return; }
        let undone = false;
        const finish = async () => {
          if (undone) return;
          await D.removeFiles(kids.files.map((f) => f.path)).catch(() => {});
          if (block) {
            const row = S.settings.find((r) => r.id === 'sweep');
            const blocked = [...(row?.data?.blocked || []), { email: c.email || null, phone: c.phone || null, name: c.name || null, at: new Date().toISOString() }].slice(-200);
            await D.upsert('settings', { id: 'sweep', data: { ...(row?.data || {}), blocked } }).catch(() => {});
          }
        };
        const t = setTimeout(finish, 8000);
        toast(`Deleted ${c.name || 'lead'}.`, async () => {
          undone = true; clearTimeout(t);
          try {
            await D.insert('customers', snap);
            for (const tb of CHILD) for (const r of kids[tb]) await D.insert(tb, r).catch(() => {});
            for (const p of pays) await D.update('payments', p.id, { customer_id: c.id, status: p.status, match_note: p.match_note }).catch(() => {});
            toast(`${c.name || 'Lead'} restored.`);
          } catch (e) { toast('Undo failed: ' + e.message); }
        });
      };
    });
}

function escClose(e) { if (e.key === 'Escape' && sheet && !document.querySelector('.sheet-bg.top-modal')) closeCustomer(); }
export function closeCustomer(silent) {
  const a = document.activeElement;
  if (a && sheet?.contains(a) && a.blur) a.blur();   // fires "change" → the last edit saves
  sheet?.remove(); sheet = null; curId = null;
  document.removeEventListener('keydown', escClose);
  if (!silent && location.hash.startsWith('#c-')) location.hash = 'board';
}
export function refreshCustomer() { if (sheet && curId) draw(); }

function draw() {
  const c = S.customers.find((x) => x.id === curId);
  if (!c) return closeCustomer();
  const scrollY = sheet.scrollTop;
  const st = status(c);
  const si = stageIdx(c.stage);
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(c.name)}">
    <div class="sheet-h">
      <h2>${esc(c.name || 'No name yet')}</h2>
      <span class="pill st-${st.k}"><span class="dot"></span>${esc(STATUS_TEXT[st.k])}</span>
      <span class="small muted">${c.first_contact ? `First contact ${fmtDate(c.first_contact)} · ${daysBetween(c.first_contact, todayISO()) === 0 ? 'new today' : daysBetween(c.first_contact, todayISO()) + ' days in'}` : ''}</span>
      <span class="qc">${c.phone ? `<a class="chip pick" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}" title="Call">📞 ${esc(c.phone)}</a><button class="chip pick" type="button" data-copy="${esc(c.phone)}" title="Copy phone">Copy</button>` : ''}${c.email ? `<a class="chip pick" href="mailto:${esc(c.email)}" title="Email">✉ ${esc(c.email)}</a><button class="chip pick" type="button" data-copy="${esc(c.email)}" title="Copy email">Copy</button>` : ''}</span>
      ${canWrite() ? `<button class="btn sm" type="button" id="cDrop" title="Add files, emails or notes to this customer (D)">⬆ Drop into ${esc((c.name || 'this customer').split(' ')[0])}</button>` : ''}
      <span class="navpn"><button class="btn ghost sm" type="button" id="cPrev" title="Previous customer (←)" aria-label="Previous customer">‹</button><button class="btn ghost sm" type="button" id="cNext" title="Next customer (→)" aria-label="Next customer">›</button></span>
      <button class="x" type="button" aria-label="Close" id="cClose" title="Close (Esc)">×</button>
    </div>
    <div class="sheet-b">
      <div class="lbl" style="margin-bottom:-8px">Stage · click a step to move the job</div>
      <nav class="stepper" aria-label="Stage">${STAGES.map((s, i) => `<button type="button" class="step ${i < si ? 'done' : i === si ? 'cur' : ''}" data-stage="${s.k}" ${canWrite() ? '' : 'disabled'}><span class="b">${i < si ? '✓' : i + 1}</span><span class="s">${esc(s.short)}</span></button>`).join('')}</nav>
      ${nextCard(c, st)}
      <div class="tabs" role="tablist">${tabSubs(c).map(([k, l, sub]) => `<button type="button" role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}"><span>${l}</span><span class="ts">${esc(sub)}</span></button>`).join('')}</div>
      <div id="tabBody"></div>
    </div>
    ${canWrite() ? `<div class="sheet-f"><span class="small muted" id="saveState">Changes save as you go.</span><button class="btn primary" type="button" id="cSave">Save &amp; close</button></div>` : ''}</div>`;
  $('#cClose', sheet).onclick = () => closeCustomer();
  $('#cSave', sheet)?.addEventListener('click', saveAndClose);
  sheet.addEventListener('input', (e) => { if (e.target.closest('.sheet') && !e.target.closest('#addLog')) { const ss = $('#saveState', sheet); if (ss) { ss.textContent = 'Unsaved edit. Click Save & close (or click out of the box).'; ss.classList.add('dirty'); } } });
  $$('[data-copy]', sheet).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); } catch { toast('Copy blocked by the browser.'); } }));
  const order = boardOrder();
  const ix = order.indexOf(c.id);
  const go = (d) => { if (order.length > 1) location.hash = 'c-' + order[(ix + d + order.length) % order.length]; };
  $('#cPrev', sheet).onclick = () => go(-1);
  $('#cNext', sheet).onclick = () => go(1);
  sheet.onkeydown = (e) => { const a = document.activeElement; if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return; if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  $('#cDrop', sheet)?.addEventListener('click', () => openDrop({ customerId: c.id }));
  $$('.step', sheet).forEach((b) => (b.onclick = () => { if (b.dataset.stage !== c.stage) moveStage(c, b.dataset.stage); }));
  $$('[data-tab]', sheet).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
  wireNext(c);
  const body = $('#tabBody', sheet);
  if (tab === 'overview') overview(body, c);
  else if (tab === 'files') filesTab(body, c);
  else if (tab === 'layout') renderLayout(body, c);
  else if (tab === 'quote') renderQuote(body, c);
  else if (tab === 'money') moneyTab(body, c);
  sheet.scrollTop = scrollY;
}

function tabSubs(c) {
  const files = custFiles(c.id).length, sizes = custSizes(c.id).length;
  const lay = S.layouts.filter((l) => l.customer_id === c.id).sort((a, b) => b.version - a.version)[0];
  const rv = revisionInfo(c);
  const q = custQuote(c.id);
  const t = q ? quoteCalc(q, c) : null;
  const got = Number(c.paid?.amount) || 0;
  const nextDate = [['Measure', c.measure_date], ['Delivery', c.delivery_date], ['Install', c.install_date]].filter(([, d]) => d && d >= todayISO()).sort((a, b) => a[1].localeCompare(b[1]))[0];
  return [
    ['overview', 'Overview', 'Summary · contact · history'],
    ['files', 'Files & sizes', `${files} file${files === 1 ? '' : 's'} · ${sizes} size${sizes === 1 ? '' : 's'}`],
    ['layout', 'Layout', lay ? `v${lay.version} · rev ${rv.used}/${rv.allowed}` : 'Upload or draw'],
    ['quote', 'Estimate → Quote', q ? `${q.mode === 'quote' ? 'Quote' : 'Estimate'} ${q.status} · ${money0(t.total)}` : 'Not started'],
    ['money', 'Money & dates', `${got ? 'Paid ' + money0(got) : c.data?.paidUnknown ? 'Paid: amount?' : 'Nothing paid'}${nextDate ? ' · ' + nextDate[0] + ' ' + fmtDate(nextDate[1]) : ''}`],
  ];
}

const STEP_IDEAS = {
  new: ['Send intake form', 'Call to qualify the project', 'Book a measure visit'],
  intake: ['Get photos + wall lengths', 'Book a measure visit', 'Get finish / style choices'],
  estimate: ['Send estimate', 'Follow up on estimate', 'Send $250 design deposit agreement'],
  design: ['Measure + verify sizes', 'Draw layout', 'Send layout + rendering', 'Get supplier quote'],
  quote: ['Send final quote', 'Follow up on quote'],
  accepted: ['Collect payment', 'Order from supplier'],
  ordered: ['Confirm delivery date', 'Schedule installation', 'Remove old cabinets'],
  installed: ['Punch-list walk-through', 'Send final invoice', 'Ask for a review'],
  paid: ['Ask for a review', 'Ask for referrals'],
};
const WAITS = { 'Get supplier quote': 'supplier', 'Confirm delivery date': 'supplier' };
function boardOrder() {
  return [...S.customers].filter((x) => !x.lost).sort((a, b) => stageIdx(a.stage) - stageIdx(b.stage) || (a.first_contact || '').localeCompare(b.first_contact || '')).map((x) => x.id);
}
function intakeText() {
  const d = S.docs.find((x) => /intake questions/i.test(x.title));
  return d?.body || STARTER_INTAKE;
}
const STARTER_INTAKE = "Thanks for reaching out! Answer what you can below and I'll get you a quote as soon as possible.\n1) Full name\n2) Phone number\n3) Email\n4) Project address (city + ZIP is fine for now)\n5) Products needed (cabinets, countertops, flooring, appliances, other)\n6) Services needed (delivery, installation, design/layout, removal of old materials)\n7) Project description + dimensions\n8) Finish or style preferences (color, door style, material), if you know them\n9) Budget range\n10) Timeline\n11) Current condition of the space (occupied home, gutting/remodel, new construction)\n12) How did you hear about us?\nPlease also send photos of the space and any layouts, drawings or measurements you have.";

/* ───────── Next card: the one thing that matters ───────── */
function nextCard(c, st) {
  const acts = openActions(c.id);
  const t = todayISO();
  const head = st.k === 'red' ? (acts.length ? 'Your move' : 'No next step — add one') : st.k === 'yellow' ? 'Waiting on a partner' : st.k === 'green' ? 'Waiting on the customer' : 'Done';
  const rv = revisionInfo(c);
  return `<section class="nextcard st-${st.k}">
    <div class="row"><h3>${head}</h3>${rv.due ? `<span class="pill st-red">Revision fee due: ${money0(rv.dueAmount)}</span>` : ''}${c.status_override ? '<span class="chip">Color set by hand</span>' : ''}</div>
    ${acts.map((a) => `<div class="act ${a.due && a.due < t ? 'late' : ''}" data-aid="${a.id}">
      <input type="checkbox" class="done" aria-label="Done: ${esc(a.title)}" ${canWrite() ? '' : 'disabled'}>
      <span class="title">${esc(a.title)}</span>
      <span class="whose" role="group" aria-label="Whose move">${WHOSE.map((w) => `<button type="button" data-w="${w.k}" class="${a.waiting_on === w.k ? 'on ' + w.k : ''}">${w.label}</button>`).join('')}</span>
      <input type="date" class="due" value="${a.due || ''}" aria-label="Due date">
      <button class="btn ghost sm del" type="button" aria-label="Delete step">×</button>
    </div>`).join('')}
    ${canWrite() ? `<form class="row" id="addAct">
      <input type="text" id="aTitle" class="grow" style="flex-basis:260px" placeholder="Add the next step, e.g. Send intake form" required>
      <span class="whose" id="aWhose">${WHOSE.map((w, i) => `<button type="button" data-w="${w.k}" class="${i === 0 ? 'on us' : ''}">${w.label}</button>`).join('')}</span>
      <input type="date" id="aDue" value="${addDays(todayISO(), 1)}" aria-label="Due date">
      <button class="btn primary" type="submit">Add step</button>
    </form>
    <div class="row ideas"><span class="small muted">Common next steps:</span>${(STEP_IDEAS[c.stage] || STEP_IDEAS.new).filter((t) => !acts.some((a) => a.title === t)).map((t) => `<button type="button" class="chip pick" data-idea="${esc(t)}">${esc(t)}</button>`).join('')}${['new', 'intake'].includes(c.stage) ? '<button type="button" class="chip pick" id="cpIntake" title="Copy the 12 intake questions to paste into an email or text">📋 Copy intake questions</button>' : ''}</div>` : ''}
  </section>`;
}
function wireNext(c) {
  $$('.act', sheet).forEach((el) => {
    const a = S.actions.find((x) => x.id === el.dataset.aid);
    $('.done', el).onchange = async () => {
      await D.update('actions', a.id, { done: true, done_at: new Date().toISOString() });
      toast('Step done. What\'s next?', () => D.update('actions', a.id, { done: false, done_at: null }));
      logEvent(c.id, 'system', `Done: ${a.title}`);
      setTimeout(() => $('#aTitle', sheet)?.focus(), 400);
    };
    $$('.whose button', el).forEach((b) => (b.onclick = () => D.update('actions', a.id, { waiting_on: b.dataset.w })));
    $('.due', el).onchange = (e) => D.update('actions', a.id, { due: e.target.value || null });
    $('.del', el).onclick = async () => { await D.remove('actions', a.id); toast('Step deleted.', () => D.insert('actions', a)); };
  });
  const f = $('#addAct', sheet);
  if (f) {
    let w = 'us';
    const pickW = (k) => { w = k; $$('#aWhose button', sheet).forEach((x) => (x.className = x.dataset.w === k ? 'on ' + k : '')); };
    $$('#aWhose button', sheet).forEach((b) => (b.onclick = () => pickW(b.dataset.w)));
    $$('[data-idea]', sheet).forEach((b) => (b.onclick = () => { const i = $('#aTitle', sheet); i.value = b.dataset.idea; pickW(WAITS[b.dataset.idea] || 'us'); i.focus(); }));
    $('#cpIntake', sheet)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(intakeText()); toast('Intake questions copied. Paste into your email or text.'); } catch { toast('Copy blocked by the browser. Find them under Help & SOPs.'); } });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const title = $('#aTitle', sheet).value.trim();
      if (!title) return;
      await D.insert('actions', { customer_id: c.id, title, due: $('#aDue', sheet).value || null, waiting_on: w, done: false, owner: S.me?.id });
    };
  }
}

/* ───────── stage moves (any order) ───────── */
export function moveStage(c, to) {
  if (!canWrite() || c.stage === to) return;
  // Any order is fine: projects are circuitous. Missing items are a reminder, never a block.
  const miss = gateMissing(c, to);
  const from = c.stage;
  const patch = { stage: to };
  if (to === 'paid' && !c.paid?.at && c.paid?.amount) patch.paid = { ...c.paid, at: c.paid.at || new Date().toISOString() };
  patchCustomer(c, patch).then(() => {
    logEvent(c.id, 'system', `Moved ${STAGES[stageIdx(from)].label} → ${STAGES[stageIdx(to)].label}`, miss.length ? 'Not on file yet: ' + miss.join('; ') : null);
    if (to === 'paid') { const q = custQuote(c.id); if (q) learnFromQuote(q, c, true); }
    toast(`Moved to ${STAGES[stageIdx(to)].label}.${miss.length ? ' Not on file yet: ' + miss.slice(0, 2).join('; ') + (miss.length > 2 ? '…' : '') : ''}`, () => patchCustomer(c, { stage: from }));
  });
}

export function modal(head, bodyHtml, wire, narrow = true) {
  const b = document.createElement('div');
  b.className = 'sheet-bg top-modal';
  b.style.zIndex = 60;
  b.innerHTML = `<div class="sheet ${narrow ? 'narrow' : ''}"><div class="sheet-h">${head}<button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-b">${bodyHtml}</div></div>`;
  const close = () => b.remove();
  b.querySelector('.x').onclick = close;
  b.addEventListener('click', (e) => { if (e.target === b) close(); });
  document.body.appendChild(b);
  wire?.(b, close);
  return b;
}

/* ───────── Overview ───────── */
function field(label, key, val, type = 'text', extra = '') {
  return `<label class="field"><span class="lbl">${label}</span><input type="${type}" data-f="${key}" value="${esc(val ?? '')}" ${extra} ${canWrite() ? '' : 'disabled'}></label>`;
}
function overview(el, c) {
  const sc = score(c);
  const rv = revisionInfo(c);
  const logs = custLogs(c.id);
  const ch = c.data?.changes || [];
  el.innerHTML = `${c.data?.needsReview || ch.length ? `<section class="panel autocheck">
      <div class="row"><h3 class="grow">🤖 Check what email added</h3><button class="btn sm primary" type="button" id="acOk">Looks right</button></div>
      ${c.data?.needsReview ? `<p class="small">Claude made this lead from ${esc(c.data?.auto?.src || 'email')} and wasn't fully sure. Check the name, contact info and products.</p>` : ''}
      ${ch.map((x, i) => `<div class="row small" style="gap:8px"><span><b>${esc(x.field.replace('_', ' '))}</b>: on file "${esc(x.old)}", email says "${esc(x.new)}"</span>${['phone', 'email', 'address'].includes(x.field) ? `<button class="btn sm" type="button" data-use="${i}">Use new</button>` : '<span class="muted">(updated)</span>'}</div>`).join('')}
    </section>` : ''}<div class="two">
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
      <section class="panel">
        <div class="row"><h3 class="grow">TL;DR</h3><span class="small muted">Claude updates this on every drop. Edit freely.</span></div>
        <textarea id="tldr" rows="4" placeholder="Short summary of the project and where it stands" ${canWrite() ? '' : 'disabled'}>${esc(c.tldr || '')}</textarea>
        <label class="field" style="margin-top:8px"><span class="lbl">Finishes / style chosen</span><input type="text" data-d="finishes" value="${esc(c.data?.finishes || '')}" placeholder="e.g. Naval B7 bases, Pebble uppers, Calacatta Laza quartz"></label>
      </section>
      <section class="panel">
        <div class="row"><h3 class="grow">History</h3></div>
        ${canWrite() ? `<form class="row" id="addLog" style="margin:6px 0 4px">
          <select id="lKind" aria-label="Type"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="text">Text</option><option value="visit">Site visit</option></select>
          <input type="text" id="lSum" class="grow" placeholder="One line: what happened">
          <button class="btn" type="submit">Add</button></form>` : ''}
        <div class="log">${logs.map((l) => `<div class="e"><div><div class="k">${esc(l.kind)}</div><div class="w">${fmtDate(l.at)}</div></div><div>${esc(l.summary || '')}${personName(l.by) ? ` <span class="small muted">· ${esc(personName(l.by))}</span>` : ''}${l.body ? `<details><summary>Full text</summary><div class="small" style="white-space:pre-wrap">${esc(l.body)}</div></details>` : ''}</div></div>`).join('') || '<p class="small muted">Nothing yet.</p>'}</div>
      </section>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
      <section class="panel"><h3>Contact</h3><div class="fields" style="margin-top:8px">
        ${field('Name', 'name', c.name)}${field('Phone', 'phone', c.phone, 'tel')}${field('Email', 'email', c.email, 'email')}
        ${field('Address', 'address', c.address)}${field('City', 'city', c.city)}${field('ZIP', 'zip', c.zip)}
        ${field('Lead source', 'source', c.source, 'text', 'list="srcList"')}
        <label class="field"><span class="lbl">Customer type</span><select data-f="ctype"><option value="">—</option>${CTYPES.map((t) => `<option ${c.ctype === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        ${field('Budget ($)', 'budget', c.budget, 'text', 'inputmode="decimal"')}${field('Timeline', 'timeline', c.timeline)}
        ${field('First contact', 'first_contact', c.first_contact, 'date')}
      </div>
      <datalist id="srcList">${['Facebook', 'Facebook Marketplace', 'Nextdoor', 'Google', 'Website form', 'Referral', 'Repeat customer', 'Home show', 'Walk-in', 'Phone'].map((s) => `<option>${s}</option>`).join('')}</datalist>
      <div class="lbl" style="margin-top:10px">Products</div>
      <div class="row" style="margin-top:4px">${PRODUCTS.map((p) => `<button type="button" class="chip pick ${(c.products || []).includes(p) ? 'on' : ''}" data-prod="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="lbl" style="margin-top:10px">Services</div>
      <div class="row" style="margin-top:4px">${SERVICES.map((p) => `<button type="button" class="chip pick ${(c.services || []).includes(p) ? 'on' : ''}" data-serv="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </section>
      <section class="panel"><div class="row"><h3 class="grow">Lead score</h3><span class="score" style="font-size:18px">${sc.total}</span></div>
        <table class="simple" style="margin-top:6px">
          <tr><td>Feels likely to buy</td><td>${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="chip pick ${c.conversion === k ? 'on' : ''}" data-conv="${k}" aria-label="${k} of 5">${k}</button>`).join(' ')}${sc.convRated ? '' : ' <span class="small muted">not rated</span>'}</td><td class="n">${Math.round(sc.parts.conversion)}/${sc.w.conversion}</td></tr>
          <tr><td>Budget / job size</td><td class="small muted">${sc.budgetUsed ? money0(sc.budgetUsed) : 'unknown'}</td><td class="n">${Math.round(sc.parts.budget)}/${sc.w.budget}</td></tr>
          <tr><td>Repeat / reliable</td><td><label class="small"><input type="checkbox" id="rep" ${c.repeat ? 'checked' : ''}> Repeat customer</label>${sc.prior ? ' <span class="small muted">(paid before)</span>' : ''}</td><td class="n">${Math.round(sc.parts.repeat)}/${sc.w.repeat}</td></tr>
          <tr><td>Intake quality</td><td class="small">${[['photos', 'Photos'], ['layout', 'Layout'], ['dims', 'Sizes'], ['finishes', 'Finishes']].map(([k, l]) => `<span style="color:${sc.ip[k] ? 'var(--green)' : 'var(--muted)'}">${sc.ip[k] ? '✓' : '○'} ${l}</span>`).join(' · ')}</td><td class="n">${Math.round(sc.parts.intake)}/${sc.w.intake}</td></tr>
        </table>
      </section>
      <section class="panel"><h3>Layout revisions</h3>
        <div class="revbox ${rv.over ? 'over' : ''}" style="margin-top:6px">
          <span class="big">${rv.used}</span><span>of ${rv.allowed} included</span>
          ${canWrite() ? '<button class="btn sm" type="button" id="revMinus" aria-label="One fewer revision">−</button><button class="btn sm" type="button" id="revPlus">+1 revision</button>' : ''}
        </div>
        <label class="small row" style="margin-top:6px"><input type="checkbox" id="intakeAll" ${c.intake_complete ? 'checked' : ''}> All 12 intake questions answered (adds 1 free revision)</label>
        <p class="small muted" style="margin:6px 0 0">Design deposit terms v1.3: 2 revisions included, a 3rd if intake is complete, then ${money0(rv.fee)} each, paid before the revision. ${rv.over ? `<b style="color:var(--red)">${rv.over} over the limit${rv.due ? `, ${money0(rv.dueAmount)} not yet paid` : ', fees paid'}.</b>` : ''}</p>
      </section>
      <section class="panel"><h3>Card color</h3>
        <p class="small muted" style="margin:4px 0">Automatic from whose move each open step is. Override only if the steps don't tell the story.</p>
        <div class="row"><select id="ovr"><option value="">Automatic</option><option value="red" ${c.status_override === 'red' ? 'selected' : ''}>Red: we need to act</option><option value="yellow" ${c.status_override === 'yellow' ? 'selected' : ''}>Yellow: waiting on partner</option><option value="green" ${c.status_override === 'green' ? 'selected' : ''}>Green: waiting on customer</option></select>
        ${c.lost ? `<button class="btn" type="button" id="unlose">Reopen lead</button>` : `<button class="btn danger" type="button" id="lose">Mark lost…</button>`}${canWrite() ? `<button class="btn ghost danger-t" type="button" id="del" title="Delete for good: duplicates, junk, mis-read emails">Delete lead…</button>` : ''}</div>
      </section>
    </div></div>`;
  wireFields(el, c);
  $('#tldr', el)?.addEventListener('change', (e) => patchCustomer(c, { tldr: e.target.value }));
  $('#acOk', el)?.addEventListener('click', () => { const d = { ...(c.data || {}) }; delete d.needsReview; delete d.changes; patchCustomer(c, { data: d }); });
  $$('[data-use]', el).forEach((b) => (b.onclick = () => { const x = ch[Number(b.dataset.use)]; const d = { ...(c.data || {}), changes: ch.filter((_, i) => i !== Number(b.dataset.use)) }; patchCustomer(c, { [x.field]: x.new, data: d }); }));
  $$('[data-prod]', el).forEach((b) => (b.onclick = () => toggleArr(c, 'products', b.dataset.prod)));
  $$('[data-serv]', el).forEach((b) => (b.onclick = () => toggleArr(c, 'services', b.dataset.serv)));
  $$('[data-conv]', el).forEach((b) => (b.onclick = () => patchCustomer(c, { conversion: c.conversion === +b.dataset.conv ? null : +b.dataset.conv })));
  $('#rep', el).onchange = (e) => patchCustomer(c, { repeat: e.target.checked });
  $('#intakeAll', el).onchange = (e) => patchCustomer(c, { intake_complete: e.target.checked });
  $('#revPlus', el)?.addEventListener('click', () => bumpRevision(c, +1, 'Added by hand'));
  $('#revMinus', el)?.addEventListener('click', () => { if ((c.revisions || 0) > 0) bumpRevision(c, -1, 'Removed by hand'); });
  $('#ovr', el).onchange = (e) => patchCustomer(c, { status_override: e.target.value || null });
  $('#lose', el)?.addEventListener('click', () => modal('<h2>Mark lost</h2>', `<label class="field"><span class="lbl">Why?</span><select id="lr"><option>Price</option><option>Went with another company</option><option>Project cancelled / postponed</option><option>No response</option><option>Not a fit</option><option>Other</option></select></label><input type="text" id="ln" placeholder="Note (optional)"><button class="btn danger" type="button" id="lok">Mark lost</button>`,
    (box, close) => { $('#lok', box).onclick = async () => { const reason = $('#lr', box).value; await patchCustomer(c, { lost: { reason, note: $('#ln', box).value, at: new Date().toISOString() } }); logEvent(c.id, 'system', `Marked lost: ${reason}`); close(); }; }));
  $('#del', el)?.addEventListener('click', () => deleteLead(c));
  $('#unlose', el)?.addEventListener('click', async () => { await patchCustomer(c, { lost: null }); logEvent(c.id, 'system', 'Reopened'); });
  const lf = $('#addLog', el);
  if (lf) lf.onsubmit = async (e) => { e.preventDefault(); const s = $('#lSum', el).value.trim(); if (!s) return; await logEvent(c.id, $('#lKind', el).value, s); };
}

export async function bumpRevision(c, delta, why) {
  const nv = Math.max(0, (c.revisions || 0) + delta);
  await patchCustomer(c, { revisions: nv });
  await logEvent(c.id, 'system', `Layout revisions: ${nv}${why ? ` (${why})` : ''}`);
  const rv = revisionInfo(c);
  if (delta > 0 && rv.over && rv.due) {
    await D.insert('actions', { customer_id: c.id, title: `Collect ${money0(rv.fee)} revision fee before revision ${nv} (terms v1.3)`, due: todayISO(), waiting_on: 'us', done: false });
    toast(`Revision ${nv} is over the ${rv.allowed} included. A fee step was added.`);
  }
}

function toggleArr(c, key, v) {
  const arr = new Set(c[key] || []);
  arr.has(v) ? arr.delete(v) : arr.add(v);
  patchCustomer(c, { [key]: [...arr] });
}
function wireFields(el, c) {
  $$('[data-f]', el).forEach((inp) => (inp.onchange = () => {
    let v = inp.value.trim();
    if (inp.dataset.f === 'budget') v = n(v);
    if (inp.type === 'date') v = v || null;
    patchCustomer(c, { [inp.dataset.f]: v === '' ? null : v });
  }));
  $$('[data-d]', el).forEach((inp) => (inp.onchange = () => patchCustomer(c, { data: { ...(c.data || {}), [inp.dataset.d]: inp.value.trim() } })));
}

/* ───────── Files & sizes ───────── */
function filesTab(el, c) {
  const files = custFiles(c.id);
  const sizes = custSizes(c.id);
  const latest = {};
  files.forEach((f) => { if (!latest[f.ftype] || f.version > latest[f.ftype].version) latest[f.ftype] = f; });
  el.innerHTML = `<section class="panel"><div class="row"><h3 class="grow">Files</h3>${canWrite() ? '<button class="btn primary" type="button" id="fAdd">⬆ Add files</button>' : ''}</div>
    <p class="small muted" style="margin:4px 0 10px">Every drop lands here. Each type keeps version numbers; the newest of each type is marked ★ latest.</p>
    ${files.length ? `<div class="files">${files.map((f) => `<div class="file" data-fid="${f.id}">
      <a class="thumb" href="#" data-open="${f.id}" aria-label="Open ${esc(f.name)}">${(f.mime || '').startsWith('image/') ? `<img data-path="${esc(f.path)}" alt="">` : `<span class="lbl">${esc((f.name.split('.').pop() || 'file').toUpperCase())}</span>`}</a>
      <div class="cap"><b title="${esc(f.name)}">${esc(f.name)}</b>
        <span class="small">${esc(f.ftype)} v${f.version} ${latest[f.ftype]?.id === f.id ? '<span class="badge-latest">★ latest</span>' : ''}</span>
        <span class="small muted">${fmtDate(f.created_at)}${f.src ? ` · ${esc(f.src.includes('email') ? 'from email' : f.src)}` : ''}</span>
        ${f.summary ? `<span class="small fsum" title="${esc(f.summary)}">${esc(f.summary)}</span>` : ''}
        ${canWrite() ? `<select class="ftype" aria-label="File type">${FTYPES.map((t) => `<option ${t === f.ftype ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      </div></div>`).join('')}</div>` : '<div class="empty">No files yet. Drop photos, layouts, scans or supplier quotes.</div>'}
  </section>
  <section class="panel" style="margin-top:14px"><div class="row"><h3 class="grow">Sizes &amp; measurements</h3></div>
    <p class="small muted" style="margin:4px 0 8px">From drops, the layout grid, or typed here. These feed the estimate.</p>
    <div class="tbl-wrap"><table class="simple"><thead><tr><th>What</th><th>Value</th><th>Unit</th><th>Source</th><th></th></tr></thead><tbody>
    ${sizes.map((s) => `<tr data-sid="${s.id}"><td><input type="text" data-s="what" value="${esc(s.what)}"></td><td><input type="text" data-s="value" value="${esc(s.value ?? '')}" inputmode="decimal" style="width:90px"></td><td><input type="text" data-s="unit" value="${esc(s.unit || '')}" style="width:60px"></td><td class="small muted">${esc(s.source || '')}</td><td><button class="btn ghost sm" type="button" data-sdel aria-label="Delete">×</button></td></tr>`).join('')}
    ${canWrite() ? `<tr><td><input type="text" id="nsW" placeholder="e.g. Kitchen wall A"></td><td><input type="text" id="nsV" placeholder="162" inputmode="decimal" style="width:90px"></td><td><select id="nsU"><option>in</option><option>ft</option><option>lf</option><option>sf</option><option>ea</option></select></td><td class="small muted">tape</td><td><button class="btn sm" type="button" id="nsAdd">Add</button></td></tr>` : ''}
    </tbody></table></div>
  </section>`;
  $('#fAdd', el)?.addEventListener('click', () => openDrop({ customerId: c.id }));
  $$('img[data-path]', el).forEach(async (img) => { img.src = await D.fileUrl(img.dataset.path); });
  $$('[data-open]', el).forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    const f = files.find((x) => x.id === a.dataset.open);
    const u = await D.fileUrl(f.path);
    if (u) window.open(u, '_blank', 'noopener'); else toast('That file is not available here.');
  }));
  $$('.ftype', el).forEach((s) => (s.onchange = async () => {
    const f = files.find((x) => x.id === s.closest('.file').dataset.fid);
    const v = Math.max(0, ...files.filter((x) => x.ftype === s.value).map((x) => x.version)) + 1;
    await D.update('files', f.id, { ftype: s.value, version: v });
  }));
  $$('[data-sid]', el).forEach((tr) => {
    $$('[data-s]', tr).forEach((inp) => (inp.onchange = () => D.update('sizes', tr.dataset.sid, { [inp.dataset.s]: inp.dataset.s === 'value' ? n(inp.value) : inp.value })));
    $('[data-sdel]', tr).onclick = () => D.remove('sizes', tr.dataset.sid);
  });
  $('#nsAdd', el)?.addEventListener('click', async () => {
    const what = $('#nsW', el).value.trim(); if (!what) return toast('Name the measurement first.');
    await D.insert('sizes', { customer_id: c.id, what, value: n($('#nsV', el).value), unit: $('#nsU', el).value, source: 'tape' });
  });
}

/* ───────── Money & dates ───────── */
function moneyTab(el, c) {
  const st = settings();
  const q = custQuote(c.id);
  const t = q ? quoteCalc(q, c) : null;
  const dep = c.data?.deposit || {};
  const paid = c.paid || {};
  const rv = revisionInfo(c);
  const refs = q ? referralLines(q) : [];
  const pays = S.payments.filter((p) => p.customer_id === c.id && p.status === 'applied').sort((a, b) => (a.paid_date || '').localeCompare(b.paid_date || ''));
  const otherAmt = paid.other != null ? n(paid.other) : (paid.qb != null ? 0 : n(paid.amount));
  const owedTotal = t && t.price ? t.total : (c.est_price || 0);
  el.innerHTML = `<div class="two"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <section class="panel"><h3>Dates</h3><div class="fields" style="margin-top:8px">
      ${field('Measure / site visit', 'measure_date', c.measure_date, 'date')}${field('Delivery', 'delivery_date', c.delivery_date, 'date')}${field('Installation', 'install_date', c.install_date, 'date')}
    </div></section>
    <section class="panel"><h3>Design deposit (${money0(st.depositAmount)})</h3>
      <p class="small muted" style="margin:4px 0 8px">Non-refundable. Credited on the final quote if they sign within 60 days (terms v1.3).</p>
      <div class="fields">
        <label class="field"><span class="lbl">Amount</span><input type="text" id="dAmt" value="${esc(dep.amount ?? st.depositAmount)}" inputmode="decimal"></label>
        <label class="field"><span class="lbl">Paid on</span><input type="date" id="dAt" value="${esc(dep.paidAt || '')}"></label>
        <label class="field"><span class="lbl">Paid by</span><select id="dHow">${['', 'QuickBooks', 'Clover', 'Check', 'Cash', 'Other'].map((m) => `<option ${dep.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      </div>
      <label class="small row" style="margin-top:6px"><input type="checkbox" id="dWaive" ${dep.waived ? 'checked' : ''}> Waived (likely $10K+ job)</label>
    </section>
    <section class="panel"><h3>Revision fees</h3>
      <p class="small" style="margin:6px 0">${rv.used} revisions · ${rv.allowed} included · ${rv.over} over · fee ${money0(rv.fee)} each</p>
      <div class="row"><span>Fees paid:</span><input type="number" id="rPaid" min="0" value="${c.data?.revisionFeesPaid || 0}" style="width:70px"><span class="small muted">${rv.due ? `<b style="color:var(--red)">${money0(rv.dueAmount)} still due</b>` : 'Nothing due'}</span></div>
    </section></div>
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <section class="panel"><h3>Payments received — the finish line 🏁</h3>
      ${c.data?.paidUnknown && !paid.amount ? '<div class="pill st-red" style="margin:6px 0">A payment was mentioned but the amount is missing</div>' : ''}
      <div class="lbl" style="margin-top:6px">From QuickBooks (automatic)</div>
      ${pays.length ? `<table class="simple">${pays.map((p) => `<tr><td>${fmtDate(p.paid_date)}</td><td>Invoice ${esc(p.invoice_no || '?')}</td><td class="small muted">${esc(p.method || '')}</td><td class="n"><b>${money(Number(p.amount))}</b></td>${canWrite() ? `<td><button class="btn ghost sm" type="button" data-unpay="${p.id}" title="Not this customer's payment">Remove</button></td>` : ''}</tr>`).join('')}</table>` : '<p class="small muted" style="margin:4px 0">None yet. QuickBooks "Payment received" emails sync every 10 minutes.</p>'}
      <div class="fields" style="margin-top:10px">
        <label class="field"><span class="lbl">Other payments ($): cash, check, Clover</span><input type="text" id="pOther" value="${esc(otherAmt || '')}" inputmode="decimal" placeholder="0"></label>
        ${t && t.price ? '' : `<label class="field"><span class="lbl">Job value ($, PRICE)</span><input type="text" id="pJob" value="${esc(c.est_price ?? '')}" inputmode="decimal" placeholder="Total the customer pays"></label>`}
      </div>
      <p class="small" style="margin:8px 0 0">Received so far: <b>${money(n(paid.amount) || 0)}</b>${owedTotal ? ` of ${money(owedTotal)} · <b>${(n(paid.amount) || 0) >= owedTotal - 0.01 ? 'paid in full' : money(owedTotal - (n(paid.amount) || 0)) + ' outstanding'}</b>` : ''}</p>
      <button class="btn primary" type="button" id="pSave" style="margin-top:8px">Save</button>
    </section>
    <section class="panel"><h3>Referral fees owed to TCRS</h3>
      <p class="small muted" style="margin:4px 0 8px">From "Referral" lines on the quote: the partner bills the customer directly and pays TCRS a fee.</p>
      ${refs.length ? `<table class="simple"><thead><tr><th>Partner</th><th>Their job</th><th>Fee</th><th>Status</th></tr></thead><tbody>${refs.map((l) => { const x = (l.deal === 'referral') ? quoteLineCalc(l) : null; return `<tr data-lid="${l.id}"><td>${esc(l.partner || '—')}<div class="small muted">${esc(l.desc || '')}</div></td><td class="n">${money(x.partnerAmt)}</td><td class="n"><b>${money(x.fee)}</b> <span class="small muted">${x.refPct}%</span></td><td><select class="fst">${['expected', 'invoiced', 'received'].map((s) => `<option ${(l.feeStatus || 'expected') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`; }).join('')}</tbody></table>` : '<p class="small muted">None on this job.</p>'}
    </section>
    ${t ? `<section class="panel"><h3>Job money</h3><table class="simple">
      <tr><td>PRICE (customer pays TCRS)</td><td class="n" style="color:var(--price)"><b>${money(t.total)}</b></td></tr>
      <tr><td>COST (TCRS pays suppliers &amp; subs)</td><td class="n" style="color:var(--cost)"><b>${money(t.cost)}</b></td></tr>
      <tr><td>Referral fees expected</td><td class="n">${money(t.fees)}</td></tr>
      <tr><td>Gross profit (incl. referral fees)</td><td class="n"><b>${money(t.profit)}</b>${t.margin != null ? ` <span class="small muted">${t.margin.toFixed(1)}% margin</span>` : ''}</td></tr>
    </table></section>` : ''}
  </div></div>`;
  wireFields(el, c);
  const saveDep = () => patchCustomer(c, { data: { ...(c.data || {}), deposit: { amount: n($('#dAmt', el).value), paidAt: $('#dAt', el).value || null, method: $('#dHow', el).value || null, waived: $('#dWaive', el).checked } } });
  ['#dAmt', '#dAt', '#dHow', '#dWaive'].forEach((s) => ($(s, el).onchange = async () => { await saveDep(); if (s === '#dAt' && $('#dAt', el).value) logEvent(c.id, 'system', 'Design deposit paid'); }));
  $('#rPaid', el).onchange = (e) => patchCustomer(c, { data: { ...(c.data || {}), revisionFeesPaid: Math.max(0, parseInt(e.target.value, 10) || 0) } });
  $('#pSave', el).onclick = async () => {
    const other = n($('#pOther', el).value) || 0;
    const jobV = $('#pJob', el) ? n($('#pJob', el).value) : null;
    const prev = c.paid || {};
    await patchCustomer(c, { paid: { ...prev, other, amount: (n(prev.qb) || 0) + other }, ...(jobV ? { est_price: jobV } : {}) });
    await D.rpc('hq_recalc_paid', { cid: c.id });
    if (other !== (otherAmt || 0)) await logEvent(c.id, 'system', `Other payments set to ${money(other)}`);
    toast('Saved.');
    const got = (n(prev.qb) || 0) + other;
    const owed = t && t.price ? t.total : (jobV || c.est_price || 0);
    if (stageIdx(c.stage) < stageIdx('paid') && owed && got >= owed - 0.01) modal('<h2>Move to Paid?</h2>', '<p>Paid in full. Move this job to Paid?</p><div class="row"><button class="btn primary" type="button" id="mp">Move to Paid</button><button class="btn" type="button" id="np">Not yet</button></div>',
      (box, close) => { $('#mp', box).onclick = () => { close(); moveStage(c, 'paid'); }; $('#np', box).onclick = close; });
  };
  $$('[data-unpay]', el).forEach((b) => (b.onclick = async () => {
    await D.update('payments', b.dataset.unpay, { customer_id: null, status: 'review', match_note: 'removed from ' + (c.name || 'customer') });
    await D.rpc('hq_recalc_paid', { cid: c.id });
    toast('Moved back to the payments tray.');
  }));
  $$('.fst', el).forEach((s) => (s.onchange = async () => {
    const lid = s.closest('tr').dataset.lid;
    const nq = structuredClone(q);
    nq.sections.forEach((sec) => sec.options.forEach((o) => o.lines.forEach((l) => { if (l.id === lid) l.feeStatus = s.value; })));
    await D.update('quotes', q.id, { sections: nq.sections });
  }));
}
import { lineCalc as quoteLineCalc } from './core.js?v=20261104182925';
