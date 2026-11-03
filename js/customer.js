// One customer, everything in one place.
import * as D from './data.js';
import {
  S, STAGES, PRODUCTS, SERVICES, CTYPES, FTYPES, WHOSE, esc, $, $$, n, money, money0, status, score, stageIdx,
  openActions, custActions, custFiles, custLogs, custSizes, custQuote, quoteCalc, revisionInfo, gateMissing, fmtDate,
  todayISO, addDays, daysBetween, toast, canWrite, logEvent, patchCustomer, STATUS_TEXT, settings, referralLines, personName,
} from './core.js';
import { openDrop } from './drop.js';
import { renderLayout } from './layout.js';
import { renderQuote, learnFromQuote } from './quote.js';

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
function escClose(e) { if (e.key === 'Escape' && sheet && !document.querySelector('.sheet-bg.top-modal')) closeCustomer(); }
export function closeCustomer(silent) {
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
      <span class="small muted">${c.first_contact ? `First contact ${fmtDate(c.first_contact)} · day ${daysBetween(c.first_contact, todayISO())}` : ''}</span>
      ${canWrite() ? `<button class="btn sm" type="button" id="cDrop">⬆ Drop into ${esc((c.name || 'this customer').split(' ')[0])}</button>` : ''}
      <button class="x" type="button" aria-label="Close" id="cClose">×</button>
    </div>
    <div class="sheet-b">
      <nav class="stepper" aria-label="Stage">${STAGES.map((s, i) => `<button type="button" class="step ${i < si ? 'done' : i === si ? 'cur' : ''}" data-stage="${s.k}" ${canWrite() ? '' : 'disabled'}><span class="b">${i < si ? '✓' : i + 1}</span><span class="s">${esc(s.short)}</span></button>`).join('')}</nav>
      ${nextCard(c, st)}
      <div class="tabs" role="tablist">${[['overview', 'Overview'], ['files', 'Files & sizes'], ['layout', 'Layout'], ['quote', 'Estimate → Quote'], ['money', 'Money & dates']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="tabBody"></div>
    </div></div>`;
  $('#cClose', sheet).onclick = () => closeCustomer();
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
    </form>` : ''}
  </section>`;
}
function wireNext(c) {
  $$('.act', sheet).forEach((el) => {
    const a = S.actions.find((x) => x.id === el.dataset.aid);
    $('.done', el).onchange = async () => {
      await D.update('actions', a.id, { done: true, done_at: new Date().toISOString() });
      toast('Step done.', () => D.update('actions', a.id, { done: false, done_at: null }));
      logEvent(c.id, 'system', `Done: ${a.title}`);
    };
    $$('.whose button', el).forEach((b) => (b.onclick = () => D.update('actions', a.id, { waiting_on: b.dataset.w })));
    $('.due', el).onchange = (e) => D.update('actions', a.id, { due: e.target.value || null });
    $('.del', el).onclick = async () => { await D.remove('actions', a.id); toast('Step deleted.', () => D.insert('actions', a)); };
  });
  const f = $('#addAct', sheet);
  if (f) {
    let w = 'us';
    $$('#aWhose button', sheet).forEach((b) => (b.onclick = () => { w = b.dataset.w; $$('#aWhose button', sheet).forEach((x) => (x.className = x === b ? 'on ' + w : '')); }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const title = $('#aTitle', sheet).value.trim();
      if (!title) return;
      await D.insert('actions', { customer_id: c.id, title, due: $('#aDue', sheet).value || null, waiting_on: w, done: false, owner: S.me?.id });
    };
  }
}

/* ───────── stage moves with gates ───────── */
export function moveStage(c, to) {
  if (!canWrite()) return;
  const back = stageIdx(to) < stageIdx(c.stage);
  const miss = back ? [] : gateMissing(c, to);
  const go = async (forced) => {
    const from = c.stage;
    const patch = { stage: to };
    if (to === 'paid' && !c.paid?.at && c.paid?.amount) patch.paid = { ...c.paid, at: c.paid.at || new Date().toISOString() };
    await patchCustomer(c, patch);
    await logEvent(c.id, 'system', `Moved ${STAGES[stageIdx(from)].label} → ${STAGES[stageIdx(to)].label}${forced ? ' (moved past missing items)' : ''}`, forced ? 'Missing: ' + miss.join('; ') : null);
    if (to === 'paid') { const q = custQuote(c.id); if (q) learnFromQuote(q, c, true); }
    toast(`Moved to ${STAGES[stageIdx(to)].label}.`, () => patchCustomer(c, { stage: from }));
  };
  if (!miss.length) return go(false);
  modal(`<h2>Before "${esc(STAGES[stageIdx(to)].label)}"</h2>`, `
    <p>These are missing:</p>
    <ul>${miss.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    <p class="small muted">Fix them first, or move anyway. Moving anyway is noted in the customer's history.</p>
    <div class="row"><button class="btn primary" type="button" data-fix>Fix it</button><button class="btn" type="button" data-force>Move anyway</button></div>`,
  (box, close) => {
    $('[data-fix]', box).onclick = () => {
      close();
      location.hash = 'c-' + c.id;
      setTimeout(() => {
        tab = miss.some((m) => m.includes('estimate') || m.includes('quote') || m.includes('Quote')) ? 'quote' : miss.some((m) => /deposit|Payment|date/.test(m)) ? 'money' : 'overview';
        refreshCustomer();
      }, 50);
    };
    $('[data-force]', box).onclick = () => { close(); go(true); };
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
  el.innerHTML = `<div class="two">
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
        ${c.lost ? `<button class="btn" type="button" id="unlose">Reopen lead</button>` : `<button class="btn danger" type="button" id="lose">Mark lost…</button>`}</div>
      </section>
    </div></div>`;
  wireFields(el, c);
  $('#tldr', el)?.addEventListener('change', (e) => patchCustomer(c, { tldr: e.target.value }));
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
        <span class="small muted">${fmtDate(f.created_at)}</span>
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
  const isAppl = (c.products || []).includes('Appliances') && (c.products || []).length === 1;
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
    <section class="panel"><h3>Payment — the finish line 🏁</h3>
      <p class="small muted" style="margin:4px 0 8px">Record it when the money lands in ${isAppl ? 'Clover (appliances)' : 'QuickBooks'}. HQ doesn't read QuickBooks or Clover yet, so type it in.</p>
      <div class="fields">
        <label class="field"><span class="lbl">Amount received</span><input type="text" id="pAmt" value="${esc(paid.amount ?? '')}" inputmode="decimal" placeholder="${t ? t.total : ''}"></label>
        <label class="field"><span class="lbl">Through</span><select id="pHow">${['', 'QuickBooks', 'Clover', 'Check', 'Cash', 'Other'].map((m) => `<option ${paid.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Date</span><input type="date" id="pAt" value="${esc((paid.at || '').slice(0, 10))}"></label>
        <label class="field"><span class="lbl">Invoice / ref #</span><input type="text" id="pRef" value="${esc(paid.ref || '')}"></label>
      </div>
      ${t ? `<p class="small" style="margin-top:8px">Quote total ${money(t.total)}${paid.amount ? ` · received ${money(n(paid.amount))} · <b>${n(paid.amount) >= t.total - 0.01 ? 'paid in full' : money(t.total - n(paid.amount)) + ' outstanding'}</b>` : ''}</p>` : ''}
      <button class="btn primary" type="button" id="pSave" style="margin-top:8px">Save payment</button>
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
    const amount = n($('#pAmt', el).value), method = $('#pHow', el).value;
    if (!amount || !method) return toast('Enter the amount and where it was paid.');
    await patchCustomer(c, { paid: { amount, method, at: $('#pAt', el).value || todayISO(), ref: $('#pRef', el).value.trim() } });
    await logEvent(c.id, 'system', `Payment recorded: ${money(amount)} via ${method}`);
    if (c.stage !== 'paid') modal('<h2>Move to Paid?</h2>', '<p>Payment is recorded. Move this job across the finish line?</p><div class="row"><button class="btn primary" type="button" id="mp">Move to Paid 🏁</button><button class="btn" type="button" id="np">Not yet</button></div>',
      (box, close) => { $('#mp', box).onclick = () => { close(); moveStage(c, 'paid'); }; $('#np', box).onclick = close; });
  };
  $$('.fst', el).forEach((s) => (s.onchange = async () => {
    const lid = s.closest('tr').dataset.lid;
    const nq = structuredClone(q);
    nq.sections.forEach((sec) => sec.options.forEach((o) => o.lines.forEach((l) => { if (l.id === lid) l.feeStatus = s.value; })));
    await D.update('quotes', q.id, { sections: nq.sections });
  }));
}
import { lineCalc as quoteLineCalc } from './core.js';
