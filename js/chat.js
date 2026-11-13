// Chat updates: type or speak plain English ("Bri approved the quote, install the 18th") and the right
// customer files update. Claude proposes the changes; one tap applies them; Undo puts everything back.
import * as D from './data.js?v=20261112192956';
import { S, STAGES, esc, $, todayISO, openActions, toast, canWrite, status, isPrePaid, daysBetween } from './core.js?v=20261112192956';

const FIELDS = ['name', 'phone', 'email', 'address', 'city', 'zip', 'source', 'ctype', 'budget', 'timeline', 'finishes', 'measure_date', 'delivery_date', 'install_date', 'est_price'];
const SYSTEM = `You update TCRS (Twin Cities Remodeling Supply) customer files from a salesperson's quick note (typed or dictated, may be messy).
The salesperson may also ASK about the business instead of giving an update (e.g. "brief me", "who's waiting on me?", "what's quiet?", "how much is in the pipeline?", "what should I do first?").
For a question: return ops [] and put the answer in "reply" — plain text, at most 8 short lines, most important first, use customer names and real numbers from the data only. For "brief me" / "what should I do": (1) steps waiting on us that are due or overdue, (2) customers quiet longest whose move it is, (3) biggest open deals, (4) one suggested first move. Never invent numbers; say "not in HQ" when the data doesn't have it.
Return ONLY JSON:
{"reply":"one short sentence saying what you'll change (or what you need) — or, for a question, the answer",
 "ops":[{"customerId":"id from the list, or NEW for a brand-new lead",
   "name":"customer name for display",
   "fields":{},
   "products_add":[],"services_add":[],
   "stage":null,
   "tldr":null,
   "log":"one-line history note starting with who did what, e.g. 'Bri approved QT030290 by phone'",
   "who":"us|customer|supplier|contractor",
   "actions_add":[{"title":"","due":"YYYY-MM-DD|null","whose":"us|customer|supplier|contractor"}],
   "actions_done":["open step ids now finished"],
   "lost":null}],
 "questions":[]}
Rules:
- fields may only use: ${FIELDS.join(', ')}. Dates YYYY-MM-DD. Money as numbers. Only what the note states.
- stage only if the note says so or clearly implies it. Keys: ${STAGES.map((s) => `${s.k} (${s.label})`).join(', ')}. Any order is allowed.
- tldr: rewrite the customer's TL;DR only if the note changes the project picture; else null.
- lost: {"reason":"Price|Went elsewhere|No response|Project cancelled / postponed|Other","note":""} only when the note says the lead is dead.
- whose on steps = who must act next. If the note says something is done, put the matching open step id in actions_done.
- If you can't tell which customer, return no ops and ask in questions. Never invent customers, numbers or dates.`;

let box = null, hist = [], last = null;
let speak = false; try { speak = localStorage.getItem('hq-speak') === '1'; } catch {}
function say(text) { if (!speak || !window.speechSynthesis || !text) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text).slice(0, 600)); u.rate = 1.05; speechSynthesis.speak(u); }
const lines = (t) => esc(t).replace(/\n/g, '<br>');

export function wireChat() {
  if (!canWrite() || document.getElementById('chatFab')) return;
  const fab = document.createElement('button');
  fab.id = 'chatFab'; fab.type = 'button'; fab.className = 'chat-fab'; fab.title = 'Chat: ask about the business or update any lead in plain English (C, or speak)';
  fab.innerHTML = '<span aria-hidden="true">💬</span> Chat';
  fab.onclick = () => (box ? closeChat() : openChat());
  document.body.appendChild(fab);
  document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (e.ctrlKey || e.metaKey || e.altKey || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) || a?.isContentEditable || document.querySelector('.top-modal, .sheet-bg')) return;
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); box ? $('#chT', box)?.focus() : openChat(); }
  });
}

