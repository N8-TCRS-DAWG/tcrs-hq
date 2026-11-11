// Boot, login, top bar, routing, live refresh.
import * as D from './data.js?v=20261111163514';
import { S, $, esc, toast, todayISO, addDays } from './core.js?v=20261111163514';
import { wireChat } from './chat.js?v=20261111163514';
import { renderCRM } from './crm.js?v=20261111163514';
import { renderBoard, renderRace, renderTV } from './board.js?v=20261111163514';
import { openCustomer, refreshCustomer, closeCustomer, currentCustomerId } from './customer.js?v=20261111163514';
import { openDrop, dropOpen, addToDrop } from './drop.js?v=20261111163514';
import { renderHelp, renderBrain } from './help.js?v=20261111163514';
import { renderAgents } from './agents.js?v=20261111163514';

import { BUILD } from './version.js?v=20261111163514';
const app = $('#app');

/* Updates: if a newer HQ is published, reload (TV) or offer a one-click reload. */
async function checkVersion() {
  try {
    const t = await (await fetch('js/version.js?x=' + Date.now(), { cache: 'no-store' })).text();
    const live = (t.match(/BUILD = '(\d+)'/) || [])[1];
    if (!live || live === BUILD) return;
    if (document.body.classList.contains('tv')) { location.reload(); return; }
    if (document.getElementById('updBar')) return;
    const b = document.createElement('div');
    b.id = 'updBar'; b.className = 'upd-bar';
    b.innerHTML = '<span>A newer version of HQ is ready.</span><button type="button" class="btn primary sm">Reload now</button>';
    b.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(b);
  } catch {}
}
setInterval(checkVersion, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });

/* Never fail silently: show what broke and a reload button. */
window.addEventListener('error', (e) => {
  if (!e.message || document.getElementById('errBar')) return;
  const b = document.createElement('div');
  b.id = 'errBar'; b.className = 'upd-bar err';
  b.innerHTML = `<span>Something went wrong on this screen: ${esc(e.message).slice(0, 140)}</span><button type="button" class="btn sm">Reload</button>`;
  b.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(b);
});
const VIEWS = { board: 'Board', race: 'Race', crm: 'CRM', agents: 'AI team', help: 'Help & SOPs', brain: 'Prices & partners' };

const AUTH_LINK = (/type=(invite|recovery|signup|magiclink)/.exec(location.hash) || [])[1] || null;
const AUTH_ERR = /error_description=([^&]+)/.exec(location.hash)?.[1];
async function boot() {
  let res;
  try { res = await D.init(); } catch (e) { app.innerHTML = `<div class="login"><h2>Can't start HQ</h2><p>${esc(e.message)}</p></div>`; return; }
  S.demo = res.demo;
  if (AUTH_ERR) { renderLogin(); const m = document.getElementById('msg'); if (m) m.textContent = decodeURIComponent(AUTH_ERR.replace(/\+/g, ' ')) + ' — ask an admin to send a new invite, or use "Forgot password".'; history.replaceState(null, '', location.pathname); return; }
  if (!res.user) return renderLogin();
  if (AUTH_LINK === 'invite' || AUTH_LINK === 'recovery') { history.replaceState(null, '', location.pathname); return renderSetPassword(res.user, AUTH_LINK); }
  S.me = res.user;
  await loadAll();
  const prof = S.profiles.find((p) => p.id === S.me.id);
  S.role = prof?.role || 'sales';
  if (S.demo && res.needsSeed) { await seedDemo(); D.markSeeded(); await loadAll(); }
  if (S.role === 'tv' && location.hash !== '#tv') location.hash = 'tv';
  D.onChange(onData);
  D.startLive();
  checkVersion();
  wireChat();
  if (S.role !== 'tv') { wireAnywhere(); wireSaveState(); }
  window.addEventListener('hashchange', route);
  // TV: click = full screen; Esc leaves TV mode (except for the TV login)
  document.addEventListener('click', () => { if (document.body.classList.contains('tv') && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('tv') && S.role !== 'tv') location.hash = 'board'; });
  route();
}

