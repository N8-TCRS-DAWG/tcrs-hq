// Jarvis: walk up, say "brief me", see the business as a live constellation.
// Admin → key numbers + the moves that matter. Sales → your day.
// The map is drawn from HQ data (never invented) and updates live; Claude only narrates and picks what to highlight.
import * as D from './data.js?v=20261113003207';
import { S, esc, money0, status, isPrePaid, openActions, todayISO, daysBetween } from './core.js?v=20261113003207';
import { value, received } from './board.js?v=20261113003207';

const D3 = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
const HUBS = [
  { id: 'h-ours', label: 'Our move', k: 'ours' },
  { id: 'h-theirs', label: 'Their move', k: 'theirs' },
  { id: 'h-sup', label: 'Suppliers & crews', k: 'sup' },
  { id: 'h-won', label: 'Won', k: 'won' },
];
const PRODS = ['Cabinets', 'Countertops', 'Flooring', 'Appliances', 'Furniture', 'Doors & trim', 'Garage doors', 'Sauna / plunge'];
const J = { idleT: null, tourT: null, sim: null, svg: null, focus: new Set(), view: 'all', listening: false, speaking: false, busy: false, said: '', moves: [], started: false, unsub: null, rec: null };

/* ───────── data ───────── */
function bucket(c) {
  if (!isPrePaid(c) || c.stage === 'accepted') return 'won';
  const k = status(c).k;
  return k === 'red' ? 'ours' : k === 'yellow' ? 'sup' : 'theirs';
}
const lastContact = (c) => S.logs.filter((l) => l.customer_id === c.id && l.kind !== 'system').reduce((m, l) => (l.at > m ? l.at : m), '');
function late(c) { return openActions(c.id).filter((a) => a.waiting_on === 'us' && a.due && a.due < todayISO()); }
function snapshot() {
  const t = todayISO(), m = t.slice(0, 7);
  const live = S.customers.filter((c) => !c.lost);
  const open = live.filter((c) => isPrePaid(c) && c.stage !== 'accepted');
  const won = live.filter((c) => bucket(c) === 'won');
  const ours = open.filter((c) => bucket(c) === 'ours');
  const quiet = open.filter((c) => { const l = lastContact(c); return bucket(c) === 'theirs' && l && daysBetween(l.slice(0, 10), t) >= 5; });
  const decided = won.length + S.customers.filter((c) => c.lost).length;
  return {
    open, won, ours, quiet,
    pipeline: open.reduce((s, c) => s + value(c), 0),
    collected: live.filter((c) => String(c.paid?.at || '').startsWith(m)).reduce((s, c) => s + received(c), 0),
    winRate: decided ? Math.round(won.length / decided * 100) : null,
    lateN: open.reduce((s, c) => s + late(c).length, 0),
    newWeek: live.filter((c) => c.first_contact && daysBetween(c.first_contact, t) <= 7).length,
  };
}
function graph() {
  const nodes = [{ id: 'core', type: 'core', r: 26, label: 'TCRS' }];
  const links = [];
  HUBS.forEach((h) => { nodes.push({ id: h.id, type: 'hub', r: 9, label: h.label, k: h.k }); links.push({ source: 'core', target: h.id, kind: 'spine' }); });
  const used = new Set();
  for (const c of S.customers.filter((x) => !x.lost)) {
    const v = value(c), b = bucket(c);
    nodes.push({ id: c.id, type: 'cust', r: 4 + Math.min(16, Math.sqrt(v || 0) / 9), label: c.name || 'No name', k: b, v, late: late(c).length > 0, c });
    links.push({ source: 'h-' + b, target: c.id, kind: 'hub' });
    (c.products || []).filter((p) => PRODS.includes(p)).forEach((p) => { used.add(p); links.push({ source: c.id, target: 'p-' + p, kind: 'prod' }); });
  }
  PRODS.filter((p) => used.has(p)).forEach((p) => nodes.push({ id: 'p-' + p, type: 'prod', r: 3, label: p }));
  return { nodes, links };
}

