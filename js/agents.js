// AI team — DEMO. A scripted simulation with made-up customers.
// It never reads or writes the database, never sends anything, and never calls Claude.
import { $, esc, money0, estRange } from './core.js?v=20261112181532';

/* The team. `real` = what exists in HQ today (kept honest; update as things get built). */
const TEAM = [
  { k: 'voice', icon: '📞', name: 'Receptionist', role: 'Answers and returns phone calls, qualifies the lead', real: 'Not built', tone: 'red', note: 'Needs a phone/voice service. Nothing is chosen or paid for yet.' },
  { k: 'resp', icon: '✉️', name: 'Lead responder', role: 'Replies fast by email or text, asks only for what is missing, books the measure', real: 'Partly built', tone: 'amber', note: 'HQ inbox sweep already drafts the first reply. Booking is not built.' },
  { k: 'est', icon: '📐', name: 'Estimator', role: 'Turns photos, sketches and layouts into sizes and a rough price range', real: 'Partly built', tone: 'amber', note: 'HQ reads files into sizes and has a quick estimate. Only as good as the price book.' },
  { k: 'chase', icon: '🔔', name: 'Follow-up chaser', role: 'Nudges quiet leads and unanswered estimates', real: 'Built 11/12', tone: 'amber', note: 'Writes nudges as Gmail drafts on weekdays. Turns on after one setup step in the Gmail script.' },
  { k: 'disp', icon: '🚚', name: 'Dispatcher', role: 'Drafts supplier orders, lines up installers and delivery', real: 'Not built', tone: 'red', note: 'Orders and scheduling are done by hand today.' },
  { k: 'va', icon: '🧑‍💼', name: 'Human assistant', role: 'A real person. Gets anything the agents are not allowed to answer', real: 'A person', tone: 'grey', note: 'The safety net: complaints, legal/code questions, and anything with no price on file.' },
];
const STG = [['new', 'New'], ['talk', 'Qualified'], ['est', 'Estimate sent'], ['acc', 'Accepted'], ['ord', 'Ordered'], ['paid', 'Paid 🏁']];
/* Minutes a person would spend on each task. These are Claude's assumptions, not measurements. */
export const MIN = { reply: 8, call: 12, estimate: 35, send: 6, nudge: 4, dispatch: 30, handoff: 5 };
const MIN_LABEL = { reply: 'First reply to a new lead', call: 'Phone call + notes', estimate: 'Rough estimate from photos / layout', send: 'Send estimate + book a time', nudge: 'Follow-up nudge', dispatch: 'Supplier order + installer + delivery', handoff: 'Write up a handoff for a person' };

