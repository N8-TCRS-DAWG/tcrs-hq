// Board (kanban) and Race (glance / office TV).
import * as D from './data.js?v=20261111001108';
import { isPrePaid, S, STAGES, esc, $, $$, status, score, stageIdx, openActions, keyDates, revisionInfo, fmtDate, todayISO, daysBetween, money0, custQuote, quoteCalc, STATUS_TEXT, canWrite, referralLines, toast, settings, personName } from './core.js?v=20261111001108';
import { moveStage } from './customer.js?v=20261111001108';
import { openDrop } from './drop.js?v=20261111001108';

const F = { st: null, q: '', lost: false };
// Only "Show lost" is remembered. Search and bubble filters reset on each visit so the board always opens full.
try { F.lost = !!JSON.parse(localStorage.getItem('hq-board-filter') || '{}').lost; } catch {}
const saveF = () => { try { localStorage.setItem('hq-board-filter', JSON.stringify({ lost: F.lost })); } catch {} };
let listOpen = false;

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
  return `<article class="card st-${st.k}" draggable="${canWrite() && innerWidth > 700}" data-id="${c.id}" tabindex="0" title="${esc(st.why || STATUS_TEXT[st.k])}" aria-label="${esc(c.name)}, ${STATUS_TEXT[st.k]}, lead score ${sc.total}">
    <div class="t"><span class="name">${esc(c.name || 'No name yet')}</span><span class="score" title="Lead score ${sc.total}/100: likely to buy, budget, repeat customer, intake quality">${sc.total}</span></div>
  </article>`;
}

