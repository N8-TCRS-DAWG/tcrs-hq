// Shared state, helpers and business rules.
import * as D from './data.js?v=20261112181032';

export const S = {
  customers: [], actions: [], logs: [], files: [], sizes: [], layouts: [], quotes: [],
  pricebook: [], partners: [], docs: [], feedback: [], settings: [], profiles: [], payments: [],
  me: null, role: 'sales', demo: false,
};

export const STAGES = [
  { k: 'new', label: 'New lead', short: 'New' },
  { k: 'intake', label: 'Intake', short: 'Intake' },
  { k: 'estimate', label: 'Estimate sent', short: 'Estimate' },
  { k: 'design', label: 'Design ($250 paid)', short: 'Design' },
  { k: 'quote', label: 'Quote sent', short: 'Quote' },
  { k: 'accepted', label: 'Accepted', short: 'Accepted' },
  { k: 'paid', label: 'Paid', short: 'Paid' },
  { k: 'ordered', label: 'Ordered', short: 'Ordered' },
  { k: 'installed', label: 'Delivery + install', short: 'Deliver/install' },
];
// Open pipeline = leads not yet paid. Paid and later = money in.
export const isPrePaid = (c) => stageIdx(c.stage) < STAGES.findIndex((s) => s.k === 'paid');
export const stageIdx = (k) => Math.max(0, STAGES.findIndex((s) => s.k === k));
export const PRODUCTS = ['Cabinets', 'Countertops', 'Flooring', 'Appliances', 'Doors & trim', 'Garage doors', 'Sauna / plunge', 'Furniture', 'Other'];
export const SERVICES = ['Delivery', 'Installation', 'Design / layout', 'Removal'];
export const CTYPES = ['Homeowner', 'Contractor', 'Flipper', 'Landlord', 'Designer'];
export const FTYPES = ['Photo', 'Layout', 'Rendering', 'Supplier quote', 'Contractor quote', 'Estimate', 'Quote', 'Agreement', 'Scan', 'Other'];
export const WHOSE = [
  { k: 'us', label: 'Us', color: 'red' },
  { k: 'supplier', label: 'Supplier', color: 'yellow' },
  { k: 'contractor', label: 'Contractor', color: 'yellow' },
  { k: 'customer', label: 'Customer', color: 'green' },
];

export const DEFAULT_SETTINGS = {
  markupDefault: 25, markupOneOff: 55, markupFloor: 25, referralPct: 15,
  depositAmount: 250, revisionsIncluded: 2, revisionBonusIfIntakeComplete: 1, revisionFee: 200,
  taxRate: null, staleDays: 3, quoteValidDays: 30, estimateRangePct: 15, rangeFloorMarkup: 15,
  scoreWeights: { conversion: 25, budget: 25, repeat: 25, intake: 25 },
  company: {
    name: 'Twin Cities Remodeling Supply',
    address: '5350 Highway 61 N, Suite 1, White Bear Township, MN 55110',
    phone: '(612) 807-0414', email: 'nathan@tcremodelingsupply.com', web: 'tcremodelingsupply.com',
  },
};
export function settings() {
  const row = S.settings.find((r) => r.id === 'main');
  const d = { ...DEFAULT_SETTINGS, ...(row?.data || {}) };
  d.scoreWeights = { ...DEFAULT_SETTINGS.scoreWeights, ...(row?.data?.scoreWeights || {}) };
  d.company = { ...DEFAULT_SETTINGS.company, ...(row?.data?.company || {}) };
  return d;
}

/* ───────── helpers ───────── */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const n = (v) => { if (v === '' || v == null) return null; const x = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(x) ? null : x; };
export const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const money = (x, cents = true) => (x == null || isNaN(x) ? '—' : (x < 0 ? '−' : '') + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }));
export const money0 = (x) => money(x, false);
export const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
export const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso.length <= 10 ? iso + 'T12:00' : iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
export const fmtDateLong = (iso) => { if (!iso) return ''; const d = new Date(iso.length <= 10 ? iso + 'T12:00' : iso); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
export const addDays = (iso, k) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10); };
export const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const personName = (id) => S.profiles.find((p) => p.id === id)?.name || '';