/* ───────── voice ───────── */
function speak(text) {
  J.said = text; paintSub(text);
  if (!window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = speechSynthesis.getVoices().find((x) => /en[-_]GB/i.test(x.lang) && /male|daniel|arthur|george/i.test(x.name)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
  if (v) u.voice = v;
  u.rate = 1.03; u.pitch = 0.92;
  u.onstart = () => { J.speaking = true; orbState(); };
  u.onend = u.onerror = () => { J.speaking = false; orbState(); };
  speechSynthesis.speak(u);
}
function listen() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { paintSub('Voice input needs Chrome or Edge. Type your question below.'); document.getElementById('jvIn')?.focus(); return; }
  if (J.listening) { J.rec?.stop(); return; }
  speechSynthesis?.cancel();
  const r = new Rec(); J.rec = r;
  r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
  let final = '';
  r.onresult = (e) => { final = [...e.results].map((x) => x[0].transcript).join(''); paintSub('“' + final + '”', true); };
  r.onend = () => { J.listening = false; orbState(); if (final.trim()) ask(final.trim()); };
  r.onerror = () => { J.listening = false; orbState(); };
  J.listening = true; orbState(); paintSub('Listening…', true);
  r.start();
}

/* ───────── Claude ───────── */
const SYS = `You are Jarvis, the calm voice of TCRS HQ (Twin Cities Remodeling Supply: cabinets, countertops, flooring, appliances; Minnesota). The person is standing at a screen showing a live map of every open lead.
Return ONLY JSON {"say":"what you speak aloud","focus":["customer ids to light up on the map"],"moves":[{"id":"customer id or null","text":"short action line, max 9 words"}],"view":"all|ours|theirs|sup|won"}.
"say": natural spoken sentences, 2-5 sentences, under 90 words, no lists, no markdown, no ids, round money ("about twelve thousand dollars"). Lead with the single most important thing.
For a morning brief: role admin → the 2-3 numbers that matter today (pipeline, collected this month, what's late) then the top moves. Role sales → their day: what's late, who to call first, who went quiet.
For a question: answer it from the data, light up the relevant customers, and set view to the bucket that best shows them.
moves: up to 4, most money or urgency first. Use only the data given; if something isn't in it, say so briefly. Never invent customers, numbers or dates.`;
function context() {
  const s = snapshot(), t = todayISO();
  const rows = S.customers.filter((c) => !c.lost).map((c) => {
    const l = lastContact(c); const acts = openActions(c.id).slice(0, 3).map((a) => `${a.title} (${a.waiting_on}${a.due ? ', due ' + a.due : ''})`).join('; ');
    return `${c.id} | ${c.name} | ${bucket(c)} | ${c.stage} | $${Math.round(value(c))}${received(c) ? ' paid $' + Math.round(received(c)) : ''} | last contact ${l ? daysBetween(l.slice(0, 10), t) + 'd ago' : 'none'} | ${(c.products || []).join('/')}${acts ? ' | ' + acts : ''}`;
  }).join('\n');
  const me = S.profiles.find((p) => p.id === S.me?.id);
  return `Today ${t}. Speaking to ${me?.name || 'the salesperson'} (role ${S.role}).\nOpen pipeline $${Math.round(s.pipeline)} across ${s.open.length} open leads; collected this month $${Math.round(s.collected)}; win rate ${s.winRate ?? 'n/a'}%; ${s.lateN} late steps on us; ${s.quiet.length} quiet leads; ${s.newWeek} new leads in 7 days.\nCustomers (id | name | bucket | stage | value | last contact | products | open steps):\n${rows}`;
}
function localBrief() {
  const s = snapshot();
  const top = [...s.ours].sort((a, b) => late(b).length - late(a).length || value(b) - value(a)).slice(0, 3);
  const big = [...s.open].sort((a, b) => value(b) - value(a))[0];
  const say = S.role === 'admin'
    ? `Open pipeline is about ${money0(s.pipeline)} across ${s.open.length} leads, with ${money0(s.collected)} collected this month. ${s.ours.length} leads are waiting on us${s.lateN ? `, ${s.lateN} steps late` : ''}.${big ? ` The biggest open deal is ${big.name}.` : ''}`
    : `${s.ours.length} leads are waiting on you${s.lateN ? `, ${s.lateN} steps late` : ''}. ${s.quiet.length} have gone quiet.${top[0] ? ` Start with ${top[0].name}.` : ''}`;
  return { say, focus: top.map((c) => c.id), moves: top.map((c) => ({ id: c.id, text: (late(c)[0] || openActions(c.id)[0])?.title || 'Next step' })), view: 'ours' };
}
async function ask(q) {
  if (J.busy) return;
  J.busy = true; orbState(); paintSub(q ? `“${q}”` : 'Reading the board…', true);
  let j = null;
  try {
    const out = await D.ai({ system: SYS, content: [{ type: 'text', text: `${context()}\n\n${q ? 'QUESTION: ' + q : 'MORNING BRIEF, please.'}` }], model: 'default', max_tokens: 900 });
    j = JSON.parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0]);
  } catch { j = q ? { say: "I can't reach Claude right now, so I can only show the map. Here's what's waiting on us.", ...localBrief(), } : localBrief(); }
  J.busy = false;
  const ids = new Set(S.customers.map((c) => c.id));
  J.focus = new Set((j.focus || []).filter((id) => ids.has(id)));
  J.view = ['all', 'ours', 'theirs', 'sup', 'won'].includes(j.view) ? j.view : 'all';
  J.moves = (j.moves || []).slice(0, 4).map((m) => ({ ...m, id: ids.has(m.id) ? m.id : null }));
  paintMoves(); applyFocus(); orbState();
  speak(String(j.say || '').slice(0, 900));
}