const range = (l) => { const r = estRange(l.cost * 1.25, l.cost, 15, 15); return `${money0(r.lo)}–${money0(r.hi)}`; };
const C = (t, st) => ({ a: 'cust', t, st });
/* Eight made-up leads. Each step: a = who acts, t = what happened, st = new stage, m = task type (for time saved). */
const LEADS = [
  { name: 'Kitchen remodel', src: 'Email', cost: 9800, s: [
    C('Emails 4 kitchen photos: “How much for white shaker cabinets and quartz?”'),
    { a: 'resp', m: 'reply', sec: 42, st: 'talk', t: 'Replied in 42 sec. Thanked them and asked only for what was missing: phone, wall lengths, timeline.' },
    C('Sends wall lengths and a hand sketch.'),
    { a: 'est', m: 'estimate', st: 'est', t: (l) => `Read 4 photos + the sketch → 24 linear ft of cabinets, 52 sq ft of countertop. Rough range ${range(l)}.` },
    { a: 'resp', m: 'send', t: 'Sent the range and offered two measure times. Customer picked Thursday 10 am.' },
    C('“Let’s do it.” Pays the $250 design deposit.', 'acc'),
    { a: 'disp', m: 'dispatch', st: 'ord', t: 'Drafted the cabinet order for the supplier, asked the installer for two dates, booked delivery.' },
    C('Pays the invoice.', 'paid') ] },
  { name: 'Basement floor', src: 'Web form', cost: 4100, s: [
    C('Fills in the intake form: ~850 sq ft of vinyl plank, install wanted.'),
    { a: 'resp', m: 'reply', sec: 35, st: 'talk', t: 'Replied in 35 sec. Form was complete, so no questions — confirmed what happens next.' },
    { a: 'est', m: 'estimate', st: 'est', t: (l) => `850 sq ft + 10% waste, install and trim. Rough range ${range(l)}. Sent.` },
    { a: 'chase', m: 'nudge', gap: 3, t: 'No reply for 3 days → sent nudge #1 (short, no pressure).' },
    { a: 'chase', m: 'nudge', gap: 3, t: 'Still quiet after 4 more days → nudge #2 with a “still interested?” one-tap reply.' },
    C('Replies: “Yes, sorry — go ahead.”', 'acc'),
    { a: 'disp', m: 'dispatch', st: 'ord', t: 'Ordered flooring, booked the install crew for the first open week.' },
    C('Pays the invoice.', 'paid') ] },
  { name: 'Triplex appliances', src: 'Phone', cost: 6200, s: [
    C('Contractor calls: needs 3 appliance packages for a triplex.'),
    { a: 'voice', m: 'call', sec: 4, st: 'talk', t: 'Answered on the first ring. Captured model wish-list, delivery address and deadline; texted a recap.' },
    { a: 'est', m: 'estimate', st: 'est', t: (l) => `Matched the wish-list to stock. Package range ${range(l)}. Sent by text.` },
    C('Approves by text.', 'acc'),
    { a: 'disp', m: 'dispatch', st: 'ord', t: 'Reserved the units and booked one delivery run for all three.' },
    C('Pays the invoice.', 'paid') ] },
  { name: 'Countertops only', src: 'Facebook', cost: 2600, s: [
    C('Messages the Page: “Price for quartz, about 40 sq ft?”'),
    { a: 'resp', m: 'reply', sec: 51, st: 'talk', t: 'Replied in 51 sec. Asked for a photo and whether a sink cutout is needed.' },
    C('Sends one photo.'),
    { a: 'est', m: 'estimate', st: 'est', t: (l) => `41 sq ft + 4" backsplash, 1 sink cutout. Rough range ${range(l)}. Sent.` },
    { a: 'chase', m: 'nudge', gap: 3, t: 'No reply for 3 days → nudge #1.' },
    C('“Went with someone cheaper, thanks.”'),
    { a: 'chase', m: 'nudge', st: 'lost', t: 'Marked lost. Reason logged: price. Thanked them and left the door open.' } ] },
  { name: 'Sauna question', src: 'Phone', cost: 0, s: [
    C('Calls about a 6-person barrel sauna.'),
    { a: 'voice', m: 'call', sec: 5, st: 'talk', t: 'Answered. Customer asks which heater certification the city inspector accepts.' },
    { a: 'va', m: 'handoff', st: 'human', t: '“I don’t have that answer — let me connect you with someone who does.” Passed to a person with the call summary.' } ] },
  { name: 'Delivery complaint', src: 'Email', cost: 0, s: [
    C('Existing customer emails photos of a dented fridge door. Upset.'),
    { a: 'resp', m: 'reply', sec: 38, st: 'talk', t: 'Replied in 38 sec with an apology and “a person will call you today.” Did not offer a fix on its own.' },
    { a: 'va', m: 'handoff', st: 'human', t: 'Rule: complaints and damage go to a person. Passed along with the photos and order history.' } ] },
  { name: 'Garage door', src: 'Web form', cost: 0, s: [
    C('Asks for a price on a 16×7 insulated garage door.'),
    { a: 'resp', m: 'reply', sec: 44, st: 'talk', t: 'Replied in 44 sec and confirmed the size and opener.' },
    { a: 'est', t: 'No costs on file for garage doors → will not guess a price.' },
    { a: 'va', m: 'handoff', st: 'human', t: 'Passed to a person to get a supplier price. Customer told to expect a quote within a day.' } ] },
  { name: 'Repeat flipper', src: 'Text', cost: 14500, s: [
    C('Texts a layout PDF: “Same cabinets as last time, new address.”'),
    { a: 'resp', m: 'reply', sec: 29, st: 'talk', t: 'Replied in 29 sec. Recognized a repeat customer and pulled the last job’s selections.' },
    { a: 'est', m: 'estimate', st: 'est', t: (l) => `Read the layout → 31 cabinet boxes. Rough range ${range(l)}. Sent.` },
    C('“Go.”', 'acc'),
    { a: 'disp', m: 'dispatch', st: 'ord', t: 'Drafted the supplier order from the layout and booked delivery to the new address.' },
    C('Pays the invoice.', 'paid') ] },
];
const MAX_LEADS = 16;   // two passes through the list = one “demo day”