let toastTimer;
export function toast(msg, undo) {
  $('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  if (undo) t.querySelector('button').onclick = () => { t.remove(); undo(); };
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), undo ? 7000 : 3500);
}
export function canWrite() { return S.role === 'admin' || S.role === 'sales'; }

/* ───────── per-customer lookups ───────── */
export const custActions = (cid) => S.actions.filter((a) => a.customer_id === cid);
export const openActions = (cid) => custActions(cid).filter((a) => !a.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
export const custFiles = (cid) => S.files.filter((f) => f.customer_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at));
export const custLogs = (cid) => S.logs.filter((l) => l.customer_id === cid).sort((a, b) => b.at.localeCompare(a.at));
export const custSizes = (cid) => S.sizes.filter((s) => s.customer_id === cid);
export const custLayouts = (cid) => S.layouts.filter((l) => l.customer_id === cid).sort((a, b) => b.version - a.version);
export const custQuote = (cid) => S.quotes.filter((q) => q.customer_id === cid).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;

/* ───────── status color: whose move is it? ───────── */
export function status(c) {
  if (c.lost) return { k: 'none', why: 'Lost' };
  if (c.status_override) return { k: c.status_override, why: 'Set by hand' };
  const open = openActions(c.id);
  const t = todayISO();
  if (c.stage === 'installed' && !open.length) return { k: 'none', why: 'Done' };
  if (c.stage === 'paid' && !open.length) return { k: 'red', why: 'Paid — place the order', who: 'us' };
  if (c.stage === 'ordered' && !open.length) return { k: 'yellow', why: 'Ordered — waiting on delivery date', who: 'supplier' };
  if (open.length) {
    const us = open.find((a) => a.waiting_on === 'us');
    if (us) return { k: 'red', why: us.title, who: 'us' };
    const late = open.filter((a) => a.due && daysBetween(a.due, t) >= 3);
    if (late.length && late.length === open.length) return { k: 'red', why: `Follow up: "${late[0].title}" is ${daysBetween(late[0].due, t)} days late`, who: 'us' };
    const p = open.find((a) => a.waiting_on === 'supplier' || a.waiting_on === 'contractor');
    if (p) return { k: 'yellow', why: p.title, who: p.waiting_on };
    return { k: 'green', why: open[0].title, who: 'customer' };
  }
  // No open steps: read the last real message to see whose court the ball is in.
  const last = S.logs.filter((l) => l.customer_id === c.id && l.kind !== 'system' && l.kind !== 'upload').sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!last) return { k: 'red', why: 'No next step and no history — add the first step', who: 'us' };
  const days = daysBetween(last.at.slice(0, 10), t);
  const from = last.who || logFrom(last.summary || '');
  const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (from === 'customer') return { k: 'red', why: `Customer wrote ${ago} — reply`, who: 'us' };
  if (from === 'supplier' || from === 'contractor') {
    if (partnerAsked(last.summary || '')) return { k: 'yellow', why: `Waiting on ${from} since ${ago}`, who: from };
    return { k: 'red', why: `${from === 'supplier' ? 'Supplier' : 'Contractor'} replied ${ago} — pass it on`, who: 'us' };
  }
  // We spoke last.
  if (/\b(will|going to|plan(s)? to|promised|by (today|tomorrow|eod))\b/i.test(last.summary || '')) return { k: 'red', why: `We promised: ${String(last.summary).slice(0, 90)}`, who: 'us' };
  if (partnerAsked(last.summary || '')) return days > 3 ? { k: 'red', why: `Chase partner: no answer in ${days} days`, who: 'us' } : { k: 'yellow', why: `Asked a partner ${ago}`, who: 'supplier' };
  if (days > 4) return { k: 'red', why: `Follow up: customer quiet ${days} days`, who: 'us' };
  return { k: 'green', why: `We replied ${ago} — their move`, who: 'customer' };
}

