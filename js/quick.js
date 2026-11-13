// Quick estimate: a rough COST + PRICE range from a few key dimensions, meant to go back to a new lead
// within 5–20 minutes. Fills the lead's Estimate (same PDF / "mark sent" flow as the Estimate → Quote tab).
// COST = what TCRS pays. PRICE = what the customer pays. Rates live in settings.main.quickRates (editable here).
import * as D from './data.js?v=20261113033626';
import { S, esc, $, $$, n, r2, money0, settings, toast, canWrite, logEvent, patchCustomer, custQuote, estRange } from './core.js?v=20261113033626';
import { modal } from './customer.js?v=20261113033626';
import { ensureQuote, openDoc } from './quote.js?v=20261113033626';

/* Defaults. "src" says where each number came from so nobody mistakes a placeholder for a real price. */
export const QR_DEFAULT = {
  range: 15, floorMk: 15,   // range sent = ±15% around price; low end never below cost + 15% markup
  cab: {
    lines: {
      'J&K': { box: 205, src: 'Average J&K cost per box from 3 recent J&K quotes (Jon Thenhaus $256, Areli $206, Stacy Wang $147; 25–50% discounts)' },
      'Twin River': { box: null, src: 'Not set yet' },
    },
    boxW: 27, wallVsBase: 0.8, tallBoxes: 3, trimPct: 12, assembly: 20,
    ceiling: { 8: 1, 9: 1.2, 10: 1.45 },
    deliveryCost: 250, deliveryPrice: 300, installPrice: 175, installCost: 125,
    src: 'Box width 27" (cabinet tool default); wall box = 80% of a base box (assumption); trim/fillers +12% (assumption); assembly $20/box, delivery $250 (J&K rate sheet ≤45 mi); install $175/box customer price (cabinet tool), install cost target $125/box (Zuggy, varies by job); ceiling 9 ft ×1.2, 10 ft ×1.45 for taller uppers (assumption)',
  },
  floor: {
    types: {
      Laminate: { mat: 3.5, ins: 2.5 }, LVP: { mat: 4.0, ins: 3.5 }, Cork: { mat: 5.5, ins: 3.5 }, Hardwood: { mat: 6.0, ins: 4.5 },
    },
    waste: 10, laborDiscPct: 15, placeholder: true,
    src: 'PLACEHOLDERS from public retail ranges (BuildDirect 2026: laminate $2.47–4.59, LVP $2.45–5.79, engineered hardwood $3.45–8.49/sf; labor $2–6/sf). Cork has no source. Replace with your supplier costs.',
  },
  ctop: {
    levels: [60, 75, 90, 120], depth: 25.5, splash: 4, installCost: 7.83, sinkCost: 250,
    src: 'Stone levels 1–4 = $60/$75/$90/$120 per sf cost (Khan job supplier); install $7.83/sf ($940 ÷ 120 sf, Khan); sink cutout $250 (Aztek)',
  },
};
const deep = (a, b) => { const o = structuredClone(a); for (const k in b || {}) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' ? deep(o[k], b[k]) : b[k]; return o; };
export const rates = () => deep(QR_DEFAULT, S.settings.find((r) => r.id === 'main')?.data?.quickRates || {});

/* ft-in parser: 12, 12.5, 12' 6", 12'6, 150" , 12-6 → inches */
export function inches(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 0;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*[- ]?\s*(\d+(?:\.\d+)?)\s*(?:"|in)?$/);
  if (m && /'|ft|feet|-|\s/.test(s)) return +m[1] * 12 + +m[2];
  m = s.match(/^(\d+(?:\.\d+)?)\s*("|in|inch|inches)$/);
  if (m) return +m[1];
  m = s.match(/^(\d+(?:\.\d+)?)\s*('|ft|feet)?$/);
  return m ? +m[1] * 12 : 0;
}
const ftin = (i) => `${Math.floor(i / 12)}' ${Math.round(i % 12)}"`;
const ceil100 = (v) => Math.ceil(v / 100) * 100, floor100 = (v) => Math.floor(v / 100) * 100;

/* ───────── math ───────── */
export function calcCab(x, R) {
  const r = R.cab; const line = r.lines[x.line] || {};
  const run = (x.walls || []).reduce((a, w) => a + inches(w), 0);
  const fridge = x.fridge ? 36 : 0, range = x.range ? 30 : 0, dw = x.dw ? 24 : 0;
  const baseIn = Math.max(0, run - fridge - range - dw);
  const wallIn = x.uppers ? Math.max(0, run - range - inches(x.window)) : 0;
  const islandIn = inches(x.island);
  const base = baseIn / r.boxW, wall = wallIn / r.boxW, isl = islandIn / r.boxW, tall = n(x.pantries) || 0;
  const boxes = Math.round(base + wall + isl + tall);
  const mult = r.ceiling[x.ceiling] ?? 1;
  const box = n(line.box);
  const out = { run, baseIn, wallIn, islandIn, boxes, base, wall, isl, tall, lines: [], warn: [] };
  if (!run && !islandIn) return out;
  if (box == null) { out.warn.push(`No cost per box set for ${x.line}. Set it under Rates.`); return out; }
  const matCost = r2((base + isl) * box + wall * box * r.wallVsBase * mult + tall * box * r.tallBoxes) * (1 + r.trimPct / 100);
  const desc = `${x.line} cabinets, about ${boxes} boxes (${ftin(run)} of walls${islandIn ? `, ${ftin(islandIn)} island` : ''}${tall ? `, ${tall} tall pantr${tall > 1 ? 'ies' : 'y'}` : ''}; ${x.ceiling} ft ceiling)`;
  out.lines.push({ kind: 'material', desc, qty: 1, unit: 'job', cost: r2(matCost) });
  if (x.assembly) out.lines.push({ kind: 'material', desc: `Assembly (${boxes} boxes)`, qty: boxes, unit: 'ea', cost: r.assembly });
  if (x.delivery) out.lines.push({ kind: 'delivery', desc: 'Delivery', qty: 1, unit: 'job', cost: r.deliveryCost, price: r.deliveryPrice });
  if (x.install) out.lines.push({ kind: 'install', desc: `Installation (${boxes} boxes)`, qty: boxes, unit: 'ea', cost: n(r.installCost), price: r.installPrice });
  if (x.install && n(r.installCost) == null) out.warn.push('Install cost per box not set, so install profit is overstated. Set it under Rates.');
  return out;
}
export function calcFloor(x, R) {
  const r = R.floor; const t = r.types[x.type] || {};
  const rooms = (x.rooms || []).map((rm) => (inches(rm.l) / 12) * (inches(rm.w) / 12));
  const sf = rooms.reduce((a, b) => a + b, 0);
  const waste = n(x.waste) ?? r.waste;
  const buy = Math.ceil(sf * (1 + waste / 100));
  const out = { sf: r2(sf), buy, lines: [], warn: [] };
  if (!sf) return out;
  if (n(t.mat) == null) { out.warn.push(`No ${x.type} cost set.`); return out; }
  out.lines.push({ kind: 'material', desc: `${x.type} flooring, about ${Math.round(sf)} sq ft (+${waste}% waste = ${buy} sq ft)`, qty: buy, unit: 'sf', cost: t.mat });
  if (x.install) out.lines.push({ kind: 'install', desc: `${x.type} installation, ${Math.round(sf)} sq ft${x.disc ? ` (${r.laborDiscPct}% off labor, TCRS-supplied flooring)` : ''}`, qty: Math.ceil(sf), unit: 'sf', cost: t.ins, laborDisc: x.disc ? r.laborDiscPct : 0 });
  if (r.placeholder) out.warn.push('Flooring costs are placeholders (public retail ranges), not your supplier prices.');
  return out;
}
export function calcTop(x, R) {
  const r = R.ctop;
  const depth = inches(x.depth) || r.depth;
  const runs = (x.runs || []).reduce((a, w) => a + inches(w), 0);
  const corners = n(x.corners) || 0;
  const perim = (runs * depth - corners * depth * depth) / 144;
  const island = (inches(x.islandL) * inches(x.islandW)) / 144;
  const top = Math.max(0, perim + island);
  const splash = x.splash ? (runs * r.splash) / 144 : 0;
  const sf = r2(top + splash);
  const lvl = Math.min(4, Math.max(1, n(x.level) || 2));
  const cost = r.levels[lvl - 1];
  const out = { sf, top: r2(top), splash: r2(splash), lines: [], warn: [] };
  if (!sf) return out;
  out.lines.push({ kind: 'material', desc: `Level ${lvl} stone countertops, about ${Math.round(top)} sq ft${splash ? ` + ${Math.round(splash)} sq ft 4" backsplash` : ''}`, qty: Math.ceil(sf), unit: 'sf', cost });
  if (x.install) out.lines.push({ kind: 'install', desc: 'Fabrication + installation', qty: Math.ceil(sf), unit: 'sf', cost: r.installCost });
  if (n(x.sinks)) out.lines.push({ kind: 'install', desc: `Sink cutout${n(x.sinks) > 1 ? 's' : ''}`, qty: n(x.sinks), unit: 'ea', cost: r.sinkCost });
  return out;
}
function priceOf(l, mk) {
  if (n(l.price) != null) return l.qty * l.price;
  const p = l.qty * (l.cost || 0) * (1 + mk / 100);
  return l.laborDisc ? p * (1 - l.laborDisc / 100) : p;
}

/* ───────── UI ───────── */
const PRODS = [['Cabinets', 'cab'], ['Flooring', 'floor'], ['Countertops', 'top']];
function startState(c) {
  const saved = c.data?.quickEst;
  if (saved) return structuredClone(saved);
  const p = c.products || [];
  return {
    on: { cab: p.includes('Cabinets') || !p.length, floor: p.includes('Flooring'), top: p.includes('Countertops') },
    markup: settings().markupDefault,
    cab: { line: 'J&K', walls: ['', ''], ceiling: 8, uppers: true, island: '', pantries: 0, window: '', fridge: true, range: true, dw: true, assembly: true, delivery: true, install: (c.services || []).includes('Installation') },
    floor: { type: 'LVP', rooms: [{ l: '', w: '' }], waste: null, install: true, disc: true },
    top: { level: 2, runs: [''], corners: 0, islandL: '', islandW: '', depth: '', splash: true, sinks: 1, install: true },
  };
}

export function openQuick(c) {
  if (!canWrite()) return toast('View-only account.');
  const x = startState(c);
  modal(`<h2>⚡ Quick estimate · ${esc(c.name || '')}</h2>`, '<div id="qkBody"></div>', (box, close) => {
    const body = $('#qkBody', box);
    const render = () => {
      const R = rates();
      const res = { cab: x.on.cab ? calcCab(x.cab, R) : null, floor: x.on.floor ? calcFloor(x.floor, R) : null, top: x.on.top ? calcTop(x.top, R) : null };
      let cost = 0, price = 0;
      const rows = PRODS.filter(([, k]) => res[k]).map(([label, k]) => {
        const cst = res[k].lines.reduce((a, l) => a + l.qty * (l.cost || 0), 0);
        const prc = res[k].lines.reduce((a, l) => a + priceOf(l, x.markup), 0);
        cost += cst; price += prc;
        return { label, k, cst, prc, r: estRange(prc, cst, R.range, R.floorMk) };
      });
      const pct = R.range;
      const { lo, hi } = estRange(price, cost, R.range, R.floorMk);
      const wall = (arr, key, ph) => arr.map((w, i) => `<span class="qk-w"><span class="qk-l">${String.fromCharCode(65 + i)}</span><input type="text" data-arr="${key}" data-i="${i}" value="${esc(w)}" placeholder="${ph}" inputmode="decimal">${arr.length > 1 ? `<button type="button" class="x sm" data-del="${key}" data-i="${i}" aria-label="Remove">×</button>` : ''}</span>`).join('');
      body.innerHTML = `
      <div class="qk-prods">${PRODS.map(([l, k]) => `<label class="chip pick ${x.on[k] ? 'on' : ''}"><input type="checkbox" data-on="${k}" ${x.on[k] ? 'checked' : ''}> ${l}</label>`).join('')}
        <span class="small muted">Type sizes like 12, 12'6", 150" or 12-6. Plain numbers are feet.</span></div>
      ${x.on.cab ? `<fieldset class="qk-sec"><legend>Cabinets</legend>
        <div class="qk-row"><label>Line <select data-k="cab.line">${Object.keys(R.cab.lines).map((l) => `<option ${x.cab.line === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label>Ceiling <select data-k="cab.ceiling">${[8, 9, 10].map((h) => `<option value="${h}" ${+x.cab.ceiling === h ? 'selected' : ''}>${h} ft</option>`).join('')}</select></label>
          <label class="qk-ck"><input type="checkbox" data-k="cab.uppers" ${x.cab.uppers ? 'checked' : ''}> Upper cabinets</label></div>
        <div class="qk-row"><span class="qk-lab">Wall widths</span>${wall(x.cab.walls, 'cab.walls', 'ft')}<button class="btn sm" type="button" data-add="cab.walls">+ wall</button></div>
        <div class="qk-row"><label>Island length <input type="text" data-k="cab.island" value="${esc(x.cab.island)}" placeholder="ft" inputmode="decimal" class="qk-n"></label>
          <label>Tall pantries <input type="number" min="0" data-k="cab.pantries" value="${esc(x.cab.pantries)}" class="qk-n"></label>
          <label>Window (no uppers) <input type="text" data-k="cab.window" value="${esc(x.cab.window)}" placeholder="ft" class="qk-n"></label></div>
        <div class="qk-row">Openings: ${[['fridge', 'Fridge 36"'], ['range', 'Range 30"'], ['dw', 'Dishwasher 24"']].map(([k, l]) => `<label class="qk-ck"><input type="checkbox" data-k="cab.${k}" ${x.cab[k] ? 'checked' : ''}> ${l}</label>`).join('')}
          · ${[['assembly', 'Assembly'], ['delivery', 'Delivery'], ['install', 'Installation']].map(([k, l]) => `<label class="qk-ck"><input type="checkbox" data-k="cab.${k}" ${x.cab[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <div class="qk-out">${res.cab.run || res.cab.islandIn ? `≈ <b>${res.cab.boxes} boxes</b> · base ${ftin(res.cab.baseIn)} · uppers ${ftin(res.cab.wallIn)}${res.cab.islandIn ? ` · island ${ftin(res.cab.islandIn)}` : ''}` : '<span class="muted">Enter wall widths.</span>'}</div>
      </fieldset>` : ''}
      ${x.on.floor ? `<fieldset class="qk-sec"><legend>Flooring</legend>
        <div class="qk-row"><span class="qk-lab">Type</span>${Object.keys(R.floor.types).map((t) => `<label class="chip pick ${x.floor.type === t ? 'on' : ''}"><input type="radio" name="ft" data-k="floor.type" value="${esc(t)}" ${x.floor.type === t ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
        ${x.floor.rooms.map((rm, i) => `<div class="qk-row"><span class="qk-lab">Room ${i + 1}</span><input type="text" data-room="${i}" data-f="l" value="${esc(rm.l)}" placeholder="L ft" class="qk-n"> × <input type="text" data-room="${i}" data-f="w" value="${esc(rm.w)}" placeholder="W ft" class="qk-n">${x.floor.rooms.length > 1 ? `<button type="button" class="x sm" data-delroom="${i}" aria-label="Remove room">×</button>` : ''}</div>`).join('')}
        <div class="qk-row"><button class="btn sm" type="button" id="qkRoom">+ room</button>
          <label>Waste % <input type="number" min="0" data-k="floor.waste" value="${esc(x.floor.waste ?? R.floor.waste)}" class="qk-n"></label>
          <label class="qk-ck"><input type="checkbox" data-k="floor.install" ${x.floor.install ? 'checked' : ''}> Installation</label>
          <label class="qk-ck"><input type="checkbox" data-k="floor.disc" ${x.floor.disc ? 'checked' : ''}> ${R.floor.laborDiscPct}% off labor (we supply the flooring)</label></div>
        <div class="qk-out">${res.floor.sf ? `≈ <b>${Math.round(res.floor.sf)} sq ft</b> · order ${res.floor.buy} sq ft with waste` : '<span class="muted">Enter room sizes.</span>'}</div>
      </fieldset>` : ''}
      ${x.on.top ? `<fieldset class="qk-sec"><legend>Countertops</legend>
        <div class="qk-row"><span class="qk-lab">Stone level</span>${R.ctop.levels.map((v, i) => `<label class="chip pick ${+x.top.level === i + 1 ? 'on' : ''}"><input type="radio" name="tl" data-k="top.level" value="${i + 1}" ${+x.top.level === i + 1 ? 'checked' : ''}> L${i + 1} · $${v}/sf</label>`).join('')}</div>
        <div class="qk-row"><span class="qk-lab">Counter runs</span>${wall(x.top.runs, 'top.runs', 'ft')}<button class="btn sm" type="button" data-add="top.runs">+ run</button>
          <label>Corners <input type="number" min="0" data-k="top.corners" value="${esc(x.top.corners)}" class="qk-n"></label></div>
        <div class="qk-row"><label>Island <input type="text" data-k="top.islandL" value="${esc(x.top.islandL)}" placeholder="L ft" class="qk-n"> × <input type="text" data-k="top.islandW" value="${esc(x.top.islandW)}" placeholder="W ft" class="qk-n"></label>
          <label>Sinks <input type="number" min="0" data-k="top.sinks" value="${esc(x.top.sinks)}" class="qk-n"></label>
          <label class="qk-ck"><input type="checkbox" data-k="top.splash" ${x.top.splash ? 'checked' : ''}> 4" backsplash</label>
          <label class="qk-ck"><input type="checkbox" data-k="top.install" ${x.top.install ? 'checked' : ''}> Fab + install</label></div>
        <div class="qk-out">${res.top.sf ? `≈ <b>${Math.round(res.top.sf)} sq ft</b> (tops ${Math.round(res.top.top)}${res.top.splash ? ` + splash ${Math.round(res.top.splash)}` : ''}) at ${R.ctop.depth}" deep` : '<span class="muted">Enter counter runs.</span>'}</div>
      </fieldset>` : ''}
      <div class="qk-total">
        <label class="qk-mk">Markup <input type="range" min="0" max="80" step="1" id="qkMk" value="${x.markup}"><b id="qkMkV">${x.markup}%</b></label>
        <table class="simple qk-tab"><thead><tr><th></th><th class="n">Our cost</th><th class="n">Customer price</th><th class="n">Range sent</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${r.label}</td><td class="n">${money0(r.cst)}</td><td class="n">${money0(r.prc)}</td><td class="n">${r.prc ? `${money0(r.r.lo)} – ${money0(r.r.hi)}` : '—'}</td></tr>`).join('')}
          <tr class="qk-sum"><td><b>Total</b></td><td class="n"><b>${money0(cost)}</b></td><td class="n"><b>${money0(price)}</b></td><td class="n"><b>${price ? `${money0(lo)} – ${money0(hi)}` : '—'}</b></td></tr>
        </tbody></table>
        <div class="small muted">Range sent = ±${R.range}% around the price; the low end never drops below our cost + ${R.floorMk}% markup${price && estRange(price, cost, R.range, R.floorMk).floored ? ' (floor applied here)' : ''}.</div>
        <div class="small muted">Gross profit ≈ <b>${money0(price - cost)}</b>${price ? ` (${Math.round(((price - cost) / price) * 100)}% margin)` : ''}. Rough numbers for a fast first reply, not a quote.</div>
        ${Object.values(res).filter(Boolean).flatMap((r) => r.warn).map((w) => `<div class="small qk-warn">⚠ ${esc(w)}</div>`).join('')}
      </div>
      <div class="row"><button class="btn primary" type="button" id="qkGo" ${price ? '' : 'disabled'}>Make estimate PDF</button>
        <button class="btn" type="button" id="qkMail" ${price ? '' : 'disabled'}>Copy reply email</button>
        <button class="btn ghost" type="button" id="qkRates">Rates…</button><span class="small muted" id="qkMsg"></span></div>`;
      wire(R, { lo, hi, price, cost, res, pct });
    };
    const set = (path, v) => { const [a, b] = path.split('.'); x[a][b] = v; };
    const wire = (R, tot) => {
      $$('[data-on]', body).forEach((el) => (el.onchange = () => { x.on[el.dataset.on] = el.checked; render(); }));
      $$('[data-k]', body).forEach((el) => {
        const ev = el.type === 'text' ? 'change' : 'change';
        el.addEventListener(ev, () => { set(el.dataset.k, el.type === 'checkbox' ? el.checked : el.type === 'number' ? n(el.value) : el.value); render(); });
      });
      $$('[data-arr]', body).forEach((el) => (el.onchange = () => { const [a, b] = el.dataset.arr.split('.'); x[a][b][+el.dataset.i] = el.value; render(); }));
      $$('[data-add]', body).forEach((el) => (el.onclick = () => { const [a, b] = el.dataset.add.split('.'); x[a][b].push(''); render(); setTimeout(() => $$(`[data-arr="${el.dataset.add}"]`, body).pop()?.focus(), 0); }));
      $$('[data-del]', body).forEach((el) => (el.onclick = () => { const [a, b] = el.dataset.del.split('.'); x[a][b].splice(+el.dataset.i, 1); render(); }));
      $$('[data-room]', body).forEach((el) => (el.onchange = () => { x.floor.rooms[+el.dataset.room][el.dataset.f] = el.value; render(); }));
      $$('[data-delroom]', body).forEach((el) => (el.onclick = () => { x.floor.rooms.splice(+el.dataset.delroom, 1); render(); }));
      $('#qkRoom', body)?.addEventListener('click', () => { x.floor.rooms.push({ l: '', w: '' }); render(); });
      const mk = $('#qkMk', body);
      mk.oninput = () => { $('#qkMkV', body).textContent = mk.value + '%'; };
      mk.onchange = () => { x.markup = +mk.value; render(); };
      $('#qkRates', body).onclick = () => openRates(render);
      $('#qkMail', body).onclick = async () => {
        const txt = replyText(c, x, tot);
        try { await navigator.clipboard.writeText(txt); $('#qkMsg', body).textContent = 'Reply copied. Paste it into Gmail.'; } catch { $('#qkMsg', body).textContent = 'Copy blocked; select the text below.'; body.insertAdjacentHTML('beforeend', `<textarea rows="10" style="width:100%">${esc(txt)}</textarea>`); }
      };
      $('#qkGo', body).onclick = async () => {
        $('#qkGo', body).disabled = true; $('#qkMsg', body).textContent = 'Building…';
        try { const q = await writeEstimate(c, x, tot, R); close(); openDoc(q, c); } catch (e) { $('#qkMsg', body).textContent = 'Failed: ' + e.message; $('#qkGo', body).disabled = false; }
      };
    };
    render();
  }, false);
}

function summaryText(x, tot) {
  const parts = [];
  if (tot.res.cab?.boxes) parts.push(`${x.cab.line} cabinets for about ${Math.round(tot.res.cab.run / 12)} ft of walls${tot.res.cab.islandIn ? ' plus an island' : ''}`);
  if (tot.res.floor?.sf) parts.push(`about ${Math.round(tot.res.floor.sf)} sq ft of ${x.floor.type}`);
  if (tot.res.top?.sf) parts.push(`about ${Math.round(tot.res.top.sf)} sq ft of level ${x.top.level} stone countertops`);
  return parts.join(', ');
}
function replyText(c, x, tot) {
  const first = (c.name || '').split(/\s+/)[0] || 'there';
  const co = settings().company;
  const incl = [x.on.cab && x.cab.delivery && 'delivery', ((x.on.cab && x.cab.install) || (x.on.floor && x.floor.install) || (x.on.top && x.top.install)) && 'installation'].filter(Boolean);
  return `Hi ${first},

Thanks again for reaching out! Based on the sizes you sent (${summaryText(x, tot)}), a rough ballpark is ${money0(tot.lo)} – ${money0(tot.hi)}${incl.length ? `, including ${incl.join(' and ')}` : ''}.

This is a quick estimate, not a quote. The final price depends on exact measurements, door style and finish, and the materials you pick. If that range works for you, the next step is a few photos (or a quick measure) so we can put together a detailed layout and quote.

Does that range fit what you had in mind?

Nathan
${co.name}
${co.phone}`;
}

async function writeEstimate(c, x, tot, R) {
  const q = await ensureQuote(c);
  const secs = structuredClone(q.sections || []);
  const add = (product, lines, note) => {
    let s = secs.find((y) => y.product === product);
    if (!s) { const o = { id: D.uuid(), name: 'Option A', lines: [] }; s = { id: D.uuid(), product, note: '', options: [o], chosen: o.id }; secs.push(s); }
    const o = s.options.find((y) => y.id === s.chosen) || s.options[0];
    o.lines = o.lines.filter((l) => !l.quick);   // replace an earlier quick estimate, keep hand-made lines
    for (const l of lines) {
      const price = n(l.price) != null ? l.price : l.laborDisc ? r2((l.cost || 0) * (1 + x.markup / 100) * (1 - l.laborDisc / 100)) : null;
      o.lines.push({ id: D.uuid(), kind: l.kind, deal: 'resell', desc: l.desc, qty: l.qty, unit: l.unit, list: null, disc: null, cost: n(l.cost), markup: null, price, partner: '', note: 'Quick estimate', cnote: '', quick: true });
    }
    if (note) s.note = note;
  };
  if (tot.res.cab?.lines.length) add('Cabinets', tot.res.cab.lines, 'Rough estimate from wall widths. Hinges and drawer slides included; knobs and pulls not included.');
  if (tot.res.floor?.lines.length) add('Flooring', tot.res.floor.lines, 'Rough estimate from room sizes.');
  if (tot.res.top?.lines.length) add('Countertops', tot.res.top.lines, 'Rough estimate from counter runs; final price after slab selection and field measure.');
  const qs = { ...(q.settings || {}), markup: x.markup, range: R.range, floorMk: R.floorMk };
  await D.update('quotes', q.id, { sections: secs, mode: 'estimate', settings: qs });
  Object.assign(q, { sections: secs, mode: 'estimate', settings: qs });
  await patchCustomer(c, { est_price: Math.round(tot.price), data: { ...(c.data || {}), quickEst: x } });
  await logEvent(c.id, 'system', `⚡ Quick estimate: ${summaryText(x, tot)} → ${money0(tot.lo)} – ${money0(tot.hi)} (cost ${money0(tot.cost)}, markup ${x.markup}%)`);
  return custQuote(c.id) || q;
}

/* ───────── rates editor ───────── */
function openRates(after) {
  const R = rates();
  const num = (path, v, unit, w = 70) => `<input type="text" inputmode="decimal" data-r="${path}" value="${v ?? ''}" style="width:${w}px"> ${unit}`;
  modal('<h2>Quick estimate rates (our COST)</h2>', `
    <p class="small muted">Changes apply to every new quick estimate. Where each default came from is listed under each block.</p>
    <h3>Range sent to the customer</h3>
    <div class="qk-row">± ${num('range', R.range, '% around the price', 40)} · low end never below cost + ${num('floorMk', R.floorMk, '% markup', 40)}</div>
    <h3>Cabinets</h3>
    ${Object.entries(R.cab.lines).map(([k, v]) => `<div class="qk-row"><b style="min-width:90px">${esc(k)}</b> ${num(`cab.lines.${k}.box`, v.box, 'per box (avg)')}</div>`).join('')}
    <div class="qk-row">Avg box width ${num('cab.boxW', R.cab.boxW, 'in', 50)} · Wall box ${num('cab.wallVsBase', R.cab.wallVsBase, '× base', 50)} · Tall pantry ${num('cab.tallBoxes', R.cab.tallBoxes, '× box', 50)} · Trim/fillers +${num('cab.trimPct', R.cab.trimPct, '%', 40)}</div>
    <div class="qk-row">Ceiling 9 ft ${num('cab.ceiling.9', R.cab.ceiling[9], '×', 50)} · 10 ft ${num('cab.ceiling.10', R.cab.ceiling[10], '×', 50)}</div>
    <div class="qk-row">Assembly ${num('cab.assembly', R.cab.assembly, '/box', 50)} · Delivery cost ${num('cab.deliveryCost', R.cab.deliveryCost, '', 60)} price ${num('cab.deliveryPrice', R.cab.deliveryPrice, '', 60)} · Install price ${num('cab.installPrice', R.cab.installPrice, '/box', 60)} cost ${num('cab.installCost', R.cab.installCost, '/box', 60)}</div>
    <p class="small muted">${esc(R.cab.src)}. ${esc(R.cab.lines['J&K'].src)}.</p>
    <h3>Flooring ${R.floor.placeholder ? '<span class="chip warn">placeholders</span>' : ''}</h3>
    ${Object.entries(R.floor.types).map(([k, v]) => `<div class="qk-row"><b style="min-width:90px">${esc(k)}</b> material ${num(`floor.types.${k}.mat`, v.mat, '/sf', 60)} install ${num(`floor.types.${k}.ins`, v.ins, '/sf', 60)}</div>`).join('')}
    <div class="qk-row">Waste ${num('floor.waste', R.floor.waste, '%', 40)} · Labor discount ${num('floor.laborDiscPct', R.floor.laborDiscPct, '%', 40)}</div>
    <p class="small muted">${esc(R.floor.src)}</p>
    <h3>Countertops</h3>
    <div class="qk-row">${R.ctop.levels.map((v, i) => `L${i + 1} ${num(`ctop.levels.${i}`, v, '/sf', 55)}`).join(' · ')}</div>
    <div class="qk-row">Depth ${num('ctop.depth', R.ctop.depth, 'in', 50)} · Fab+install ${num('ctop.installCost', R.ctop.installCost, '/sf', 55)} · Sink cutout ${num('ctop.sinkCost', R.ctop.sinkCost, 'ea', 55)}</div>
    <p class="small muted">${esc(R.ctop.src)}</p>
    <div class="row"><button class="btn primary" type="button" id="rkSave">Save rates</button><button class="btn ghost" type="button" id="rkReset">Reset to defaults</button></div>`,
  (box, close) => {
    $('#rkSave', box).onclick = async () => {
      const cur = structuredClone(R);
      $$('[data-r]', box).forEach((el) => {
        const keys = el.dataset.r.split('.'); let o = cur;
        keys.slice(0, -1).forEach((k) => (o = o[k]));
        o[keys.at(-1)] = n(el.value);
      });
      if ($$('[data-r^="floor.types"]', box).some((el) => n(el.value) !== n(el.defaultValue))) cur.floor.placeholder = false;
      const row = S.settings.find((r) => r.id === 'main');
      await D.upsert('settings', { id: 'main', data: { ...(row?.data || {}), quickRates: cur } });
      toast('Rates saved.'); close(); after();
    };
    $('#rkReset', box).onclick = async () => {
      const row = S.settings.find((r) => r.id === 'main');
      const d = { ...(row?.data || {}) }; delete d.quickRates;
      await D.upsert('settings', { id: 'main', data: d });
      toast('Rates reset.'); close(); after();
    };
  });
}
