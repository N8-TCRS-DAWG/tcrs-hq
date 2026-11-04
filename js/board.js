// Board (kanban) and Race (glance / office TV).
import * as D from './data.js';
import { S, STAGES, esc, $, $$, status, score, stageIdx, openActions, keyDates, revisionInfo, fmtDate, todayISO, daysBetween, money0, custQuote, quoteCalc, STATUS_TEXT, canWrite, referralLines, toast } from './core.js';
import { moveStage } from './customer.js';
import { openDrop } from './drop.js';

const F = { st: null, q: '', lost: false };
try { Object.assign(F, JSON.parse(localStorage.getItem('hq-board-filter') || '{}')); } catch {}
const saveF = () => { try { localStorage.setItem('hq-board-filter', JSON.stringify(F)); } catch {} };

const PROD_SHORT = { 'Cabinets': 'Cab', 'Countertops': 'Tops', 'Flooring': 'Floor', 'Appliances': 'Appl', 'Doors & trim': 'Doors', 'Garage doors': 'Garage', 'Sauna / plunge': 'Sauna', 'Furniture': 'Furn', 'Other': 'Other' };

export function value(c) {
  const q = custQuote(c.id);
  let v = 0;
  if (q) { const t = quoteCalc(q, c); if (t.price) v = t.total; }
  if (!v) v = c.est_price || c.budget || 0;
  return Math.max(v, received(c));
}
export const received = (c) => Number(c.paid?.amount) || 0;

function visible() {
  const q = F.q.trim().toLowerCase();
  return S.customers.filter((c) => (F.lost ? true : !c.lost))
    .filter((c) => !q || [c.name, c.city, c.address, c.phone, (c.phone || '').replace(/\D/g, ''), c.email, c.tldr, (c.products || []).join(' ')].join(' ').toLowerCase().includes(q))
    .filter((c) => !F.st || (F.st === 'due' ? dueSteps(c).length > 0 : status(c).k === F.st));
}