/* Who wrote a history line: us / customer / supplier / contractor (best guess from the wording). */
const US_RX = /^(nathan|zuggy|trevor|lee|tcrs|we|i|our)\b|^(sent|replied|followed up|called|texted|emailed|left (a )?voicemail|quoted)\b/i;
const SUP_RX = /\b(j&k|j ?& ?k|twin rivers|supplier|vendor|distributor|warehouse|ge appliance|cabinetry)\b/i;
const CON_RX = /\b(installer|contractor|plumber|electrician|tile (guy|setter)|crew|fabricator)\b/i;
function partnerNames(type) { return S.partners.filter((p) => !type || p.ptype === type).map((p) => p.name?.toLowerCase()).filter((n) => n && n.length > 2); }
export function logFrom(text) {
  const s = String(text).trim();
  const head = s.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
  if (US_RX.test(s)) return 'us';
  if (partnerNames('supplier').some((n) => head.startsWith(n) || head.includes(n)) || SUP_RX.test(head)) return 'supplier';
  if (partnerNames('contractor').some((n) => head.startsWith(n)) || CON_RX.test(head)) return 'contractor';
  return 'customer';
}
function partnerAsked(text) {
  const s = String(text).toLowerCase();
  return US_RX.test(text) && /\b(asked|told|sent to|requested|waiting on|ordered from)\b/.test(s) && (SUP_RX.test(s) || CON_RX.test(s) || partnerNames().some((n) => s.includes(n)));
}
export const STATUS_TEXT = { red: 'We need to act', yellow: 'Waiting on supplier / contractor', green: 'Waiting on customer', none: 'Done' };

/* ───────── revisions (design deposit terms v1.3) ───────── */
export function revisionInfo(c) {
  const st = settings();
  const allowed = st.revisionsIncluded + (c.intake_complete ? st.revisionBonusIfIntakeComplete : 0);
  const used = c.revisions || 0;
  const over = Math.max(0, used - allowed);
  const paidFees = c.data?.revisionFeesPaid || 0;
  const due = Math.max(0, over - paidFees);
  return { allowed, used, over, due, dueAmount: due * st.revisionFee, fee: st.revisionFee };
}

/* ───────── lead score 0–100 ───────── */
export function intakeParts(c) {
  const files = custFiles(c.id);
  return {
    photos: files.some((f) => f.ftype === 'Photo'),
    layout: files.some((f) => f.ftype === 'Layout' || f.ftype === 'Scan') || custLayouts(c.id).length > 0,
    dims: custSizes(c.id).length > 0,
    finishes: !!(c.data?.finishes && String(c.data.finishes).trim()),
  };
}
export function score(c) {
  const w = settings().scoreWeights;
  const tot = (w.conversion + w.budget + w.repeat + w.intake) || 1;
  const conv = c.conversion ? (c.conversion - 1) / 4 : 0.4;
  const b = Math.max(n(c.budget) || 0, n(c.est_price) || 0);
  const bud = b >= 25000 ? 1 : b >= 10000 ? 0.8 : b >= 5000 ? 0.55 : b > 0 ? 0.3 : 0;
  const prior = S.customers.some((o) => o.id !== c.id && o.paid?.amount && ((c.email && o.email && o.email.toLowerCase() === c.email.toLowerCase()) || (c.phone && o.phone && o.phone.replace(/\D/g, '') === c.phone.replace(/\D/g, ''))));
  const rep = c.repeat || prior ? 1 : ['Contractor', 'Flipper', 'Landlord', 'Designer'].includes(c.ctype) ? 0.6 : 0;
  const ip = intakeParts(c);
  const intake = (ip.photos ? 0.2 : 0) + (ip.layout ? 0.3 : 0) + (ip.dims ? 0.3 : 0) + (ip.finishes ? 0.2 : 0);
  const parts = {
    conversion: conv * w.conversion, budget: bud * w.budget, repeat: rep * w.repeat, intake: intake * w.intake,
  };
  const total = Math.round(((parts.conversion + parts.budget + parts.repeat + parts.intake) / tot) * 100);
  return { total, parts, w, convRated: !!c.conversion, prior, ip, budgetUsed: b };
}