const fresh = () => ({ on: false, speed: 1, n: 0, clock: 8 * 60, spawned: 0, leads: [], feed: [], done: false, rate: 25,
  tasks: {}, last: {}, mins: 0, vaMins: 0, secs: [], handoffs: 0, sold: 0, cogs: 0, won: 0, lost: 0, aiTask: 0.50 });
let A = fresh();
let timer = null;
export const _state = () => A;   // for tests

const clockText = () => { const h = Math.floor(A.clock / 60) % 24, m = A.clock % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
function say(a, lead, text) {
  A.feed.unshift({ at: clockText(), a, lead: lead?.label || '', text });
  if (A.feed.length > 60) A.feed.pop();
}
function spawn() {
  const t = LEADS[A.spawned % LEADS.length];
  const round = Math.floor(A.spawned / LEADS.length);
  A.leads.push({ ...t, id: A.spawned, label: `Example: ${t.name}${round ? ' #' + (round + 1) : ''}`, stage: 'new', i: 0, wait: 0 });
  A.spawned++;
}
function runStep(l) {
  const s = l.s[l.i++];
  const text = typeof s.t === 'function' ? s.t(l) : s.t;
  if (s.st) l.stage = s.st;
  if (s.a !== 'cust') {
    A.tasks[s.a] = (A.tasks[s.a] || 0) + 1;
    A.last[s.a] = { text: `${l.label}: ${text}`, n: A.n };
    if (s.m) { if (s.a === 'va') A.vaMins += MIN[s.m]; else A.mins += MIN[s.m]; }
    if (s.sec) A.secs.push(s.sec);
    if (s.a === 'va') A.handoffs++;
  }
  if (l.stage === 'paid' && s.st === 'paid') { A.sold += l.cost * 1.25; A.cogs += l.cost; A.won++; }
  if (s.st === 'lost') A.lost++;
  l.wait = s.gap || 1;
  say(s.a, l, text);
}
export function tick() {
  A.n++; A.clock += 6;
  if (A.spawned < MAX_LEADS && A.n % 3 === 1) spawn();
  let ran = 0;
  const live = A.leads.filter((l) => l.i < l.s.length);
  for (let k = 0; k < live.length && ran < 2; k++) {
    const l = live[(k + A.n) % live.length];
    if (l.wait > 0) { l.wait--; continue; }
    runStep(l); ran++;
  }
  if (A.spawned >= MAX_LEADS && !A.leads.some((l) => l.i < l.s.length)) {
    A.done = true; setOn(false);
    say('sys', null, 'Demo day finished. Press Reset to run it again.');
  }
  paint();
}
function setOn(on) {
  A.on = on;
  clearInterval(timer); timer = null;
  if (on) timer = setInterval(tick, 1300 / A.speed);
}

/* ───────── screen ───────── */
const icon = (k) => (TEAM.find((t) => t.k === k)?.icon) || (k === 'cust' ? '👤' : '•');
const who = (k) => (TEAM.find((t) => t.k === k)?.name) || (k === 'cust' ? 'Customer' : 'Demo');
function donut(pct) {
  const r = 26, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return `<svg viewBox="0 0 64 64" class="ag-donut" role="img" aria-label="${pct}% handled without a person"><circle cx="32" cy="32" r="${r}" class="bg"/><circle cx="32" cy="32" r="${r}" class="fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="37" text-anchor="middle">${pct}%</text></svg>`;
}
function paint() {
  const root = document.getElementById('agRoot');
  if (!root) return;
  const agentTasks = TEAM.filter((t) => t.k !== 'va').reduce((s, t) => s + (A.tasks[t.k] || 0), 0);
  const closed = A.leads.filter((l) => l.i >= l.s.length).length;
  const noHuman = closed ? Math.round(((closed - A.handoffs) / closed) * 100) : 0;
  const avgSec = A.secs.length ? Math.round(A.secs.reduce((a, b) => a + b, 0) / A.secs.length) : null;
  const hrs = A.mins / 60;
  const open$ = A.leads.filter((l) => ['est', 'acc', 'ord'].includes(l.stage)).reduce((s, l) => s + l.cost * 1.25, 0);
  $('#agGo', root).textContent = A.on ? '⏸ Pause the team' : (A.done ? 'Demo day finished' : (A.n ? '▶ Resume' : '▶ Turn the team on'));
  $('#agGo', root).disabled = A.done;
  $('#agGo', root).classList.toggle('live', A.on);
  $('#agClock', root).textContent = A.n ? `Simulated time ${clockText()}` : 'Not started';
  root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === A.speed));
  $('#agTiles', root).innerHTML = `
    <div class="ag-tile"><b>${A.spawned}</b><span>leads came in</span></div>
    <div class="ag-tile"><b>${avgSec == null ? '—' : avgSec + ' sec'}</b><span>average first reply</span></div>
    <div class="ag-tile"><b>${agentTasks}</b><span>tasks done by agents</span></div>
    <div class="ag-tile"><b>${hrs.toFixed(1)} h</b><span>person-hours saved <i>(assumed)</i>${A.rate ? ` ≈ ${money0(hrs * A.rate)}` : ''}</span></div>
    <div class="ag-tile wide">${donut(noHuman)}<div><b>${closed - A.handoffs} of ${closed}</b><span>finished leads needed no person · ${A.handoffs} handed off</span></div></div>
    <div class="ag-tile"><b>${money0(A.sold)}</b><span>sold · ${money0(open$)} still open</span></div>`;
  const rev = A.sold, aiCost = agentTasks * A.aiTask, vaCost = (A.vaMins / 60) * A.rate;
  const exp = A.cogs + aiCost + vaCost, gross = rev - A.cogs, net = rev - exp;
  const baseline = (A.mins / 60) * A.rate;           // what the same agent work costs if people do it
  const autoCost = aiCost + vaCost;
  const roi = autoCost > 0 ? (baseline - autoCost) / autoCost : null;
  const pct = (x) => (rev > 0 ? Math.max(0, Math.min(100, (x / rev) * 100)) : 0);
  $('#agMoney', root).innerHTML = rev <= 0 ? '<p class="small muted">Money shows up once the first demo project is paid.</p>' : `
    <div class="ag-bars" role="img" aria-label="Revenue ${money0(rev)}, expenses ${money0(exp)}">
      <div class="ag-bar"><span>Revenue</span><div><i class="b-rev" style="width:100%"></i></div><b>${money0(rev)}</b></div>
      <div class="ag-bar"><span>Expenses</span><div><i class="b-cogs" style="width:${pct(A.cogs)}%" title="Product cost ${money0(A.cogs)}"></i><i class="b-ai" style="width:${pct(aiCost)}%" title="AI cost ${money0(aiCost)}"></i><i class="b-va" style="width:${pct(vaCost)}%" title="Assistant time ${money0(vaCost)}"></i></div><b>${money0(exp)}</b></div>
      <div class="ag-bar"><span>Profit</span><div><i class="b-net" style="width:${pct(net)}%"></i></div><b>${money0(net)}</b></div>
      <div class="small muted">Expenses = product cost ${money0(A.cogs)} + AI ${money0(aiCost)} + assistant ${money0(vaCost)}. Rent, trucks and payroll beyond these are not in the demo.</div>
    </div>
    <div class="ag-tiles ag-money-tiles">
      <div class="ag-tile"><b>${rev ? Math.round((gross / rev) * 100) + '%' : '—'}</b><span>gross margin (before AI/assistant)</span></div>
      <div class="ag-tile"><b>${rev ? Math.round((net / rev) * 100) + '%' : '—'}</b><span>profit rate (of revenue)</span></div>
      <div class="ag-tile"><b>${A.won ? money0(net / A.won) : '—'}</b><span>profit per won project (avg)</span></div>
      <div class="ag-tile"><b>${A.spawned ? money0(net / A.spawned) : '—'}</b><span>profit per lead that came in</span></div>
      <div class="ag-tile"><b>${roi == null ? '—' : Math.round(roi * 100) + '%'}</b><span>ROI on automation <i>(assumed)</i></span></div>
      <div class="ag-tile"><b>${money0(autoCost)} vs ${money0(baseline)}</b><span>this work: AI+assistant vs all-people <i>(assumed)</i></span></div>
    </div>`;
  $('#agTeam', root).innerHTML = TEAM.map((t) => {
    const last = A.last[t.k];
    const busy = A.on && last && A.n - last.n <= 1;
    return `<div class="ag-agent${busy ? ' busy' : ''}">
      <div class="ag-a-h"><span class="ag-ic" aria-hidden="true">${t.icon}</span><div><b>${t.name}</b><span class="small muted">${esc(t.role)}</span></div><span class="ag-n" title="Tasks in this demo">${A.tasks[t.k] || 0}</span></div>
      <div class="ag-now small">${last ? esc(last.text) : '<span class="muted">Waiting for work…</span>'}</div>
      <div class="ag-real small"><span class="chip ag-${t.tone}">Today: ${t.real}</span> <span class="muted">${esc(t.note)}</span></div>
    </div>`;
  }).join('');
  const cols = [...STG, ['human', 'With a person'], ['lost', 'Lost']];
  $('#agPipe', root).innerHTML = cols.map(([k, label]) => {
    const ls = A.leads.filter((l) => l.stage === k);
    return `<div class="ag-col ag-s-${k}"><div class="ag-col-h">${label}<span>${ls.length}</span></div><div class="ag-pills">${ls.map((l) => `<span class="ag-pill" title="${esc(l.src)}">${esc(l.label.replace('Example: ', ''))}</span>`).join('')}</div></div>`;
  }).join('');
  $('#agFeed', root).innerHTML = A.feed.length ? A.feed.map((f, i) => `<li class="${i === 0 && A.on ? 'new' : ''} ag-f-${f.a}"><span class="ag-t">${f.at}</span><span class="ag-ic" aria-hidden="true">${icon(f.a)}</span><div><b>${who(f.a)}</b>${f.lead ? ` <span class="muted">· ${esc(f.lead)}</span>` : ''}<br>${esc(f.text)}</div></li>`).join('')
    : '<li class="muted">Nothing yet. Turn the team on and watch the leads come in.</li>';
}