function currentCustomer() {
  const h = location.hash.replace('#', '');
  return h.startsWith('c-') ? S.customers.find((c) => c.id === h.slice(2)) : null;
}

function openChat() {
  box = document.createElement('section');
  box.className = 'chat-box'; box.setAttribute('aria-label', 'Update leads');
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  box.innerHTML = `<div class="chat-h"><b>Chat</b><button class="btn ghost sm" type="button" id="chSay" title="Read answers aloud" aria-pressed="${speak}">${speak ? '🔊' : '🔈'}</button><span class="small muted" id="chCtx"></span><button class="x" type="button" aria-label="Close">×</button></div>
    <div class="chat-log" id="chLog">${hist.length ? '' : `<p class="small muted">Ask anything ("brief me", "who owes us a reply?") or tell me an update, e.g. "Bri approved the quote, install the 18th" · "Seham's garage door is dead, went elsewhere" · "New lead: Tom 612-555-0100, wants a vanity in Edina".</p>`}</div>
    <div class="chat-chips">${['Brief me', 'Who is waiting on me?', 'What has gone quiet?', 'Biggest open deals'].map((q) => `<button type="button" class="chip pick" data-q="${q}">${q}</button>`).join('')}</div>
    <form class="chat-in" id="chF"><textarea id="chT" rows="2" placeholder="Ask, or tell me what happened"></textarea>
      ${Rec ? '<button class="btn sm" type="button" id="chMic" title="Speak">🎤</button>' : ''}
      <button class="btn primary sm" type="submit">Send</button></form>`;
  document.body.appendChild(box);
  hist.forEach(addMsgEl);
  const c = currentCustomer();
  $('#chCtx', box).textContent = c ? '· about ' + (c.name || 'this customer') + ' unless you say otherwise' : '';
  $('.x', box).onclick = closeChat;
  const t = $('#chT', box);
  t.focus();
  box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => send(b.dataset.q)));
  $('#chSay', box).onclick = (e) => { speak = !speak; try { localStorage.setItem('hq-speak', speak ? '1' : ''); } catch {} e.currentTarget.textContent = speak ? '🔊' : '🔈'; e.currentTarget.setAttribute('aria-pressed', String(speak)); if (!speak) speechSynthesis?.cancel(); };
  t.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chF', box).requestSubmit(); } };
  $('#chF', box).onsubmit = (e) => { e.preventDefault(); const v = t.value.trim(); if (v) { t.value = ''; send(v); } };
  if (Rec) {
    let rec = null;
    $('#chMic', box).onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
      const base = t.value ? t.value + ' ' : '';
      rec.onresult = (ev) => { t.value = base + [...ev.results].map((r) => r[0].transcript).join(''); };
      rec.onend = () => { rec = null; $('#chMic', box)?.classList.remove('on'); };
      rec.onerror = () => toast('Couldn\'t hear that. Check the mic permission.');
      $('#chMic', box).classList.add('on'); rec.start();
    };
  }
}
function closeChat() { box?.remove(); box = null; }