function card(c) {
  const st = status(c);
  const sc = score(c);
  const nx = openActions(c.id)[0];
  const rv = revisionInfo(c);
  const early = stageIdx(c.stage) <= 4;
  const day = c.first_contact ? daysBetween(c.first_contact, todayISO()) : null;
  const dates = keyDates(c);
  const v = value(c);
  return `<article class="card st-${st.k}" draggable="${canWrite()}" data-id="${c.id}" tabindex="0" aria-label="${esc(c.name)}, ${STATUS_TEXT[st.k]}">
    <div class="t"><span class="name">${esc(c.name || 'No name yet')}</span>${early ? `<span class="score" title="Lead score ${sc.total}/100: likely to buy, budget, repeat customer, intake quality">${sc.total}</span>` : ''}</div>
    ${(c.products || []).length ? `<div class="prods">${c.products.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}
    <div class="next"><span class="dot" style="margin-top:4px"></span><span>${nx ? esc(nx.title) + (nx.due ? ` · <span class="${nx.due < todayISO() ? 'warn' : ''}">${fmtDate(nx.due)}</span>` : '') : `<b>${esc(st.why)}</b>`}</span></div>
    <div class="meta">
      ${day != null ? `<span title="Days since first contact">${day === 0 ? 'New today' : day + (day === 1 ? ' day' : ' days') + ' in'}</span>` : ''}
      ${v ? `<span>${money0(v)}</span>` : ''}
      ${received(c) ? `<span class="got">Paid ${money0(received(c))}</span>` : (c.data?.paidUnknown ? '<span class="warn">Paid: amount?</span>' : '')}
      ${rv.used ? `<span class="${rv.over ? 'warn' : ''}">Rev ${rv.used}/${rv.allowed}</span>` : ''}
      ${dates.map((d) => `<span class="${d.warn ? 'warn' : ''}">${esc(d.text)}</span>`).join('')}
      ${c.lost ? '<span class="warn">Lost</span>' : ''}
    </div>
  </article>`;
}

export function renderBoard(v) {
  const list = visible();
  const counts = { red: 0, yellow: 0, green: 0 };
  S.customers.filter((c) => !c.lost && c.stage !== 'paid').forEach((c) => { const k = status(c).k; if (counts[k] != null) counts[k]++; });
  const openVal = S.customers.filter((c) => !c.lost && c.stage !== 'paid').reduce((a, c) => a + value(c), 0);
  const collected = S.customers.filter((c) => !c.lost).reduce((a, c) => a + received(c), 0);
  const feesOwed = S.quotes.filter((q) => q.status === 'accepted').reduce((a, q) => a + referralLines(q).filter((l) => l.feeStatus !== 'received').length, 0);

  v.innerHTML = `
  <div class="strip">
    <button type="button" class="stat st-due ${F.st === 'due' ? 'on' : ''}" data-st="due" title="Steps due today or late, any owner"><span class="dot"></span><b>${S.customers.filter((c) => !c.lost).reduce((a, c) => a + dueSteps(c).length, 0)}</b> Due today / late</button>
    ${['red', 'yellow', 'green'].map((k) => `<button type="button" class="stat st-${k} ${F.st === k ? 'on' : ''}" data-st="${k}"><span class="dot"></span><b>${counts[k]}</b> ${STATUS_TEXT[k]}</button>`).join('')}
    <input type="search" id="bq" placeholder="Search name, city, product" value="${esc(F.q)}" aria-label="Search leads">
    <label class="small row" style="gap:4px"><input type="checkbox" id="blost" ${F.lost ? 'checked' : ''}> Show lost</label>
    <span class="grow"></span>
    ${S.payments.filter((p) => p.status === 'review').length && canWrite() ? `<button class="btn" type="button" id="payTray" style="border-color:var(--amber);background:var(--amber-bg)">💳 ${S.payments.filter((p) => p.status === 'review').length} QuickBooks payment${S.payments.filter((p) => p.status === 'review').length > 1 ? 's' : ''} to match</button>` : ''}
    <span class="small muted">Open pipeline <b class="num">${money0(openVal)}</b> · Collected <b class="num" style="color:var(--green)">${money0(collected)}</b>${feesOwed ? ` · <b>${feesOwed}</b> referral fee${feesOwed > 1 ? 's' : ''} to collect` : ''}</span>
    ${canWrite() ? '<button class="btn" type="button" id="newLead">+ New lead by hand</button>' : ''}
  </div>
  ${F.st ? focusPanel(F.st) : ''}
  <p class="legend">Card color = whose move it is. The dark badge is the lead score (0–100). Drag a card to another column, or open it and click a stage. Shortcuts: <kbd>D</kbd> Drop · <kbd>N</kbd> new lead · <kbd>/</kbd> search · drag files or paste anywhere.</p>
  <div class="board-wrap"><div class="board" style="grid-template-columns:${STAGES.map((s, i) => list.some((c) => (c.stage || 'new') === s.k) ? 'minmax(190px, 1.6fr)' : i === STAGES.length - 1 ? 'minmax(130px, 0.9fr)' : 'minmax(112px, 0.7fr)').join(' ')}">
    ${STAGES.map((s, i) => {
      const cs = list.filter((c) => (c.stage || 'new') === s.k).sort(sortCards);
      const sum = cs.reduce((a, c) => a + value(c), 0);
      return `<section class="col ${i === STAGES.length - 1 ? 'finish' : ''} ${cs.length ? '' : 'empty'}" data-stage="${s.k}" aria-label="${esc(s.label)}">
        <div class="col-h"><h3>${i === STAGES.length - 1 ? '🏁 ' : ''}${esc(s.label)}</h3><span class="num">${cs.length}${sum ? ' · ' + money0(sum) : ''}</span></div>
        ${cs.map(card).join('') || '<div class="none">Nothing here</div>'}
      </section>`;
    }).join('')}
  </div></div>
  ${S.customers.length ? '' : `<div class="empty" style="margin-top:14px"><h3>No leads yet</h3><p>Press <b>Drop</b> to paste an email, a call transcript, photos or a layout. Claude builds the customer card for you to check.</p></div>`}`;

  $$('.stat', v).forEach((b) => (b.onclick = () => { F.st = F.st === b.dataset.st ? null : b.dataset.st; saveF(); renderBoard(v); }));
  $('#fClear', v)?.addEventListener('click', () => { F.st = null; saveF(); renderBoard(v); });
  $$('.focus-row', v).forEach((r) => { r.onclick = () => (location.hash = 'c-' + r.dataset.id); r.onkeydown = (e) => { if (e.key === 'Enter') r.onclick(); }; });
  const bq = $('#bq', v);
  bq.oninput = () => { F.q = bq.value; saveF(); clearTimeout(bq._t); bq._t = setTimeout(() => { renderBoard(v); const x = $('#bq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 200); };
  $('#blost', v).onchange = (e) => { F.lost = e.target.checked; saveF(); renderBoard(v); };
  $('#newLead', v)?.addEventListener('click', () => openDrop({ manual: true }));
  $('#payTray', v)?.addEventListener('click', openPayTray);
  $$('.card', v).forEach((el) => {
    el.onclick = () => (location.hash = 'c-' + el.dataset.id);
    el.onkeydown = (e) => { if (e.key === 'Enter') location.hash = 'c-' + el.dataset.id; };
    el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); };
    el.ondragend = () => el.classList.remove('dragging');
  });
  $$('.col', v).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove('over');
      const c = S.customers.find((x) => x.id === e.dataTransfer.getData('text/plain'));
      if (c && c.stage !== col.dataset.stage) moveStage(c, col.dataset.stage);
    };
  });
}

function openPayTray() {
  const list = S.payments.filter((p) => p.status === 'review').sort((a, b) => (b.paid_date || '').localeCompare(a.paid_date || ''));
  const opts = [...S.customers].filter((c) => !c.lost).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const b = document.createElement('div');
  b.className = 'sheet-bg top-modal'; b.style.zIndex = 60;
  b.innerHTML = `<div class="sheet narrow"><div class="sheet-h"><h2>QuickBooks payments to match</h2><button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-b">
    <p class="small muted">These came from QuickBooks "Payment received" emails but didn't match exactly one customer by email or name. Pick the customer, or ignore ones that aren't TCRS jobs.</p>
    ${list.map((p) => `<div class="check-sec" data-pid="${p.id}"><div class="row"><b>${money0(Number(p.amount))}</b><span>${esc(p.customer_name || '?')}</span><span class="small muted">${esc(p.customer_email || '')} · invoice ${esc(p.invoice_no || '?')} · ${fmtDate(p.paid_date)} · ${esc(p.match_note || '')}</span></div>
      <div class="row"><select class="grow" data-cust><option value="">Pick the customer…</option>${opts.map((c) => `<option value="${c.id}">${esc(c.name || 'No name')}${c.city ? ' · ' + esc(c.city) : ''}</option>`).join('')}</select><button class="btn primary sm" type="button" data-apply>Apply</button><button class="btn sm" type="button" data-ignore>Ignore</button></div></div>`).join('') || '<p>All matched.</p>'}
  </div></div>`;
  document.body.appendChild(b);
  b.querySelector('.x').onclick = () => b.remove();
  b.querySelectorAll('[data-pid]').forEach((row) => {
    const pid = row.dataset.pid;
    row.querySelector('[data-apply]').onclick = async () => {
      const cid = row.querySelector('[data-cust]').value;
      if (!cid) return toast('Pick the customer first.');
      const p = S.payments.find((x) => x.id === pid);
      await D.update('payments', pid, { customer_id: cid, status: 'applied', match_note: 'matched by hand' });
      await D.rpc('hq_recalc_paid', { cid });
      await D.insert('logs', { customer_id: cid, kind: 'system', at: new Date().toISOString(), summary: `QuickBooks payment ${money0(Number(p.amount))} applied by hand (invoice ${p.invoice_no || '?'})`, by: S.me?.id });
      row.remove(); toast('Payment applied.');
    };
    row.querySelector('[data-ignore]').onclick = async () => { await D.update('payments', pid, { status: 'ignored' }); row.remove(); toast('Ignored.'); };
  });
}

const WAIT = { red: ['us'], yellow: ['supplier', 'contractor'], green: ['customer'] };
const dueSteps = (c) => openActions(c.id).filter((a) => a.due && a.due <= todayISO());
const LABEL = { ...STATUS_TEXT, due: 'Due today / late' };
function focusPanel(k) {
  const t = todayISO();
  const leads = S.customers.filter((c) => !c.lost && (k === 'due' ? dueSteps(c).length : c.stage !== 'paid' && status(c).k === k));
  const rows = [];
  leads.forEach((c) => {
    const acts = k === 'due' ? dueSteps(c) : openActions(c.id).filter((a) => WAIT[k].includes(a.waiting_on));
    if (!acts.length) rows.push({ c, title: k === 'red' ? 'No next step set — open and add one' : status(c).why, due: null });
    acts.forEach((a) => rows.push({ c, title: a.title, due: a.due, who: a.waiting_on }));
  });
  rows.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  return `<section class="focus-panel st-${k}" aria-label="${esc(LABEL[k])}">
    <div class="fh"><span class="dot"></span><h3>${esc(LABEL[k])}: ${rows.length} step${rows.length === 1 ? '' : 's'} on ${leads.length} lead${leads.length === 1 ? '' : 's'}</h3><span class="grow"></span><button class="btn sm" type="button" id="fClear">Show all leads</button></div>
    ${rows.map((r) => `<div class="focus-row" data-id="${r.c.id}" tabindex="0"><span class="due ${r.due && r.due < t ? 'late' : ''}">${r.due ? (r.due < t ? 'Late · ' : '') + fmtDate(r.due) : 'No date'}</span><span>${esc(r.title)}${r.who && (k === 'due' || (r.who !== 'us' && r.who !== 'customer')) ? ` <span class="chip">${esc(r.who === 'us' ? 'our move' : r.who)}</span>` : ''}</span><span class="who">${esc(r.c.name || 'No name')}</span></div>`).join('') || '<p class="small muted">Nothing here. Nice.</p>'}
  </section>`;
}

function sortCards(a, b) {
  const order = { red: 0, yellow: 1, green: 2, none: 3 };
  const sa = status(a).k, sb = status(b).k;
  if (order[sa] !== order[sb]) return order[sa] - order[sb];
  if (stageIdx(a.stage) <= 4) return score(b).total - score(a).total;
  return (a.first_contact || '').localeCompare(b.first_contact || '');
}

/* ───────── race / TV ───────── */
let clockTimer = null;
export function renderRace(v, tv) {
  const list = S.customers.filter((c) => !c.lost);
  const counts = { red: 0, yellow: 0, green: 0 };
  list.filter((c) => c.stage !== 'paid').forEach((c) => { const k = status(c).k; if (counts[k] != null) counts[k]++; });
  const thirty = new Date(Date.now() - 30 * 864e5).toISOString();
  v.innerHTML = `
  <div class="race-top">
    ${tv ? `<div class="tv-head"><img src="img/logo-green.png" alt="TCRS" style="border-radius:8px"><span class="clock" id="clock"></span></div>` : '<h2>The race to paid</h2>'}
    <div class="row">${['red', 'yellow', 'green'].map((k) => `<span class="pill st-${k}" style="font-size:${tv ? 16 : 13}px"><span class="dot"></span>${counts[k]} ${STATUS_TEXT[k]}</span>`).join('')}</div>
    ${tv ? '' : '<a class="btn" href="#tv">Full-screen TV mode</a>'}
  </div>
  <div class="race-wrap"><div class="race">
    ${STAGES.map((s, i) => `<div class="lane-h ${i === STAGES.length - 1 ? 'fin' : ''}">${i === STAGES.length - 1 ? '🏁 ' : ''}${esc(s.short)}</div>`).join('')}
    ${STAGES.map((s) => {
      let cs = list.filter((c) => (c.stage || 'new') === s.k);
      if (s.k === 'paid') cs = cs.filter((c) => (c.paid?.at || c.updated_at) >= thirty);
      cs.sort((a, b) => (a.first_contact || '').localeCompare(b.first_contact || ''));
      return `<div class="lane">${cs.map((c) => {
        const st = status(c);
        const d = keyDates(c);
        return `<div class="car st-${st.k}" data-id="${c.id}" title="${esc(STATUS_TEXT[st.k])}">
          <div class="n">${esc(c.name || 'No name')}</div>
          <div class="d"><span>${esc((c.products || []).map((p) => PROD_SHORT[p] || p).join(' · ') || '—')}</span></div>
          <div class="d"><span>Day ${c.first_contact ? daysBetween(c.first_contact, todayISO()) : '?'} · since ${fmtDate(c.first_contact)}</span>${d.map((x) => `<span class="${x.warn ? 'warn' : ''}">${esc(x.text)}</span>`).join('')}</div>
        </div>`;
      }).join('')}</div>`;
    }).join('')}
  </div></div>
  ${tv ? '<p class="small muted" style="margin-top:10px">Updates live. Paid column shows the last 30 days.</p>' : '<p class="small muted" style="margin-top:10px">Same cards and colors as the Board, cut down for a glance. On the office TV, sign in with the TV login: it opens here and refreshes itself.</p>'}`;
  if (!tv) $$('.car', v).forEach((el) => (el.onclick = () => (location.hash = 'c-' + el.dataset.id)));
  clearInterval(clockTimer);
  if (tv) {
    const tick = () => { const el = $('#clock'); if (el) el.textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    tick(); clockTimer = setInterval(tick, 20000);
  }
}


/* ───────── Office TV (40–55" seen from 8–15 ft): money · race · next 7 days ───────── */
let tvTimers = [];
let wakeLock = null;
export function renderTV(v) {
  const t = todayISO();
  const live = S.customers.filter((c) => !c.lost);
  const open = live.filter((c) => c.stage !== 'paid');
  const counts = { red: 0, yellow: 0, green: 0 };
  open.forEach((c) => { const k = status(c).k; if (counts[k] != null) counts[k]++; });
  const month = t.slice(0, 7);
  const monthName = new Date(t + 'T12:00').toLocaleDateString('en-US', { month: 'long' });
  const collected = S.payments.filter((p) => p.status === 'applied' && (p.paid_date || '').startsWith(month)).reduce((a, p) => a + Number(p.amount || 0), 0)
    + live.filter((c) => Number(c.paid?.other) > 0 && (c.paid?.at || '').startsWith(month)).reduce((a, c) => a + Number(c.paid.other), 0);
  const pipeline = open.reduce((a, c) => a + value(c), 0);
  const end = new Date(t + 'T12:00'); end.setDate(end.getDate() + 7);
  const endISO = end.toISOString().slice(0, 10);
  const events = [];
  live.forEach((c) => [['Measure', c.measure_date], ['Delivery', c.delivery_date], ['Install', c.install_date]].forEach(([k, d]) => { if (d && d >= t && d <= endISO) events.push({ k, d, c }); }));
  events.sort((a, b) => a.d.localeCompare(b.d) || a.k.localeCompare(b.k));
  const thirty = new Date(Date.now() - 30 * 864e5).toISOString();
  const dayLbl = (d) => d === t ? 'Today' : d === addDaysISO(t, 1) ? 'Tomorrow' : new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  v.innerHTML = `<div class="tvw">
    <header class="tv-top">
      <img src="img/logo-green.png" alt="TCRS" class="tv-logo">
      <div class="tv-tile"><span class="tv-l">Open pipeline</span><span class="tv-v">${money0(pipeline)}</span><span class="tv-s">${open.length} active job${open.length === 1 ? '' : 's'}</span></div>
      <div class="tv-tile good"><span class="tv-l">Collected in ${esc(monthName)}</span><span class="tv-v">${money0(collected)}</span><span class="tv-s">QuickBooks + other payments</span></div>
      <div class="tv-tile"><span class="tv-l">Whose move</span><span class="tv-pills">${['red', 'yellow', 'green'].map((k) => `<span class="st-${k}"><span class="dot"></span>${counts[k]} ${k === 'red' ? 'us' : k === 'yellow' ? 'partner' : 'customer'}</span>`).join('')}</span></div>
      <div class="tv-clock"><span id="clock"></span><span class="tv-s" id="tvUpd"></span></div>
    </header>
    <section class="tv-race" style="grid-template-columns:${STAGES.map((s) => live.some((c) => (c.stage || 'new') === s.k) ? 'minmax(0, 1fr)' : 'minmax(0, 0.5fr)').join(' ')}">
      ${STAGES.map((s, i) => {
        let cs = live.filter((c) => (c.stage || 'new') === s.k);
        if (s.k === 'paid') cs = cs.filter((c) => (c.paid?.at || c.updated_at || '') >= thirty.slice(0, 10));
        cs.sort((a, b) => (a.first_contact || '').localeCompare(b.first_contact || ''));
        const more = Math.max(0, cs.length - 6);
        return `<div class="tv-lane ${i === STAGES.length - 1 ? 'fin' : ''}"><div class="tv-lh">${i === STAGES.length - 1 ? '🏁 ' : ''}${esc(s.short)} <b>${cs.length}</b></div>
          ${cs.slice(0, 6).map((c) => { const st = status(c); const d = keyDates(c); return `<div class="tv-car st-${st.k}"><div class="n">${esc(c.name || 'No name')}</div><div class="p">${esc((c.products || []).map((p) => PROD_SHORT[p] || p).join(' · ') || '—')}</div>${d.length ? `<div class="k">${d.map((x) => `<span class="${x.warn ? 'warn' : ''}">${esc(x.text)}</span>`).join('')}</div>` : ''}</div>`; }).join('')}
          ${more ? `<div class="tv-more">+${more} more</div>` : ''}</div>`;
      }).join('')}
    </section>
    <section class="tv-week"><div class="tv-wh">Next 7 days</div>
      <div class="tv-ev">${events.slice(0, 10).map((e) => `<div class="ev ${e.k.toLowerCase()}"><span class="when">${esc(dayLbl(e.d))}</span><span class="what">${esc(e.k)}</span><span class="evn">${esc(e.c.name || '')}</span></div>`).join('') || '<div class="tv-s" style="font-size:20px">No measures, deliveries or installs scheduled.</div>'}${events.length > 10 ? `<div class="ev"><span class="what">+${events.length - 10} more</span></div>` : ''}</div>
    </section>
  </div>`;

  tvTimers.forEach(clearInterval); tvTimers = [];
  const tick = () => {
    const el = document.getElementById('clock'); if (!el) return;
    el.textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const u = document.getElementById('tvUpd'); if (u) u.textContent = (navigator.onLine === false ? '⚠ Offline — showing last data · ' : '') + 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };
  tick(); tvTimers.push(setInterval(tick, 20000));
  // reload every 6 hours (picks up app updates, clears memory) — only on the TV
  if (!window.__tvReload) window.__tvReload = setTimeout(() => location.reload(), 6 * 3600 * 1000);
  // keep the screen awake where the browser allows it
  if (!wakeLock && navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { wakeLock = w; w.addEventListener('release', () => (wakeLock = null)); }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.classList.contains('tv') && navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => (wakeLock = w)).catch(() => {}); });
function addDaysISO(iso, k) { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10); }