/* ───────── screen ───────── */
function loadD3() {
  if (window.d3) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = D3; s.onload = res; s.onerror = () => rej(new Error('Could not load the map library')); document.head.appendChild(s); });
}
const greet = () => { const h = new Date().getHours(); const me = (S.profiles.find((p) => p.id === S.me?.id)?.name || '').split(' ')[0]; return `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}${me ? ', ' + me : ''}.`; };
function kpis() {
  const s = snapshot();
  const k = S.role === 'admin'
    ? [['Open pipeline', money0(s.pipeline)], ['Collected · ' + new Date().toLocaleDateString('en-US', { month: 'short' }), money0(s.collected)], ['Win rate', s.winRate == null ? '—' : s.winRate + '%'], ['Waiting on us', s.ours.length + (s.lateN ? ` · ${s.lateN} late` : '')], ['Gone quiet', String(s.quiet.length)]]
    : [['Waiting on you', String(s.ours.length)], ['Late steps', String(s.lateN)], ['Gone quiet', String(s.quiet.length)], ['New this week', String(s.newWeek)]];
  const el = document.getElementById('jvK'); if (!el) return;
  el.innerHTML = k.map(([l, v]) => `<div class="jv-k"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
}
function paintSub(t, dim) { const el = document.getElementById('jvSub'); if (el) { el.textContent = t; el.classList.toggle('dim', !!dim); } }
function paintMoves() {
  const el = document.getElementById('jvMoves'); if (!el) return;
  el.innerHTML = J.moves.length ? `<div class="jv-h">Moves</div>` + J.moves.map((m, i) => `<button type="button" class="jv-m" data-id="${m.id || ''}"><i>${i + 1}</i><span>${esc(m.text)}${m.id ? `<em>${esc(S.customers.find((c) => c.id === m.id)?.name || '')}</em>` : ''}</span></button>`).join('') : '';
  el.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { if (b.dataset.id) { J.focus = new Set([b.dataset.id]); applyFocus(); } }));
}
function orbState() {
  const o = document.getElementById('jvOrb'); if (!o) return;
  o.classList.toggle('listen', J.listening); o.classList.toggle('speak', J.speaking); o.classList.toggle('think', J.busy);
  o.setAttribute('aria-label', J.listening ? 'Stop listening' : 'Talk to Jarvis');
}
function applyFocus() {
  if (!J.svg) return;
  const on = (d) => d.type !== 'cust' || ((J.view === 'all' || d.k === J.view) && (!J.focus.size || J.focus.has(d.id)));
  J.svg.selectAll('g.n').classed('dim', (d) => !on(d)).classed('hot', (d) => J.focus.has(d.id));
  J.svg.selectAll('g.n text').attr('opacity', (d) => (d.type !== 'cust' ? 1 : J.focus.has(d.id) || (d.v >= 8000 && on(d)) ? 1 : 0));
  J.svg.selectAll('line').attr('opacity', (l) => (l.kind === 'prod' ? (J.focus.has(l.source.id) ? 0.55 : 0.06) : l.kind === 'hub' ? (on(l.target) ? 0.28 : 0.05) : 0.4));
}
function draw() {
  const host = document.getElementById('jvMap'); if (!host || !window.d3) return;
  const d3 = window.d3, W = host.clientWidth, H = host.clientHeight;
  const { nodes, links } = graph();
  const prev = new Map((J.sim?.nodes() || []).map((n) => [n.id, n]));
  nodes.forEach((n) => { const p = prev.get(n.id); if (p) { n.x = p.x; n.y = p.y; n.vx = p.vx; n.vy = p.vy; } });
  const R = Math.min(W, H) * 0.3;
  nodes.forEach((n) => {
    if (n.type === 'core') { n.fx = W / 2; n.fy = H / 2; }
    if (n.type === 'hub') { const i = HUBS.findIndex((h) => h.id === n.id); const a = -Math.PI * 3 / 4 + i * Math.PI / 2; n.fx = W / 2 + Math.cos(a) * W * 0.24; n.fy = H / 2 + Math.sin(a) * H * 0.27; }
  });
  const prods = nodes.filter((n) => n.type === 'prod');
  prods.forEach((n, i) => { const a = -Math.PI / 2 + (i + 0.5) * 2 * Math.PI / prods.length; n.fx = W / 2 + Math.cos(a) * W * 0.44; n.fy = H / 2 + Math.sin(a) * H * 0.43; });
  host.innerHTML = '';
  const svg = d3.select(host).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Map of open leads by whose move it is');
  svg.append('defs').html('<filter id="jvGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
  svg.append('ellipse').attr('cx', W / 2).attr('cy', H / 2).attr('rx', W * 0.24 * 1.414).attr('ry', H * 0.27 * 1.414).attr('class', 'jv-ring');
  svg.append('ellipse').attr('cx', W / 2).attr('cy', H / 2).attr('rx', W * 0.44).attr('ry', H * 0.43).attr('class', 'jv-ring faint');
  const L = svg.append('g').selectAll('line').data(links).join('line').attr('class', (d) => 'l-' + d.kind);
  const N = svg.append('g').selectAll('g.n').data(nodes, (d) => d.id).join('g').attr('class', (d) => `n t-${d.type} k-${d.k || ''}${d.late ? ' late' : ''}`);
  N.append('circle').attr('r', (d) => d.r).attr('filter', (d) => (d.type === 'prod' ? null : 'url(#jvGlow)'));
  N.filter((d) => d.late).append('circle').attr('class', 'pulse').attr('r', (d) => d.r + 4);
  N.append('text').attr('dy', (d) => (d.type === 'core' ? 4 : d.type === 'hub' ? -16 : d.r + 12)).attr('text-anchor', 'middle').text((d) => (d.type === 'cust' ? d.label.split(/[–-]/)[0].trim().slice(0, 22) : d.label));
  N.filter((d) => d.type === 'cust').on('click', (e, d) => { J.focus = new Set([d.id]); applyFocus(); paintSub(`${d.label} — ${d.c.stage}, ${money0(d.v)}. ${openActions(d.id)[0]?.title || ''}`); }).on('dblclick', (e, d) => { location.hash = 'c-' + d.id; });
  N.filter((d) => d.type === 'hub').on('click', (e, d) => { J.view = J.view === d.k ? 'all' : d.k; J.focus.clear(); applyFocus(); });
  J.svg = svg;
  J.sim?.stop();
  J.sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => (l.kind === 'spine' ? R : l.kind === 'hub' ? 40 + l.target.r * 2.2 : 160)).strength((l) => (l.kind === 'prod' ? 0.004 : l.kind === 'hub' ? 0.7 : 0)))
    .force('charge', d3.forceManyBody().strength((d) => (d.type === 'prod' ? -40 : -34)))
    .force('collide', d3.forceCollide((d) => d.r + 6))
    
    .alpha(prev.size ? 0.25 : 1).alphaDecay(0.03)
    .on('tick', () => {
      nodes.forEach((n) => { n.x = Math.max(30, Math.min(W - 30, n.x)); n.y = Math.max(24, Math.min(H - 24, n.y)); });
      L.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      N.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
  applyFocus();
}

/* ───────── ambient tour (office screen): after 45 s untouched, walk the board slowly ───────── */
const HUBNAME = { ours: 'Waiting on us', theirs: 'Waiting on customers', sup: 'Waiting on suppliers & crews', won: 'Won jobs' };
function stopTour(reset) {
  clearTimeout(J.idleT); clearInterval(J.tourT);
  if (J.tourT && reset) { J.tourT = null; J.view = 'all'; J.focus.clear(); applyFocus(); paintSub(J.said || 'Tap the orb or press Space and say “brief me”.'); }
  J.tourT = null;
  J.idleT = setTimeout(startTour, 45000);
}
function startTour() {
  if (!document.getElementById('jvRoot')) return;
  if (J.speaking || J.listening || J.busy) { stopTour(false); return; }
  const stops = () => {
    const s = snapshot();
    const top = [...s.open].sort((a, b) => value(b) - value(a)).slice(0, 8);
    return [{ hub: 'ours' }, ...top.slice(0, 4).map((c) => ({ c })), { hub: 'theirs' }, ...top.slice(4).map((c) => ({ c })), { hub: 'won' }];
  };
  let i = 0;
  const step = () => {
    const list = stops(); if (!list.length || !J.svg) return;
    const st = list[i++ % list.length];
    if (st.hub) {
      const n = S.customers.filter((c) => !c.lost && bucket(c) === st.hub).length;
      J.view = st.hub; J.focus.clear();
      paintSub(`${HUBNAME[st.hub]} · ${n}`, true);
    } else {
      const c = st.c, a = openActions(c.id)[0];
      J.view = 'all'; J.focus = new Set([c.id]);
      paintSub(`${c.name} — ${c.stage}${value(c) ? ', ' + money0(value(c)) : ''}. ${a ? 'Next: ' + a.title + (a.due ? ' (due ' + a.due.slice(5) + ')' : '') : 'No next step set.'}`, true);
    }
    applyFocus();
  };
  step(); J.tourT = setInterval(step, 9000);
}

export function renderJarvis(v) {
  document.body.classList.add('jv-on');
  if (!document.getElementById('jvRoot')) {
    v.innerHTML = `<div class="jv" id="jvRoot">
      <div class="jv-top"><span class="jv-brand">JARVIS <i>·</i> TCRS HQ</span><span class="jv-clock" id="jvClock"></span><a class="jv-x" href="#board" aria-label="Leave Jarvis">Esc</a></div>
      <div class="jv-greet" id="jvGreet">${esc(greet())}</div>
      <div class="jv-map" id="jvMap"></div>
      <aside class="jv-side"><div class="jv-kpis" id="jvK"></div><div id="jvMoves"></div></aside>
      <div class="jv-legend"><span class="k-ours">Our move</span><span class="k-theirs">Their move</span><span class="k-sup">Suppliers & crews</span><span class="k-won">Won</span><span class="lt">◌ late</span></div>
      <div class="jv-bottom">
        <p class="jv-sub" id="jvSub">Tap the orb or press Space and say “brief me”.</p>
        <button class="jv-orb" id="jvOrb" type="button" aria-label="Talk to Jarvis"><span></span></button>
        <form id="jvF" class="jv-f"><input id="jvIn" placeholder="…or type a question" autocomplete="off" aria-label="Ask Jarvis"></form>
      </div>
    </div>`;
    const root = document.getElementById('jvRoot');
    root.querySelector('#jvOrb').onclick = () => { if (!J.started) { J.started = true; ask(''); } else listen(); };
    root.querySelector('#jvF').onsubmit = (e) => { e.preventDefault(); const i = root.querySelector('#jvIn'); const q = i.value.trim(); if (q) { i.value = ''; J.started = true; ask(q); } };
    const tick = () => { const c = document.getElementById('jvClock'); if (!c) return; c.textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); setTimeout(tick, 15000); };
    tick();
    if (!J.keys) {
      J.keys = true;
      document.addEventListener('keydown', (e) => {
        if (!document.getElementById('jvRoot')) return;
        if (document.activeElement?.id === 'jvIn') return;
        if (e.code === 'Space') { e.preventDefault(); document.getElementById('jvOrb').click(); }
        else if (e.key === 'Escape') { speechSynthesis?.cancel(); location.hash = 'board'; }
      });
      window.addEventListener('resize', () => { if (document.getElementById('jvRoot')) draw(); });
      window.addEventListener('hashchange', () => { if (location.hash !== '#jarvis') { clearTimeout(J.idleT); clearInterval(J.tourT); J.tourT = null; document.body.classList.remove('jv-on'); speechSynthesis?.cancel(); J.rec?.stop(); J.sim?.stop(); J.svg = null; } });
    }
    loadD3().then(draw).catch((e) => paintSub(e.message));
    ['pointerdown', 'keydown'].forEach((ev) => root.addEventListener(ev, () => stopTour(true), true));
    if (!J.tourKeys) { J.tourKeys = true; document.addEventListener('keydown', () => { if (document.getElementById('jvRoot')) stopTour(true); }, true); }
    stopTour(false);
  } else if (window.d3) draw();   // live data changed → redraw in place, positions kept
  kpis(); paintMoves(); orbState();
}