function addMsg(m) { hist.push(m); hist = hist.slice(-20); if (box) addMsgEl(m); }
function addMsgEl(m) {
  const log = $('#chLog', box);
  if (!log) return;
  if (log.querySelector('p.muted') && hist.length) log.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'chat-m ' + m.from;
  el.innerHTML = m.html || esc(m.text);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function brief() {
  const cur = currentCustomer();
  const rows = S.customers.filter((c) => !c.lost || c.id === cur?.id).map((c) => {
    const acts = openActions(c.id).map((a) => `[${a.id}] ${a.title} (${a.waiting_on}${a.due ? ', due ' + a.due : ''})`).join('; ');
    const last = S.logs.filter((l) => l.customer_id === c.id && l.kind !== 'system').reduce((m, l) => (l.at > m ? l.at : m), '');
    const val = Math.max(Number(c.est_price) || Number(c.budget) || 0, Number(c.paid?.amount) || 0);
    return `${c.id} | ${c.name || ''} | ${c.phone || ''} | ${c.email || ''} | ${c.city || ''} | stage ${c.stage}${c.lost ? ' (LOST)' : ''} | ${status(c).k === 'red' ? "our move" : status(c).k === 'green' ? 'their move' : status(c).k === 'yellow' ? 'waiting on supplier/contractor' : 'done'}${val ? ' | value $' + Math.round(val) : ''}${c.paid?.amount ? ' | paid $' + Math.round(c.paid.amount) : ''}${last ? ' | last contact ' + last.slice(0, 10) + ' (' + daysBetween(last.slice(0, 10), todayISO()) + 'd ago)' : ''}${(c.products || []).length ? ' | ' + c.products.join('/') : ''}${acts ? ' | open: ' + acts : ''}`;
  });
  return `${cur ? `The salesperson has this customer open: ${cur.id} (${cur.name}). Assume the note is about them unless it names someone else.\n` : ''}Customers:\n${rows.join('\n')}`;
}

function recent() {
  const r = hist.slice(-7, -1).filter((m) => m.text).map((m) => `${m.from === 'me' ? 'Salesperson' : 'HQ'}: ${String(m.text).slice(0, 400)}`);
  return r.length ? `\nRecent chat (for follow-up questions only):\n${r.join('\n')}\n` : '';
}
async function send(text) {
  addMsg({ from: 'me', text });
  const wait = addMsgEl({ from: 'bot', html: '<span class="spin"></span> Thinking…' });
  let j;
  try {
    const out = await D.ai({ system: SYSTEM, content: [{ type: 'text', text: `Today is ${todayISO()}.\n${brief()}\n${recent()}\nNOTE: ${text}` }], model: 'default', max_tokens: 2000 });
    j = JSON.parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0]);
  } catch (e) {
    wait?.remove(); addMsg({ from: 'bot', text: 'Couldn\'t read that: ' + e.message }); return;
  }
  wait?.remove();
  const ops = (j.ops || []).filter((o) => o.customerId === 'NEW' || S.customers.some((c) => c.id === o.customerId));
  if (!ops.length) { const t = [j.reply, ...(j.questions || [])].filter(Boolean).join('\n') || 'I couldn\'t tell which customer. Say their name?'; addMsg({ from: 'bot', text: t, html: lines(t) }); say(t); return; }
  const lines = ops.map((o) => `<li><b>${esc(o.customerId === 'NEW' ? 'New lead: ' + (o.name || '') : S.customers.find((c) => c.id === o.customerId)?.name || o.name)}</b><ul>${describe(o).map((d) => `<li>${esc(d)}</li>`).join('')}</ul></li>`).join('');
  const el = addMsgEl({ from: 'bot', html: `${esc(j.reply || '')}<ul class="chat-ops">${lines}</ul>${(j.questions || []).length ? `<p class="small">${esc(j.questions.join(' '))}</p>` : ''}<div class="row"><button class="btn primary sm" type="button" data-apply>Apply ✓</button><button class="btn sm" type="button" data-skip>Skip</button></div>` });
  hist.push({ from: 'bot', html: esc(j.reply || '') + '<ul class="chat-ops">' + lines + '</ul>' });
  const ap = el.querySelector('[data-apply]');
  ap.focus();
  ap.onclick = async () => {
    ap.disabled = true;
    try { last = await apply(ops); el.querySelector('.row').innerHTML = '<span class="small" style="color:var(--green);font-weight:700">Applied.</span> <button class="btn ghost sm" type="button" data-undo>Undo</button>'; el.querySelector('[data-undo]').onclick = undo; }
    catch (e) { toast('Couldn\'t apply: ' + e.message); ap.disabled = false; }
  };
  el.querySelector('[data-skip]').onclick = () => el.querySelector('.row').remove();
}