async function loadAll() {
  const res = await Promise.allSettled(D.TABLES.map((t) => D.all(t)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') S[D.TABLES[i]] = r.value; else console.warn(r.reason); });
}

const pending = new Set();
let timer = null;
function onData(table) {
  pending.add(table);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ts = [...pending]; pending.clear();
    await Promise.all(ts.map(async (t) => { try { S[t] = await D.all(t); } catch (e) { console.warn(e); } }));
    rerender();
  }, 250);
}

let deferred = false;
function busy() {
  const a = document.activeElement;
  return a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.type !== 'checkbox' && a.type !== 'file';
}
export function rerender() {
  if (busy()) {
    if (!deferred) { deferred = true; document.addEventListener('focusout', () => { deferred = false; setTimeout(rerender, 50); }, { once: true }); }
    return;
  }
  renderView();
  if (currentCustomerId()) refreshCustomer();
}

function viewKey() {
  const h = location.hash.replace('#', '');
  if (h === 'tv') return 'tv';
  if (h.startsWith('c-')) return 'board';
  return VIEWS[h] ? h : 'board';
}

function route() {
  const h = location.hash.replace('#', '');
  document.body.classList.toggle('tv', h === 'tv');
  if (h === 'tv') document.documentElement.dataset.theme = 'dark'; else if (document.documentElement.dataset.theme === 'dark' && !window.__userTheme) delete document.documentElement.dataset.theme;
  renderView();
  if (h.startsWith('c-')) openCustomer(h.slice(2));
  else if (currentCustomerId()) closeCustomer(true);
}

function shell(active) {
  const flow = ['board', 'race', 'crm', 'agents', 'help', 'brain'].map((k) =>
    `<a href="#${k}" class="${active === k ? 'on' : ''}">${VIEWS[k]}</a>`).join('');
  const me = S.profiles.find((p) => p.id === S.me?.id);
  return `
  <header class="top">
    <a href="#board" aria-label="TCRS HQ home"><img class="logo" src="img/logo-green.png" alt="Twin Cities Remodeling Supply"></a>
    <nav class="flow" aria-label="Main">${flow}</nav>
    ${S.role !== 'tv' ? '<button class="drop-btn" id="dropBtn" type="button" title="Drop files, emails or notes (D). You can also drag files or paste anywhere."><span aria-hidden="true">⬆</span> Drop</button>' : ''}
    <button class="who" id="whoBtn" type="button" title="Sign out">${esc(me?.name || S.me?.email || '')} · ${esc(S.role)}</button>
  </header>
  ${S.demo ? '<div class="banner"><b>Demo mode.</b> Data stays in this browser only, and Claude reading is off. Add the Supabase keys to config.js to go live. Example customers are marked "Example".</div>' : ''}
  <main id="view"></main>`;
}

function renderView() {
  const k = viewKey();
  if (!$('#view') || app.dataset.view !== k) {
    app.dataset.view = k;
    app.innerHTML = k === 'tv' ? '<main id="view"></main>' : shell(k);
    $('#dropBtn')?.addEventListener('click', () => openDrop({ customerId: currentCustomerId() }));
    $('#whoBtn')?.addEventListener('click', whoMenu);
  }
  const v = $('#view');
  if (k === 'board') renderBoard(v);
  else if (k === 'race') renderRace(v, false);
  else if (k === 'tv') renderTV(v);
  else if (k === 'crm') renderCRM(v);
  else if (k === 'agents') renderAgents(v);
  else if (k === 'help') renderHelp(v);
  else if (k === 'brain') renderBrain(v);
}

