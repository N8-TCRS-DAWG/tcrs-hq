// Data layer: Supabase when configured, otherwise a demo store in this browser.
export const TABLES = ['customers','actions','logs','files','sizes','layouts','quotes','pricebook','partners','docs','feedback','settings','profiles','payments'];

const cfg = window.HQ_CONFIG || {};
export const isDemo = !(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);

let sb = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const saved = () => { try { document.dispatchEvent(new CustomEvent('hq-saved')); } catch {} };
function emit(table) { listeners.forEach((fn) => { try { fn(table); } catch (e) { console.error(e); } }); }

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

/* ───────── demo store ───────── */
const DEMO_KEY = 'tcrs-hq-demo-v1';
let demo = null;
const demoBlobs = new Map();
function demoLoad() {
  try { demo = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { demo = null; }
  if (!demo) { demo = {}; TABLES.forEach((t) => (demo[t] = [])); demo.__seeded = false; }
  TABLES.forEach((t) => (demo[t] = demo[t] || []));
}
function demoSave() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(demo)); } catch (e) { console.warn('demo save failed', e); }
}

export async function init() {
  if (isDemo) {
    demoLoad();
    const me = { id: 'demo-user', email: 'demo@example.com' };
    if (!demo.profiles.find((p) => p.id === me.id)) demo.profiles.push({ id: me.id, name: 'Demo user', role: 'admin' });
    demoSave();
    return { user: me, demo: true, needsSeed: !demo.__seeded };
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
  return { user: data.session?.user || null, demo: false };
}
export function markSeeded() { if (isDemo) { demo.__seeded = true; demoSave(); } }

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user;
}
export async function signOut() { if (sb) await sb.auth.signOut(); }
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(error.message);
}
export async function setPassword(pw) {
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) throw new Error(error.message);
}

export async function all(table) {
  if (isDemo) return demo[table].map((r) => ({ ...r }));
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export async function insert(table, row) {
  const now = new Date().toISOString();
  if (isDemo) {
    const r = { id: row.id || uuid(), created_at: now, updated_at: now, ...row };
    demo[table].push(r); demoSave(); emit(table); saved(); return { ...r };
  }
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  emit(table);
  saved();
  return data;
}

export async function update(table, id, patch) {
  const withTime = ['customers','layouts','quotes','pricebook','partners','docs','settings'].includes(table) ? { ...patch, updated_at: new Date().toISOString() } : patch;
  if (isDemo) {
    const r = demo[table].find((x) => x.id === id);
    if (!r) throw new Error('Not found');
    Object.assign(r, withTime); demoSave(); emit(table); saved(); return { ...r };
  }
  const { data, error } = await sb.from(table).update(withTime).eq('id', id).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  emit(table);
  saved();
  return data;
}

export async function upsert(table, row) {
  if (isDemo) {
    const r = demo[table].find((x) => x.id === row.id);
    if (r) Object.assign(r, row); else demo[table].push({ ...row });
    demoSave(); emit(table); saved(); return row;
  }
  const { data, error } = await sb.from(table).upsert(row).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  emit(table);
  saved();
  return data;
}

export async function rpc(fn, args) {
  if (isDemo) { if (fn === 'hq_recalc_paid') demoRecalc(args.cid); return null; }
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  emit('customers'); emit('actions');
  return data;
}
function demoRecalc(cid) {
  const c = demo.customers.find((x) => x.id === cid); if (!c) return;
  const ps = demo.payments.filter((p) => p.customer_id === cid && p.status === 'applied');
  const qb = ps.reduce((a, p) => a + Number(p.amount), 0);
  const prev = c.paid || {};
  const other = prev.other != null ? Number(prev.other) : (prev.qb != null ? 0 : Number(prev.amount) || 0);
  c.paid = qb + other > 0 ? { amount: qb + other, qb, other, method: qb && other ? 'QuickBooks + other' : qb ? 'QuickBooks' : prev.method, at: ps.map((p) => p.paid_date).sort().pop() || prev.at, ref: [...new Set(ps.map((p) => p.invoice_no))].join(', ') || prev.ref } : null;
  if (c.paid) { c.data = { ...(c.data || {}) }; delete c.data.paidUnknown; }
  demoSave(); emit('customers');
}

export async function remove(table, id) {
  if (isDemo) { demo[table] = demo[table].filter((x) => x.id !== id); demoSave(); emit(table); saved(); return; }
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw new Error(`${table}: ${error.message}`);
  emit(table);
  saved();
}

/* ───────── files ───────── */
export async function upload(file, path) {
  if (isDemo) {
    demoBlobs.set(path, URL.createObjectURL(file));
    return path;
  }
  const { error } = await sb.storage.from('files').upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error('Upload failed: ' + error.message);
  return path;
}
const urlCache = new Map();
export async function fileUrl(path) {
  if (isDemo) return demoBlobs.get(path) || '';
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('files').createSignedUrl(path, 3600);
  if (error) return '';
  urlCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
export async function fileBlob(path) {
  if (isDemo) { const u = demoBlobs.get(path); if (!u) return null; return await (await fetch(u)).blob(); }
  const { data, error } = await sb.storage.from('files').download(path);
  if (error) return null;
  return data;
}

/* ───────── Claude ───────── */
export async function ai({ system, content, model = 'default', max_tokens = 6000 }) {
  if (typeof window.__HQ_MOCK_AI === 'function') return window.__HQ_MOCK_AI({ system, content, model, max_tokens }); // test hook
  if (isDemo) throw new Error('Claude reading works once HQ is connected to Supabase. Demo mode fills the Check screen by hand.');
  const { data, error } = await sb.functions.invoke('hq-ai', { body: { system, content, model, max_tokens } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.text || '';
}

/* ───────── live updates ───────── */
let pollTimer = null;
export function startLive() {
  if (isDemo) {
    window.addEventListener('storage', (e) => { if (e.key === DEMO_KEY) { demoLoad(); TABLES.forEach(emit); } });
    return;
  }
  try {
    sb.channel('hq-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, (p) => emit(p.table))
      .subscribe();
  } catch (e) { console.warn('realtime off', e); }
  clearInterval(pollTimer);
  pollTimer = setInterval(() => TABLES.forEach(emit), 90 * 1000); // safety net for the TV
}

export { uuid };