/* ───────── dates worth showing on a card ───────── */
export function keyDates(c) {
  const out = [];
  const t = todayISO();
  const stale = settings().staleDays;
  const late = openActions(c.id).filter((a) => a.due && daysBetween(a.due, t) > stale);
  if (late.length) out.push({ warn: true, text: `${late.length} step${late.length > 1 ? 's' : ''} ${daysBetween(late[0].due, t)}d late` });
  if (c.measure_date && c.measure_date >= t) out.push({ text: `Measure ${fmtDate(c.measure_date)}` });
  if (c.delivery_date) out.push({ text: `Delivery ${fmtDate(c.delivery_date)}` });
  if (c.install_date) out.push({ text: `Install ${fmtDate(c.install_date)}` });
  return out;
}

/* ───────── soft reminders when moving (never blocks: bare minimum is contact + sketch + accepted quote) ───────── */
export function gateMissing(c, toKey) {
  const miss = [];
  const q = custQuote(c.id);
  const ti = stageIdx(toKey);
  if (ti >= stageIdx('quote') && !(c.phone || c.email)) miss.push('phone or email');
  if (ti >= stageIdx('accepted') && !(q && q.status === 'accepted')) miss.push('accepted quote');
  if (ti >= stageIdx('paid') && !(Number(c.paid?.amount) > 0)) miss.push('payment amount');
  if (toKey === 'installed' && !(c.delivery_date || c.install_date)) miss.push('delivery / install date');
  return miss;
}

/* ───────── quote math: COST = TCRS pays, PRICE = customer pays ───────── */
export function lineCalc(l, st = settings()) {
  const qty = n(l.qty) ?? 0;
  const list = n(l.list), disc = n(l.disc);
  const unitCost = n(l.cost) ?? (list != null ? r2(list * (1 - (disc || 0) / 100)) : null);
  if (l.deal === 'referral') {
    const partnerAmt = r2(qty * (unitCost || 0));
    const pct = n(l.refPct) ?? st.referralPct;
    const fee = r2(partnerAmt * pct / 100);
    return { referral: true, qty, unitCost, partnerAmt, refPct: pct, fee, cost: 0, price: 0, profit: fee, markup: null };
  }
  if (l.kind === 'discount') {
    const amt = Math.abs(n(l.price) ?? n(l.cost) ?? 0);
    return { qty: 1, unitCost: 0, unitPrice: -amt, cost: 0, price: -amt, profit: -amt, markup: null };
  }
  const mk = n(l.markup) ?? st.markupDefault;
  const unitPrice = n(l.price) != null ? n(l.price) : (unitCost != null ? r2(unitCost * (1 + mk / 100)) : null);
  const cost = r2(qty * (unitCost || 0));
  const price = r2(qty * (unitPrice || 0));
  const effMk = unitCost ? ((unitPrice - unitCost) / unitCost) * 100 : null;
  return { qty, unitCost, unitPrice, cost, price, profit: r2(price - cost), markup: effMk, low: effMk != null && effMk < st.markupFloor - 0.01 };
}
/* Estimate range: ±pct around the customer price, but the low end never drops below cost + floor markup. */
export function estRange(price, cost, pct = settings().estimateRangePct, floorMk = settings().rangeFloorMarkup, extra = 0) {
  const hi = Math.ceil(price * (1 + pct / 100) / 100) * 100;
  let lo = Math.floor(price * (1 - pct / 100) / 100) * 100;
  const floor = cost > 0 && floorMk != null ? cost * (1 + floorMk / 100) + extra : 0;
  if (lo < floor) lo = Math.ceil(floor / 100) * 100;   // round UP so the floor is never undercut
  return { lo: Math.min(lo, hi), hi, floored: lo === Math.ceil(floor / 100) * 100 && floor > 0 };
}
export const BUCKET = { material: 'mat', fee: 'mat', discount: 'mat', delivery: 'del', install: 'ins' };
export function optionCalc(opt, st = settings()) {
  const t = { mat: 0, del: 0, ins: 0, cost: 0, price: 0, profit: 0, fees: 0, partner: 0 };
  (opt.lines || []).forEach((l) => {
    const c = lineCalc(l, st);
    if (c.referral) { t.fees += c.fee; t.partner += c.partnerAmt; t.profit += c.fee; return; }
    t[BUCKET[l.kind] || 'mat'] += c.price; t.cost += c.cost; t.price += c.price; t.profit += c.profit;
  });
  Object.keys(t).forEach((k) => (t[k] = r2(t[k])));
  return t;
}
export function quoteCalc(q, c, st = settings()) {
  const secs = (q?.sections || []).map((s) => {
    const opt = (s.options || []).find((o) => o.id === s.chosen) || s.options?.[0];
    return { s, opt, t: opt ? optionCalc(opt, st) : optionCalc({ lines: [] }, st) };
  });
  const sum = (k) => r2(secs.reduce((a, x) => a + x.t[k], 0));
  const matTotal = sum('mat');
  const taxRate = q?.settings?.taxOn ? n(q.settings.taxRate) : null;
  const tax = taxRate ? r2(matTotal * taxRate / 100) : 0;
  const depositCredit = q?.mode === 'quote' && c?.data?.deposit?.paidAt && !q?.settings?.noDepositCredit ? (n(c.data.deposit.amount) || st.depositAmount) : 0;
  const revFeeCredit = q?.mode === 'quote' && !q?.settings?.noDepositCredit ? (c?.data?.revisionFeesPaid || 0) * st.revisionFee : 0;
  const price = sum('price');
  const total = r2(price + tax - depositCredit - revFeeCredit);
  const cost = sum('cost');
  const profit = r2(sum('profit'));
  return { secs, price, tax, taxRate, depositCredit, revFeeCredit, total, cost, profit, fees: sum('fees'), partner: sum('partner'), margin: price ? (price - cost) / price * 100 : null };
}