/* Drop from anywhere: drag files onto the window, paste text/screenshots outside a field, keyboard shortcuts. */
function wireAnywhere() {
  let veil = null, depth = 0;
  const show = () => {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'drag-veil';
    const c = S.customers.find((x) => x.id === currentCustomerId());
    const onBoard = !c && ['board', 'race'].includes(viewKey());
    if (onBoard) veil.classList.add('lite');
    veil.innerHTML = onBoard
      ? '<div><b>Drop on a card to update that customer</b><span>Drop on <b>New lead</b> to start a new lead · anywhere else: Claude decides</span></div>'
      : `<div><b>Drop to add${c ? ' to ' + esc(c.name || 'this customer') : ''}</b><span>Photos, layouts, PDFs, scans, emails</span></div>`;
    document.body.appendChild(veil);
  };
  const hide = () => { veil?.remove(); veil = null; depth = 0; };
  window.addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; depth++; show(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) hide(); });
  window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    hide();
    if (!files.length || e.hqHandled) return;
    e.preventDefault();
    if (dropOpen()) addToDrop(files); else openDrop({ customerId: currentCustomerId(), files });
  });
  document.addEventListener('paste', (e) => {
    const a = document.activeElement;
    if (dropOpen() || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) || a?.isContentEditable) return;
    const files = [...(e.clipboardData?.files || [])];
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!files.length && !text.trim()) return;
    e.preventDefault();
    openDrop({ customerId: currentCustomerId(), files: files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type })), text });
    toast('Pasted into the Drop.');
  });
  document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (e.ctrlKey || e.metaKey || e.altKey || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) || document.querySelector('.top-modal')) return;
    if (e.key === 'd' || e.key === 'D') { e.preventDefault(); openDrop({ customerId: currentCustomerId() }); }
    else if (e.key === '/' && !currentCustomerId()) { const q = $('#bq'); if (q) { e.preventDefault(); q.focus(); } }
    else if (e.key === 'n' && !currentCustomerId()) { e.preventDefault(); openDrop({ manual: true }); }
  });
}

function wireSaveState() {
  const el = document.createElement('div');
  el.className = 'save-state'; el.setAttribute('role', 'status');
  document.body.appendChild(el);
  let t;
  const flash = (msg, err) => { el.textContent = msg; el.classList.toggle('err', !!err); el.classList.add('show'); clearTimeout(t); t = setTimeout(() => el.classList.remove('show'), err ? 6000 : 1400); };
  document.addEventListener('hq-saved', () => flash('✓ Saved'));
  window.addEventListener('unhandledrejection', (e) => { flash('Not saved: ' + (e.reason?.message || 'check your connection'), true); });
}

function whoMenu() {
  if (S.demo) { toast('Demo mode has no logins.'); return; }
  const b = document.createElement('div');
  b.className = 'sheet-bg';
  b.innerHTML = `<div class="sheet narrow"><div class="sheet-h"><h2>Your login</h2><button class="x" type="button" aria-label="Close">×</button></div>
  <div class="sheet-b"><div class="row"><span class="muted">${esc(S.me.email)}</span><span class="chip">${esc(S.role)}</span></div>
  <div class="row"><input type="password" id="newPw" placeholder="New password (8+ characters)" class="grow"><button class="btn" id="setPw" type="button">Change password</button></div>
  <div class="row"><button class="btn danger" id="out" type="button">Sign out</button></div></div></div>`;
  document.body.appendChild(b);
  b.querySelector('.x').onclick = () => b.remove();
  b.onclick = (e) => { if (e.target === b) b.remove(); };
  b.querySelector('#out').onclick = () => D.signOut();
  b.querySelector('#setPw').onclick = async () => {
    const pw = b.querySelector('#newPw').value;
    if (pw.length < 8) return toast('Use at least 8 characters.');
    try { await D.setPassword(pw); toast('Password changed.'); b.remove(); } catch (e) { toast(e.message); }
  };
}