function describe(o) {
  const d = [];
  Object.entries(o.fields || {}).forEach(([k, v]) => FIELDS.includes(k) && v != null && v !== '' && d.push(`${k.replace('_', ' ')} → ${v}`));
  if ((o.products_add || []).length) d.push('products + ' + o.products_add.join(', '));
  if ((o.services_add || []).length) d.push('services + ' + o.services_add.join(', '));
  if (o.stage) d.push('stage → ' + (STAGES.find((s) => s.k === o.stage)?.label || o.stage));
  if (o.lost) d.push('mark lost (' + (o.lost.reason || 'Other') + ')');
  (o.actions_done || []).forEach((id) => { const a = S.actions.find((x) => x.id === id); if (a) d.push('✓ done: ' + a.title); });
  (o.actions_add || []).forEach((a) => a?.title && d.push(`+ step: ${a.title}${a.due ? ' (' + a.due + ')' : ''} · ${a.whose || 'us'}`));
  if (o.tldr) d.push('TL;DR updated');
  if (o.log) d.push('history: ' + o.log);
  return d;
}

async function apply(ops) {
  const undoList = [];
  for (const o of ops) {
    let c = S.customers.find((x) => x.id === o.customerId);
    const patch = {};
    Object.entries(o.fields || {}).forEach(([k, v]) => { if (FIELDS.includes(k) && v != null && v !== '') patch[k] = v; });
    if (!c) {
      c = await D.insert('customers', { name: o.name || patch.name || 'New lead', ...patch, products: o.products_add || [], services: o.services_add || [], stage: STAGES.some((s) => s.k === o.stage) ? o.stage : 'new', first_contact: todayISO(), source: patch.source || null, tldr: o.tldr || null });
      undoList.push(['remove', 'customers', c.id]);
    } else {
      if ((o.products_add || []).length) patch.products = [...new Set([...(c.products || []), ...o.products_add])];
      if ((o.services_add || []).length) patch.services = [...new Set([...(c.services || []), ...o.services_add])];
      if (o.stage && STAGES.some((s) => s.k === o.stage) && o.stage !== c.stage) patch.stage = o.stage;
      if (o.tldr) patch.tldr = o.tldr;
      if (o.lost) patch.lost = { reason: o.lost.reason || 'Other', note: o.lost.note || '', at: new Date().toISOString() };
      if (Object.keys(patch).length) {
        const before = {}; Object.keys(patch).forEach((k) => (before[k] = c[k] ?? null));
        await D.update('customers', c.id, patch);
        undoList.push(['update', 'customers', c.id, before]);
      }
    }
    for (const id of o.actions_done || []) {
      if (S.actions.some((a) => a.id === id && a.customer_id === c.id && !a.done)) { await D.update('actions', id, { done: true, done_at: new Date().toISOString() }); undoList.push(['update', 'actions', id, { done: false, done_at: null }]); }
    }
    for (const a of (o.actions_add || []).slice(0, 5)) {
      if (!a?.title) continue;
      const r = await D.insert('actions', { customer_id: c.id, title: a.title, due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : null, waiting_on: ['us', 'customer', 'supplier', 'contractor'].includes(a.whose) ? a.whose : 'us', done: false, owner: S.me?.id });
      undoList.push(['remove', 'actions', r.id]);
    }
    const lg = await D.insert('logs', { customer_id: c.id, kind: 'note', at: new Date().toISOString(), summary: o.log || 'Update via chat', who: ['us', 'customer', 'supplier', 'contractor'].includes(o.who) ? o.who : null, by: S.me?.id });
    undoList.push(['remove', 'logs', lg.id]);
  }
  return undoList;
}

async function undo() {
  if (!last) return;
  for (const [op, t, id, before] of [...last].reverse()) {
    try { op === 'remove' ? await D.remove(t, id) : await D.update(t, id, before); } catch (e) { console.warn(e); }
  }
  last = null;
  toast('Undone.');
  addMsg({ from: 'bot', text: 'Undone — everything is back the way it was.' });
}