export function chosenOptions(q) {
  return (q?.sections || []).map((s) => (s.options || []).find((o) => o.id === s.chosen) || s.options?.[0]).filter(Boolean);
}
export function referralLines(q) {
  return chosenOptions(q).flatMap((o) => (o.lines || []).filter((l) => l.deal === 'referral'));
}

/* ───────── what HQ has learned (fed to Claude) ───────── */
export function learnedContext() {
  const pb = [...S.pricebook].sort((a, b) => (b.won - a.won) || (b.uses - a.uses)).slice(0, 80)
    .map((p) => `- ${p.name} [${p.product || ''}/${p.kind || ''}] cost $${p.cost ?? '?'} per ${p.unit || 'ea'}, markup ${p.markup ?? '?'}%, partner ${p.partner || '-'}, used ${p.uses}x, on paid jobs ${p.won}x`).join('\n');
  const pr = S.partners.map((p) => `- ${p.name} (${p.ptype}${p.trades ? ', ' + p.trades : ''})${p.discount_pct ? `, our discount ${p.discount_pct}%` : ''}${p.referral_pct ? `, pays us ${p.referral_pct}% referral` : ''}`).join('\n');
  const fb = [...S.feedback].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15)
    .filter((f) => f.note).map((f) => `- (${f.rating > 0 ? 'good' : 'bad'}, ${f.context}) ${f.note}`).join('\n');
  return `PRICE BOOK (what TCRS has actually used):\n${pb || '(empty)'}\n\nPARTNERS:\n${pr || '(none yet)'}\n\nTEAM FEEDBACK ON PAST CLAUDE OUTPUT:\n${fb || '(none yet)'}`;
}

/* ───────── writes that also log ───────── */
export async function logEvent(cid, kind, summary, body) {
  try { await D.insert('logs', { customer_id: cid, kind, summary, body: body || null, at: new Date().toISOString(), by: S.me?.id }); } catch (e) { console.warn(e); }
}
export const pendingSaves = new Set();
export async function patchCustomer(c, patch) {
  Object.assign(c, patch);
  const p = D.update('customers', c.id, patch);
  pendingSaves.add(p);
  try { return await p; } finally { pendingSaves.delete(p); }
}