function renderSetPassword(user, kind) {
  app.innerHTML = `<form class="login" id="pwForm">
    <img src="img/logo-cream.png" alt="Twin Cities Remodeling Supply">
    <h2>${kind === 'invite' ? 'Welcome to TCRS HQ' : 'Choose a new password'}</h2>
    <p class="small muted">${esc(user.email)}</p>
    <label class="field"><span class="lbl">New password (8+ characters)</span><input type="password" id="np1" autocomplete="new-password" required minlength="8"></label>
    <label class="field"><span class="lbl">Type it again</span><input type="password" id="np2" autocomplete="new-password" required minlength="8"></label>
    <button class="btn primary" type="submit">Save password and open HQ</button>
    <p class="small muted" id="msg" role="status"></p>
  </form>`;
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const a = $('#np1').value, b = $('#np2').value;
    if (a.length < 8) { $('#msg').textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { $('#msg').textContent = 'The two passwords don\'t match.'; return; }
    try { await D.setPassword(a); location.hash = ''; location.reload(); } catch (err) { $('#msg').textContent = err.message; }
  };
}

function renderLogin() {
  app.innerHTML = `<form class="login" id="loginForm">
    <img src="img/logo-cream.png" alt="Twin Cities Remodeling Supply">
    <h2>TCRS HQ</h2>
    <label class="field"><span class="lbl">Email</span><input type="email" id="em" autocomplete="username" required></label>
    <label class="field"><span class="lbl">Password</span><input type="password" id="pw" autocomplete="current-password" required></label>
    <button class="btn primary" type="submit">Sign in</button>
    <button class="btn ghost small" type="button" id="forgot">Forgot password? Email me a reset link</button>
    <p class="small muted" id="msg" role="status"></p>
  </form>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    $('#msg').textContent = 'Signing in…';
    try { await D.signIn($('#em').value.trim(), $('#pw').value); location.reload(); }
    catch (err) { $('#msg').textContent = err.message; }
  };
  $('#forgot').onclick = async () => {
    const em = $('#em').value.trim();
    if (!em) { $('#msg').textContent = 'Type your email first.'; return; }
    try { await D.resetPassword(em); $('#msg').textContent = 'Reset link sent. Check your email.'; } catch (err) { $('#msg').textContent = err.message; }
  };
}

/* Demo examples: clearly marked, only in demo mode. */
async function seedDemo() {
  const t = todayISO();
  const mk = async (c, acts = [], logs = []) => {
    const row = await D.insert('customers', { data: {}, products: [], services: [], revisions: 0, intake_complete: false, repeat: false, first_contact: t, ...c });
    for (const a of acts) await D.insert('actions', { customer_id: row.id, done: false, ...a });
    for (const l of logs) await D.insert('logs', { customer_id: row.id, at: new Date().toISOString(), ...l });
    return row;
  };
  await mk({ name: 'Example — Kitchen lead', phone: '(000) 000-0001', city: 'Roseville', products: ['Cabinets', 'Countertops'], stage: 'new', budget: 15000, source: 'Facebook', tldr: 'Example card. Wants white shaker cabinets and quartz for a 12×14 kitchen. Sent 3 photos, no layout yet.' },
    [{ title: 'Send intake form', due: t, waiting_on: 'us' }], [{ kind: 'note', summary: 'Example: first inquiry via Facebook Messenger' }]);
  await mk({ name: 'Example — Basement floor', email: 'example2@example.com', city: 'Maplewood', products: ['Flooring'], stage: 'estimate', first_contact: addDays(t, -9), est_price: 8000, tldr: 'Example card. ~850 sq ft LVP for a basement. Estimate sent, waiting on the tile contractor bid for the bathroom.' },
    [{ title: 'Tile bid from contractor', due: addDays(t, -5), waiting_on: 'contractor' }]);
  await mk({ name: 'Example — Repeat flipper', phone: '(000) 000-0003', city: 'St. Paul', ctype: 'Flipper', repeat: true, products: ['Cabinets', 'Appliances'], stage: 'quote', first_contact: addDays(t, -20), est_price: 24000, install_date: addDays(t, 12), conversion: 5, tldr: 'Example card. Repeat flipper. Quote sent for cabinets + appliance package; waiting on their sign-off.' },
    [{ title: 'Customer to approve quote', due: addDays(t, 2), waiting_on: 'customer' }]);
}

boot();