export function renderBoard(v) {
  const list = visible();
  const counts = { red: 0, yellow: 0, green: 0 };
  S.customers.filter((c) => !c.lost).forEach((c) => { const k = status(c).k; if (counts[k] != null) counts[k]++; });
  const openVal = S.customers.filter((c) => !c.lost && isPrePaid(c)).reduce((a, c) => a + value(c), 0);
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
    ${canWrite() ? '<button class="btn sm" type="button" id="newLead" title="Type a lead in by hand">+ New lead</button>' : ''}
  </div>
  ${F.st ? focusPanel(F.st) : ''}
  <details class="legend"><summary>How this board works</summary>Card color = whose move it is. The dark badge is the lead score (0–100). Drag a card to another column, or open it and click a stage. Shortcuts: <kbd>D</kbd> Drop · <kbd>N</kbd> new lead · <kbd>/</kbd> search · drag files or paste anywhere.</details>
  <div class="board-wrap"><div class="board" style="grid-template-columns:${STAGES.map((s) => list.some((c) => (c.stage || 'new') === s.k) ? 'minmax(0, 1.5fr)' : 'minmax(0, 0.55fr)').join(' ')}">
    ${STAGES.map((s, i) => {
      const cs = list.filter((c) => (c.stage || 'new') === s.k).sort(sortCards);
      const sum = cs.reduce((a, c) => a + value(c), 0);
      return `<section class="col ${i === STAGES.length - 1 ? 'finish' : ''} ${cs.length ? '' : 'empty'}" data-stage="${s.k}" aria-label="${esc(s.label)}">
        <div class="col-h"><h3>${i === STAGES.length - 1 ? '🏁 ' : ''}${esc(s.label)}</h3><span class="num">${cs.length}${sum ? ' · ' + money0(sum) : ''}</span></div>
        ${cs.map(card).join('') || '<div class="none">Nothing here</div>'}
      </section>`;
    }).join('')}
  </div></div>
  ${S.customers.length && !list.length ? `<div class="empty" style="margin-top:14px"><h3>${S.customers.filter((c) => F.lost || !c.lost).length} leads are hidden by ${F.q ? `the search "${esc(F.q)}"` : 'a filter'}</h3><button class="btn primary" type="button" id="fReset">Show all leads</button></div>` : ''}
  ${S.customers.length ? '' : `<div class="empty" style="margin-top:14px"><h3>No leads yet</h3><p>Press <b>Drop</b> to paste an email, a call transcript, photos or a layout. Claude builds the customer card for you to check.</p></div>`}`;

  fitView(v);
  $$('.stat', v).forEach((b) => (b.onclick = () => { F.st = F.st === b.dataset.st ? null : b.dataset.st; listOpen = !!F.st; renderBoard(v); }));
  $('#fList', v)?.addEventListener('click', () => { listOpen = !listOpen; renderBoard(v); });
  $('#fClear', v)?.addEventListener('click', () => { F.st = null; renderBoard(v); });
  $('#fReset', v)?.addEventListener('click', () => { F.st = null; F.q = ''; saveF(); renderBoard(v); });
  $$('.focus-row', v).forEach((r) => { r.onclick = () => (location.hash = 'c-' + r.dataset.id); r.onkeydown = (e) => { if (e.key === 'Enter') r.onclick(); }; });
  const bq = $('#bq', v);
  bq.oninput = () => { F.q = bq.value; clearTimeout(bq._t); bq._t = setTimeout(() => { renderBoard(v); const x = $('#bq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 200); };
  $('#blost', v).onchange = (e) => { F.lost = e.target.checked; saveF(); renderBoard(v); };
  $('#newLead', v)?.addEventListener('click', () => openDrop({ manual: true }));
  $('#payTray', v)?.addEventListener('click', openPayTray);
  $$('.card', v).forEach((el) => {
    el.onclick = () => (location.hash = 'c-' + el.dataset.id);
    el.onkeydown = (e) => { if (e.key === 'Enter') location.hash = 'c-' + el.dataset.id; };
    el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); };
    el.ondragend = () => el.classList.remove('dragging');
  });
  wireFileDrops(v, '.card', '.col');
  $$('.col', v).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); if (!hasFiles(e)) col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = (e) => {
      if (hasFiles(e)) return;
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

/* Files or text dropped on a card update that customer; on the New lead column they start a new lead. */
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
function wireFileDrops(v, cardSel, colSel) {
  if (!canWrite()) return;
  const hot = (el, on) => el.classList.toggle('filehot', on);
  $$(cardSel, v).forEach((el) => {
    el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); hot(el, true); });
    el.addEventListener('dragleave', () => hot(el, false));
    el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.hqHandled = true; hot(el, false);
      openDrop({ customerId: el.dataset.id, files: [...e.dataTransfer.files], auto: true });
    });
  });
  $$(colSel, v).forEach((col, i) => {
    const isNew = i === 0;
    col.addEventListener('dragover', (e) => { if (!hasFiles(e) || e.target.closest(cardSel)) return; e.preventDefault(); if (isNew) hot(col, true); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) hot(col, false); });
    col.addEventListener('drop', (e) => {
      if (!hasFiles(e) || e.target.closest(cardSel)) return;
      e.preventDefault(); e.hqHandled = true; hot(col, false);
      openDrop({ customerId: isNew ? '__new' : null, files: [...e.dataTransfer.files], auto: true });
    });
  });
}

const WAIT = { red: ['us'], yellow: ['supplier', 'contractor'], green: ['customer'] };
const dueSteps = (c) => openActions(c.id).filter((a) => a.due && a.due <= todayISO());
const LABEL = { ...STATUS_TEXT, due: 'Due today / late' };
const COURT = { us: 'Our court', customer: "Customer's court", supplier: "Supplier's court", contractor: "Contractor's court" };
function focusPanel(k) {
  const t = todayISO();
  const leads = S.customers.filter((c) => !c.lost && (k === 'due' ? dueSteps(c).length : status(c).k === k));
  const rows = [];
  leads.forEach((c) => {
    const st = status(c);
    const acts = k === 'due' ? dueSteps(c) : openActions(c.id).filter((a) => WAIT[k].includes(a.waiting_on));
    if (!acts.length) rows.push({ c, title: st.why, due: null, who: st.who || (k === 'green' ? 'customer' : k === 'yellow' ? 'supplier' : 'us') });
    acts.forEach((a) => rows.push({ c, title: a.title, due: a.due, who: a.waiting_on }));
  });
  rows.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  return `<section class="focus-panel st-${k} ${listOpen ? 'open' : ''}" aria-label="${esc(LABEL[k])}">
    <div class="fh"><span class="dot"></span><h3>${esc(LABEL[k])}: ${leads.length} lead${leads.length === 1 ? '' : 's'}</h3>${rows.length ? `<button class="btn sm" type="button" id="fList" aria-expanded="${listOpen}">${listOpen ? 'Hide list ▴' : `Show ${rows.length} step${rows.length === 1 ? '' : 's'} ▾`}</button>` : ''}<span class="grow"></span><button class="btn sm" type="button" id="fClear">✕ Show all leads</button></div>
    ${!listOpen ? '' : '<div class="focus-list">' + (rows.map((r) => `<div class="focus-row" data-id="${r.c.id}" tabindex="0"><span class="fwho">${esc(r.c.name || 'No name')}</span><span class="ft">${esc(r.title)}</span><span class="court c-${r.who}">${COURT[r.who] || ''}</span><span class="due ${r.due && r.due < t ? 'late' : ''}">${r.due ? (r.due < t ? 'Late · ' : '') + fmtDate(r.due) : ''}</span></div>`).join('') || '<p class="small muted">Nothing here. Nice.</p>') + '</div>'}
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
/* Race: each salesperson's car moves left → right on revenue PAID this month (resets on the 1st). */
export function paidDay(c) {
  if (c.paid?.at) return c.paid.at.slice(0, 10);
  const mv = S.logs.filter((l) => l.customer_id === c.id && l.kind === 'system' && /→ Paid\b|→ paid\b/.test(l.summary || '')).sort((a, b) => b.at.localeCompare(a.at))[0];
  return mv ? mv.at.slice(0, 10) : null;
}
export function monthRevenue(month) {
  const rows = [];
  for (const p of S.payments) if (p.status === 'applied' && (p.paid_date || '').startsWith(month)) rows.push({ cid: p.customer_id, amt: Number(p.amount) || 0, day: p.paid_date, how: 'QuickBooks' });
  for (const c of S.customers) {
    const other = Number(c.paid?.other) || (c.paid && c.paid.qb == null ? Number(c.paid.amount) || 0 : 0);
    const d = paidDay(c);
    if (other > 0 && d && d.startsWith(month)) rows.push({ cid: c.id, amt: other, day: d, how: c.paid?.at ? 'entered' : 'entered (date = moved to Paid)' });
  }
  return rows.map((r) => ({ ...r, c: S.customers.find((x) => x.id === r.cid) })).filter((r) => r.c);
}
export function renderRace(v) {
  const t = todayISO(); const month = t.slice(0, 7);
  const mName = new Date(t + 'T12:00').toLocaleString('en-US', { month: 'long' });
  const dim = new Date(+t.slice(0, 4), +t.slice(5, 7), 0).getDate(); const day = +t.slice(8, 10);
  const rows = monthRevenue(month);
  const people = S.profiles.filter((p) => p.role !== 'tv');
  const isMine = (c, id) => (id === 'none' ? !c.owner || !people.some((p) => p.id === c.owner) : c.owner === id);
  const ids = [...people.map((p) => p.id), ...(rows.some((r) => isMine(r.c, 'none')) ? ['none'] : [])];
  const lanes = ids.map((id) => {
    const mine = rows.filter((r) => isMine(r.c, id));
    const pit = S.customers.filter((c) => !c.lost && isMine(c, id) && ['accepted', 'ordered'].includes(c.stage) && !received(c));
    const total = mine.reduce((a, r) => a + r.amt, 0);
    const jobs = new Set(mine.map((r) => r.cid)).size;
    return { id, name: id === 'none' ? 'Unassigned' : (people.find((p) => p.id === id)?.name || 'Someone'), total, jobs, avg: jobs ? total / jobs : 0, best: Math.max(0, ...mine.map((r) => r.amt)), pitVal: pit.reduce((a, c) => a + value(c), 0), pitN: pit.length };
  }).sort((a, b) => b.total - a.total || b.pitVal - a.pitVal);
  const goal = Number(settings().raceGoal) || 0;
  const leader = lanes[0]?.total || 0;
  const far = Math.max(leader, ...lanes.map((l) => l.total + l.pitVal));
  const finish = goal || Math.max(10000, Math.ceil(far * 1.1 / 5000) * 5000);
  const team = lanes.reduce((a, l) => a + l.total, 0);
  const pct = (x) => Math.min(97, (x / finish) * 100);
  const pace = (day / dim) * 100;
  const left = dim - day;
  const CARS = ['#c0392b', '#2471a3', '#d4a017', '#1e8449', '#7d3c98', '#ca6f1e'];
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  v.innerHTML = `
  <div class="gp-top">
    <div><div class="gp-kicker">TCRS Grand Prix</div><h2>${esc(mName)} race</h2></div>
    <div class="gp-stats">
      <div class="gp-stat"><span>Team paid</span><b>${money0(team)}</b></div>
      <div class="gp-stat"><span>Laps left</span><b>${left} day${left === 1 ? '' : 's'}</b></div>
      <div class="gp-stat"><span>Finish line</span><b>${money0(finish)}</b>${goal ? '' : '<i>auto</i>'}</div>
      ${canWrite() ? `<button class="btn sm" type="button" id="rGoal">${goal ? 'Change goal' : 'Set monthly goal'}</button>` : ''}
    </div>
  </div>
  <p class="small muted gp-sub">Thrust = revenue <b>paid</b> since ${esc(mName)} 1. Resets on the 1st. Ghost car = accepted or ordered jobs not paid yet (fuel in the pit).${goal ? ' The dashed line is the pace car: where you need to be today to hit the goal.' : ''}</p>
  <section class="gp-track" style="--pace:${pace}%">
    ${lanes.map((l, i) => {
      const col = l.id === 'none' ? '#7f8c8d' : CARS[people.findIndex((p) => p.id === l.id) % CARS.length];
      const gap = i > 0 && leader ? leader - l.total : 0;
      return `<div class="gp-lane">
      <div class="gp-pos"><b>P${i + 1}</b>${i === 0 && l.total ? '<span title="Leader">🏆</span>' : ''}</div>
      <div class="gp-road" title="${esc(l.name)}: ${money0(l.total)} paid in ${esc(mName)}">
        <div class="gp-start"></div><div class="gp-dash"></div>
        ${goal ? '<div class="gp-pace"><span>pace</span></div>' : ''}
        <div class="gp-finish"></div>
        ${l.pitVal ? `<div class="gp-car ghost" style="--x:${pct(l.total + l.pitVal)}%;--c:${col}" title="${l.pitN} accepted/ordered, not paid yet: ${money0(l.pitVal)}"><span class="gp-body"></span></div>` : ''}
        <div class="gp-trail" style="--x:${pct(l.total)}%;--c:${col}"></div>
        <div class="gp-car ${pct(l.total) > 70 ? 'tagleft' : ''}" style="--x:${pct(l.total)}%;--c:${col}"><span class="gp-body"><span class="gp-num">${esc(initials(l.name))}</span></span><span class="gp-tag"><b>${esc(l.name)}</b> ${money0(l.total)}</span></div>
      </div>
      <div class="gp-info">
        <span><b>${l.jobs}</b> paid job${l.jobs === 1 ? '' : 's'}</span>
        ${l.jobs ? `<span>avg ${money0(l.avg)}</span><span>best ${money0(l.best)}</span>` : ''}
        ${gap ? `<span class="gp-gap">−${money0(gap)} to P1</span>` : ''}
        ${l.pitVal ? `<span class="gp-pit">⛽ ${money0(l.pitVal)} in the pit (${l.pitN})</span>` : ''}
      </div>
    </div>`;
    }).join('') || '<p class="muted">No salespeople yet. Invite them under Prices &amp; partners → Settings.</p>'}
    <div class="gp-scale small muted"><span>$0</span><span>${money0(finish / 2)}</span><span>🏁 ${money0(finish)}</span></div>
  </section>
  <section class="panel race-log"><h3>Lap log: paid in ${esc(mName)}</h3>
    ${rows.length ? `<table class="simple"><tbody>${rows.sort((a, b) => b.day.localeCompare(a.day)).map((r) => `<tr data-id="${r.cid}"><td>${fmtDate(r.day)}</td><td><b>${esc(r.c.name || '')}</b></td><td class="muted small">${esc(personName(r.c.owner) || 'Unassigned')} · ${esc(r.how)}</td><td class="n">${money0(r.amt)}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">Nothing paid yet this month. QuickBooks payments land here by themselves; payments typed in by hand count on the day entered or the day the job moved to Paid.</p>'}
    <p class="small muted" style="margin:8px 0 0">Wrong driver on a job? Open the customer and change <b>Salesperson</b> (Contact panel).</p>
  </section>`;
  // cars roll out from the start line
  const cars = $$('.gp-car, .gp-trail', v);
  cars.forEach((el) => el.classList.add('at-start'));
  requestAnimationFrame(() => requestAnimationFrame(() => cars.forEach((el) => el.classList.remove('at-start'))));
  $$('.race-log tr[data-id]', v).forEach((r) => (r.onclick = () => (location.hash = 'c-' + r.dataset.id)));
  $('#rGoal', v)?.addEventListener('click', () => {
    const b = document.createElement('div'); b.className = 'sheet-bg top-modal';
    b.innerHTML = `<div class="modal narrow"><div class="modal-h"><h2>Monthly goal per salesperson</h2><button class="x" type="button" aria-label="Close">×</button></div><div class="modal-b"><label class="field"><span class="lbl">Paid revenue per person per month ($)</span><input type="text" inputmode="decimal" id="gv" value="${goal || ''}" placeholder="e.g. 40000"></label><p class="small muted">Sets the finish line and the pace car. Leave blank to scale to the leader.</p><button class="btn primary" type="button" id="gok">Save</button></div></div>`;
    document.body.appendChild(b);
    const close = () => b.remove(); b.querySelector('.x').onclick = close; b.onclick = (e) => { if (e.target === b) close(); };
    b.querySelector('#gok').onclick = async () => { const n = Number(String(b.querySelector('#gv').value).replace(/[^0-9.]/g, '')) || null; const row = S.settings.find((r) => r.id === 'main'); await D.upsert('settings', { id: 'main', data: { ...(row?.data || {}), raceGoal: n } }); close(); };
  });
}


/* ───────── Office TV (40–55" seen from 8–15 ft): money · race · next 7 days ───────── */
let tvTimers = [];
let wakeLock = null;
export function renderTV(v) {
  const t = todayISO();
  const live = S.customers.filter((c) => !c.lost);
  const open = live.filter((c) => isPrePaid(c));
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
        if (s.k === 'installed') cs = cs.filter((c) => openActions(c.id).length || (c.updated_at || '') >= thirty.slice(0, 10));
        cs.sort((a, b) => (a.first_contact || '').localeCompare(b.first_contact || ''));
        return `<div class="tv-lane ${i === STAGES.length - 1 ? 'fin' : ''}"><div class="tv-lh">${i === STAGES.length - 1 ? '🏁 ' : ''}${esc(s.short)} <b>${cs.length}</b></div>
          ${cs.map((c) => { const st = status(c); const d = keyDates(c); return `<div class="tv-car st-${st.k}"><div class="n">${esc(c.name || 'No name')}</div><div class="p">${esc((c.products || []).map((p) => PROD_SHORT[p] || p).join(' · ') || '—')}</div>${d.length ? `<div class="k">${d.map((x) => `<span class="${x.warn ? 'warn' : ''}">${esc(x.text)}</span>`).join('')}</div>` : ''}</div>`; }).join('')}
</div>`;
      }).join('')}
    </section>
    <section class="tv-week"><div class="tv-wh">Next 7 days</div>
      <div class="tv-ev">${events.slice(0, 10).map((e) => `<div class="ev ${e.k.toLowerCase()}"><span class="when">${esc(dayLbl(e.d))}</span><span class="what">${esc(e.k)}</span><span class="evn">${esc(e.c.name || '')}</span></div>`).join('') || '<div class="tv-s" style="font-size:20px">No measures, deliveries or installs scheduled.</div>'}${events.length > 10 ? `<div class="ev"><span class="what">+${events.length - 10} more</span></div>` : ''}</div>
    </section>
  </div>`;

  fitTV();
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
/* TV: every card stays on screen. Shrink cards step by step until no stage overflows. */
const TV_DENSITY = ['full', 'compact', 'slim', 'mini', 'micro'];
function fitTV() {
  const race = document.querySelector('.tv-race'); if (!race) return;
  const over = () => [...race.querySelectorAll('.tv-lane')].some((l) => l.scrollHeight > l.clientHeight + 1);
  for (const d of TV_DENSITY) { race.dataset.d = d; if (!over()) break; }
}
window.addEventListener('resize', () => { if (document.body.classList.contains('tv')) { clearTimeout(fitTV.t); fitTV.t = setTimeout(fitTV, 200); } });
function addDaysISO(iso, k) { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10); }

/* Fit every card on screen without page scrolling: full → compact → mini cards. Phones get stage rows of name pills. */
const DENSITY = ['full', 'compact', 'slim', 'mini'];
export function fitView(v) {
  const wrap = v.querySelector('.board-wrap, .race-wrap');
  if (!wrap || document.body.classList.contains('tv')) return;
  const inner = wrap.firstElementChild;
  const phone = innerWidth <= 700;
  inner.classList.toggle('phone', phone);
  if (phone) { wrap.style.height = ''; inner.dataset.d = 'mini'; return; }
  const main = wrap.closest('main');
  const padB = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
  const avail = Math.max(260, Math.floor(innerHeight - wrap.getBoundingClientRect().top - padB - 6));
  wrap.style.height = avail + 'px';
  for (const d of DENSITY) { inner.dataset.d = d; if (inner.scrollHeight <= wrap.clientHeight + 1) break; }
}
let fitT;
window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { const w = document.querySelector('.board-wrap, .race-wrap'); if (w) fitView(w.parentElement); }, 150); });