export function renderAgents(v) {
  if (!document.getElementById('agRoot')) {
    v.innerHTML = `<div id="agRoot" class="ag">
      <div class="ag-warn"><b>Demo — simulation only.</b> Made-up customers and scripted events. Nothing is sent, saved, charged, or added to your Board.</div>
      <div class="ag-head">
        <div><h1>AI team</h1><span class="small muted" id="agClock"></span></div>
        <div class="row">
          <button class="btn primary ag-go" id="agGo" type="button"></button>
          <span class="row ag-speed" role="group" aria-label="Speed"><button class="chip pick" data-speed="1" type="button">1×</button><button class="chip pick" data-speed="3" type="button">3×</button><button class="chip pick" data-speed="10" type="button">10×</button></span>
          <button class="btn sm" id="agReset" type="button">Reset</button>
        </div>
      </div>
      <div class="ag-tiles" id="agTiles" aria-live="off"></div>
      <h2>Money — demo numbers, not your books</h2>
      <div id="agMoney"></div>
      <h2>The team</h2>
      <div class="ag-team" id="agTeam"></div>
      <h2>Leads moving through</h2>
      <div class="ag-pipe" id="agPipe"></div>
      <h2>Live activity</h2>
      <ol class="ag-feed" id="agFeed"></ol>
      <details class="ag-assume"><summary>How “hours saved” is counted (assumptions you can challenge)</summary>
        <p class="small muted">Each agent task is credited with the minutes a person would likely spend on it. These minutes are Claude’s assumptions, not measured at TCRS. The reply times, the share of leads handed to a person, and the dollar amounts are scripted for the demo and are not a forecast.</p>
        <table class="ag-tbl">${Object.keys(MIN).map((k) => `<tr><td>${MIN_LABEL[k]}</td><td>${MIN[k]} min</td></tr>`).join('')}</table>
        <p class="small muted">ROI (return on investment) here = (what the agents’ work would cost people − what the AI + assistant cost) ÷ AI + assistant cost. AI cost is assumed at $0.50 per agent task. Demo profit leaves out rent, trucks and the rest of payroll.</p>
        <label class="row small">Value of one person-hour: $<input type="number" id="agRate" min="0" step="1" value="${A.rate}" style="width:72px"> <span class="muted">(assumed; set your own)</span></label>
      </details>
    </div>`;
    const root = document.getElementById('agRoot');
    $('#agGo', root).onclick = () => { setOn(!A.on); if (A.on && !A.n) tick(); else paint(); };
    $('#agReset', root).onclick = () => { const { speed, rate } = A; setOn(false); A = fresh(); A.speed = speed; A.rate = rate; paint(); };
    root.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => { A.speed = +b.dataset.speed; if (A.on) setOn(true); paint(); }));
    $('#agRate', root).oninput = (e) => { A.rate = Math.max(0, parseFloat(e.target.value) || 0); paint(); };
  }
  paint();
}
