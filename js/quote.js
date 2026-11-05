// Estimate → Quote: one growing document. COST = TCRS pays. PRICE = customer pays.
import * as D from './data.js?v=20261104184942';
import {
  S, PRODUCTS, esc, $, $$, n, r2, money, money0, settings, lineCalc, optionCalc, quoteCalc, custQuote, custSizes, custLayouts,
  todayISO, addDays, fmtDateLong, toast, canWrite, logEvent, patchCustomer, learnedContext, stageIdx, custFiles,
} from './core.js?v=20261104184942';
import { modal, moveStage } from './customer.js?v=20261104184942';

const KINDS = [['material', 'Material'], ['delivery', 'Delivery'], ['install', 'Installation'], ['fee', 'Fee'], ['discount', 'Discount']];
const SEC_NOTE = {
  Cabinets: 'Hinges and drawer slides included. Knobs and pulls not included.',
  Countertops: 'Includes 4" backsplash.',
};
const newLine = (kind = 'material', extra = {}) => ({ id: D.uuid(), kind, deal: 'resell', desc: '', qty: kind === 'material' ? 1 : 1, unit: kind === 'material' ? 'ea' : 'job', list: null, disc: null, cost: null, markup: null, price: null, partner: '', note: '', cnote: '', ...extra });
const newSection = (product) => { const o = { id: D.uuid(), name: 'Option A', lines: [] }; return { id: D.uuid(), product, note: SEC_NOTE[product] || '', options: [o], chosen: o.id }; };

function quoteSt(q) { const st = settings(); const m = n(q?.settings?.markup); return m != null ? { ...st, markupDefault: m } : st; }

async function nextNumber(prefix) {
  const d = todayISO().slice(2).replace(/-/g, '');
  const k = S.quotes.filter((q) => (q.number || '').includes(d)).length + 1;
  return `${prefix}-${d}-${String(k).padStart(2, '0')}`;
}
export async function ensureQuote(c) {
  let q = custQuote(c.id);
  if (q) return q;
  q = await D.insert('quotes', { customer_id: c.id, number: await nextNumber('E'), mode: 'estimate', status: 'draft', sections: (c.products || []).filter((p) => p !== 'Other').map(newSection), settings: { markup: c.repeat ? settings().markupDefault : null, validDays: settings().quoteValidDays, range: settings().estimateRangePct } });
  S.quotes.push(q);
  return q;
}

export async function addLinesToQuote(c, lines) {
  const q = await ensureQuote(c);
  const secs = structuredClone(q.sections || []);
  for (const l of lines) {
    const prod = PRODUCTS.includes(l.product) ? l.product : 'Other';
    let s = secs.find((x) => x.product === prod);
    if (!s) { s = newSection(prod); secs.push(s); }
    const o = s.options.find((x) => x.id === s.chosen) || s.options[0];
    o.lines.push(newLine(['material', 'install', 'delivery', 'fee'].includes(l.kind) ? l.kind : 'material', {
      deal: l.deal === 'referral' ? 'referral' : 'resell', desc: l.desc || '', qty: n(l.qty) ?? 1, unit: l.unit || 'ea',
      cost: n(l.cost), list: n(l.list), disc: n(l.disc), partner: l.partner || '', note: l.note || 'From a drop',
    }));
  }
  await D.update('quotes', q.id, { sections: secs });
  await logEvent(c.id, 'system', `${lines.length} line${lines.length > 1 ? 's' : ''} added to the estimate`);
}

/* ───────── editor ───────── */
let saveTimer = null;
let dirty = false;
let live = null; // {q, c, el}

export function renderQuote(el, c) {
  const q = custQuote(c.id);
  if (!q) {
    el.innerHTML = `<div class="empty"><h3>No estimate yet</h3><p>Start one here. It grows into the final quote: ranges and options first, line items once the design deposit is paid and sizes are verified.</p>
      ${canWrite() ? '<button class="btn primary" type="button" id="qStart">Start estimate</button>' : ''}</div>`;
    $('#qStart', el)?.addEventListener('click', async () => { await ensureQuote(c); renderQuote(el, c); });
    return;
  }
  const qq = live && live.q.id === q.id && dirty ? live.q : structuredClone(q);
  live = { q: qq, c, el };
  draw();
}

function draw() {
  const { q, c, el } = live;
  const st = quoteSt(q);
  const t = quoteCalc(q, c, st);
  const ro = !canWrite();
  const dep = c.data?.deposit || {};
  el.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:12px">
    <div class="panel" style="display:flex;flex-direction:column;gap:10px">
      <div class="row">
        <div class="whose" role="group" aria-label="Document type">
          <button type="button" data-mode="estimate" class="${q.mode === 'estimate' ? 'on customer' : ''}">Estimate (ranges, no line items)</button>
          <button type="button" data-mode="quote" class="${q.mode === 'quote' ? 'on us' : ''}">Final quote (itemized)</button>
        </div>
        <span class="chip">${esc(q.number || '')}</span>
        <label class="small row" style="gap:4px">Status <select id="qStatus">${['draft', 'sent', 'accepted', 'declined'].map((s) => `<option ${q.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <span class="grow"></span>
        <button class="btn" type="button" id="qAI">✨ Draft lines with Claude</button>
        <button class="btn primary" type="button" id="qDoc">Customer document →</button>
      </div>
      <div class="cp-key"><span class="k-cost">COST = $ TCRS spends on the product or service</span><span class="k-price">PRICE = $ TCRS receives from the customer</span><span class="muted">Markup = PRICE ÷ COST − 1. Floor ${st.markupFloor}%.</span></div>
      <div class="row small">
        <span>Default markup</span>
        <button type="button" class="chip pick ${n(q.settings?.markup) === settings().markupDefault ? 'on' : ''}" data-mk="${settings().markupDefault}">Repeat ${settings().markupDefault}%</button>
        <button type="button" class="chip pick ${n(q.settings?.markup) === settings().markupOneOff ? 'on' : ''}" data-mk="${settings().markupOneOff}">One-off ${settings().markupOneOff}%</button>
        <input type="text" id="qMk" value="${esc(q.settings?.markup ?? '')}" placeholder="${settings().markupDefault}" style="width:60px" aria-label="Custom default markup %">%
        <span class="muted">·</span>
        <label class="row" style="gap:4px"><input type="checkbox" id="qTax" ${q.settings?.taxOn ? 'checked' : ''}> Sales tax on materials</label>
        <input type="text" id="qTaxR" value="${esc(q.settings?.taxRate ?? '')}" placeholder="rate" style="width:60px" ${q.settings?.taxOn ? '' : 'disabled'} aria-label="Tax rate %">%
        ${q.settings?.taxOn ? '<span style="color:var(--amber)">Rate unconfirmed (8.75% vs 8.375%); check with the accountant.</span>' : '<span class="muted">Installed jobs: usually no tax line.</span>'}
      </div>
      ${missingCost(q).length ? `<div class="small" style="color:var(--red)">${missingCost(q).length} line${missingCost(q).length > 1 ? 's' : ''} without a COST: they price at $0 until filled.</div>` : ''}
      ${q.mode === 'quote' && !(dep.paidAt || dep.waived) ? '<div class="pill st-red" style="align-self:flex-start">Itemized quotes come after the $250 design deposit. Mark it paid or waived on Money &amp; dates.</div>' : ''}
    </div>
    ${(q.sections || []).map((s, si) => section(s, si, st, ro)).join('')}
    ${ro ? '' : `<div class="row"><select id="addSec"><option value="">+ Add a product section…</option>${PRODUCTS.map((p) => `<option>${p}</option>`).join('')}</select></div>`}
    <div class="proj" id="projBar">${projBar(t)}</div>
  </div>
  <datalist id="pbList">${[...S.pricebook].sort((a, b) => b.uses - a.uses).map((p) => `<option value="${esc(p.name)}">${esc(p.product || '')} · cost $${p.cost ?? '?'}/${esc(p.unit || 'ea')}</option>`).join('')}</datalist>
  <datalist id="ptList">${S.partners.map((p) => `<option value="${esc(p.name)}">${esc(p.ptype)}</option>`).join('')}</datalist>`;
  wire();
}

function projBar(t) {
  return `<div><div class="lb">Project PRICE</div><div class="v">${money(t.total)}</div></div>
    <div><div class="lb">COST</div><div class="v" style="color:#E8B48C">${money(t.cost)}</div></div>
    <div><div class="lb">Profit</div><div class="v">${money(t.profit)}</div></div>
    <div><div class="lb">Margin</div><div class="v">${t.margin != null ? t.margin.toFixed(1) + '%' : '—'}</div></div>
    ${t.fees ? `<div><div class="lb">Referral fees</div><div class="v">${money(t.fees)}</div></div>` : ''}
    ${t.depositCredit ? `<div><div class="lb">Deposit credit</div><div class="v">−${money(t.depositCredit)}</div></div>` : ''}`;
}

function section(s, si, st, ro) {
  const opt = s.options.find((o) => o.id === s.chosen) || s.options[0];
  const ot = optionCalc(opt, st);
  const showList = s.showList || s.options.some((o) => o.lines.some((l) => l.list != null || l.disc != null));
  return `<section class="qsec ${showList ? '' : 'nolist'}" data-si="${si}">
    <div class="qsec-h">
      <h3>${esc(s.product)}</h3>
      <div class="opts">${s.options.map((o) => { const x = optionCalc(o, st); return `<button type="button" class="chip pick ${o.id === s.chosen ? 'on' : ''}" data-opt="${o.id}" title="In the total">${esc(o.name)} · ${money0(x.price)}</button>`; }).join('')}
      ${ro ? '' : `<button type="button" class="chip pick" data-addopt>+ Option</button>`}</div>
      <span class="grow"></span>
      ${ro ? '' : `<input type="text" data-optname value="${esc(opt.name)}" style="width:140px" aria-label="Option name"><button class="btn ghost sm" type="button" data-dupopt>Copy option</button>${s.options.length > 1 ? '<button class="btn ghost sm danger" type="button" data-delopt>Delete option</button>' : ''}<button class="btn ghost sm" type="button" data-listtog title="Show or hide supplier list price + discount columns">${showList ? 'Hide' : 'Show'} list $ / discount</button><button class="btn ghost sm danger" type="button" data-delsec>Remove section</button>`}
    </div>
    <div class="tbl-wrap"><table class="lines"><thead><tr>
      <th style="width:96px">Type</th><th style="width:92px">Deal</th><th>Item (customer sees)</th><th style="width:60px">Qty</th><th style="width:58px">Unit</th>
      <th class="cost c-list" style="width:78px" title="Supplier list price per unit">List $</th><th class="cost c-list" style="width:58px" title="Your supplier discount off list">Disc %</th><th class="cost" style="width:86px">COST /unit</th>
      <th style="width:64px">Markup %</th><th class="price" style="width:90px">PRICE /unit</th>
      <th class="cost" style="width:88px">COST total</th><th class="price" style="width:92px">PRICE total</th><th style="width:120px">Partner</th><th style="width:34px"></th>
    </tr></thead><tbody>
      ${opt.lines.map((l, li) => lineRow(l, li, st, ro)).join('') || `<tr><td colspan="14" class="small muted" style="padding:10px">No lines yet. Add a material, delivery or installation line below${ro ? '' : ', or use ✨ Draft lines with Claude'}.</td></tr>`}
    </tbody></table></div>
    ${ro ? '' : `<div class="row" style="padding:8px 12px">${KINDS.map(([k, lab]) => `<button class="btn sm" type="button" data-addl="${k}">+ ${lab}</button>`).join('')}
      <button class="btn sm" type="button" data-addref>+ Referral (partner bills customer)</button>
      <label class="small grow row" style="gap:6px;min-width:220px">Note on document <input type="text" data-secnote value="${esc(s.note || '')}" class="grow"></label></div>`}
    <div class="qtot" data-tot="${si}">${secTot(ot)}</div>
  </section>`;
}
function secTot(ot) {
  return `<div><span class="small muted">Subtotal (materials)</span><b class="p">${money(ot.mat)}</b></div>
    <div><span class="small muted">Delivery</span><b class="p">${money(ot.del)}</b></div>
    <div><span class="small muted">Installation</span><b class="p">${money(ot.ins)}</b></div>
    <div><span class="small muted">Section PRICE</span><b class="p">${money(ot.price)}</b></div>
    <div><span class="small muted">Section COST</span><b class="c">${money(ot.cost)}</b></div>
    <div><span class="small muted">Profit</span><b>${money(ot.profit)}</b></div>
    ${ot.fees ? `<div><span class="small muted">Referral fees</span><b>${money(ot.fees)}</b></div>` : ''}`;
}
const PH = { material: 'e.g. J&K Naval B7 base cabinets', install: 'e.g. Cabinet installation', delivery: 'e.g. Delivery to site', fee: 'e.g. Haul-away fee', discount: 'e.g. Repeat-customer discount', referral: 'e.g. Electrical by partner' };
function lineRow(l, li, st, ro) {
  const x = lineCalc(l, st);
  const dis = ro ? 'disabled' : '';
  const ref = l.deal === 'referral';
  return `<tr data-li="${li}" class="${ref ? 'ref' : ''} ${x.low ? 'low' : ''}">
    <td><select data-k="kind" ${dis}>${KINDS.map(([k, lab]) => `<option value="${k}" ${l.kind === k ? 'selected' : ''}>${lab}</option>`).join('')}</select></td>
    <td><select data-k="deal" ${dis}><option value="resell" ${!ref ? 'selected' : ''}>Resell</option><option value="referral" ${ref ? 'selected' : ''}>Referral</option></select></td>
    <td><input type="text" data-k="desc" value="${esc(l.desc)}" list="pbList" placeholder="${esc(PH[l.deal === 'referral' ? 'referral' : l.kind] || PH.material)}" ${dis}></td>
    <td><input type="text" data-k="qty" value="${esc(l.qty ?? '')}" inputmode="decimal" ${dis}></td>
    <td><input type="text" data-k="unit" value="${esc(l.unit || '')}" ${dis}></td>
    <td class="cost c-list"><input type="text" data-k="list" value="${esc(l.list ?? '')}" inputmode="decimal" placeholder="—" ${dis}></td>
    <td class="cost c-list"><input type="text" data-k="disc" value="${esc(l.disc ?? '')}" inputmode="decimal" placeholder="—" ${dis}></td>
    <td class="cost"><input type="text" data-k="cost" value="${esc(l.cost ?? '')}" inputmode="decimal" placeholder="${x.unitCost != null && l.cost == null ? x.unitCost : ''}" ${dis}></td>
    ${ref ? `<td class="mk" colspan="2"><input type="text" data-k="refPct" value="${esc(l.refPct ?? '')}" placeholder="${st.referralPct}" inputmode="decimal" aria-label="Referral %" ${dis}><span class="small muted">% referral fee to TCRS</span></td>`
      : `<td class="mk"><input type="text" data-k="markup" value="${esc(l.markup ?? '')}" placeholder="${l.kind === 'discount' ? '' : st.markupDefault}" inputmode="decimal" ${dis}></td>
    <td class="price"><input type="text" data-k="price" value="${esc(l.price ?? '')}" placeholder="${x.unitPrice != null && l.price == null ? Math.abs(x.unitPrice) : ''}" inputmode="decimal" ${dis}></td>`}
    <td class="cost n" data-c="cost">${ref ? `<span class="small">partner ${money(x.partnerAmt)}</span>` : money(x.cost)}</td>
    <td class="price n" data-c="price">${ref ? `<b>fee ${money(x.fee)}</b>` : money(x.price)}</td>
    <td><input type="text" data-k="partner" value="${esc(l.partner || '')}" list="ptList" placeholder="${l.kind === 'install' || ref ? 'Contractor' : 'Supplier'}" ${dis}></td>
    <td>${ro ? '' : `<button class="btn ghost sm" type="button" data-more aria-label="More">⋯</button>`}</td>
  </tr>`;
}

function curSec(si) { const s = live.q.sections[si]; return { s, o: s.options.find((x) => x.id === s.chosen) || s.options[0] }; }
function save() {
  clearTimeout(saveTimer);
  dirty = true;
  const { q } = live;
  saveTimer = setTimeout(async () => {
    try { await D.update('quotes', q.id, { sections: q.sections, settings: q.settings, mode: q.mode, status: q.status, number: q.number }); }
    catch (e) { toast('Not saved: ' + e.message); }
    finally { dirty = false; }
  }, 500);
}
function refreshTotals() {
  const { q, c, el } = live;
  const st = quoteSt(q);
  q.sections.forEach((s, si) => {
    const { o } = curSec(si);
    $$(`[data-si="${si}"] tbody tr`, el).forEach((tr) => {
      const l = o.lines[+tr.dataset.li]; if (!l) return;
      const x = lineCalc(l, st);
      tr.classList.toggle('low', !!x.low);
      $('[data-c="cost"]', tr).innerHTML = l.deal === 'referral' ? `<span class="small">partner ${money(x.partnerAmt)}</span>` : money(x.cost);
      $('[data-c="price"]', tr).innerHTML = l.deal === 'referral' ? `<b>fee ${money(x.fee)}</b>` : money(x.price);
      const ci = $('[data-k="cost"]', tr); if (ci && l.cost == null) ci.placeholder = x.unitCost ?? '';
      const pi = $('[data-k="price"]', tr); if (pi && l.price == null) pi.placeholder = x.unitPrice != null ? Math.abs(x.unitPrice) : '';
    });
    const tot = $(`[data-tot="${si}"]`, el); if (tot) tot.innerHTML = secTot(optionCalc(o, st));
  });
  $('#projBar', el).innerHTML = projBar(quoteCalc(q, c, st));
}

function wire() {
  const { q, c, el } = live;
  $$('[data-mode]', el).forEach((b) => (b.onclick = async () => {
    if (b.dataset.mode === q.mode) return;
    q.mode = b.dataset.mode;
    if (q.mode === 'quote' && (q.number || '').startsWith('E-')) q.number = q.number.replace(/^E-/, 'Q-');
    if (q.mode === 'estimate' && (q.number || '').startsWith('Q-')) q.number = q.number.replace(/^Q-/, 'E-');
    await D.update('quotes', q.id, { mode: q.mode, number: q.number });
    logEvent(c.id, 'system', q.mode === 'quote' ? 'Estimate switched to final quote' : 'Switched back to estimate');
    draw();
  }));
  $('#qStatus', el).onchange = async (e) => {
    q.status = e.target.value;
    const patch = { status: q.status };
    if (q.status === 'sent') patch.sent_at = new Date().toISOString();
    if (q.status === 'accepted') { patch.accepted_at = new Date().toISOString(); }
    await D.update('quotes', q.id, patch);
    logEvent(c.id, 'system', `Quote ${q.number} marked ${q.status}`);
    if (q.status === 'accepted') { await learnFromQuote(q, c, false); if (stageIdx(c.stage) < 5) moveStage(c, 'accepted'); }
  };
  $$('[data-mk]', el).forEach((b) => (b.onclick = () => { q.settings = { ...(q.settings || {}), markup: +b.dataset.mk }; save(); draw(); }));
  $('#qMk', el).onchange = (e) => { q.settings = { ...(q.settings || {}), markup: n(e.target.value) }; save(); draw(); };
  $('#qTax', el).onchange = (e) => { q.settings = { ...(q.settings || {}), taxOn: e.target.checked }; save(); draw(); };
  $('#qTaxR', el).onchange = (e) => { q.settings = { ...(q.settings || {}), taxRate: n(e.target.value) }; save(); refreshTotals(); };
  $('#addSec', el)?.addEventListener('change', (e) => { if (!e.target.value) return; q.sections.push(newSection(e.target.value)); save(); draw(); });
  $('#qDoc', el).onclick = () => openDoc(q, c);
  $('#qAI', el).onclick = () => draftWithClaude(q, c);

  $$('.qsec', el).forEach((secEl) => {
    const si = +secEl.dataset.si;
    const { s } = curSec(si);
    $$('[data-opt]', secEl).forEach((b) => (b.onclick = () => { s.chosen = b.dataset.opt; save(); draw(); }));
    $('[data-addopt]', secEl)?.addEventListener('click', () => { const o = { id: D.uuid(), name: 'Option ' + String.fromCharCode(65 + s.options.length), lines: [] }; s.options.push(o); s.chosen = o.id; save(); draw(); });
    $('[data-dupopt]', secEl)?.addEventListener('click', () => { const { o } = curSec(si); const cp = structuredClone(o); cp.id = D.uuid(); cp.name = 'Option ' + String.fromCharCode(65 + s.options.length); cp.lines.forEach((l) => (l.id = D.uuid())); s.options.push(cp); s.chosen = cp.id; save(); draw(); });
    $('[data-delopt]', secEl)?.addEventListener('click', () => { s.options = s.options.filter((o) => o.id !== s.chosen); s.chosen = s.options[0].id; save(); draw(); });
    $('[data-listtog]', secEl)?.addEventListener('click', () => { s.showList = !secEl.classList.contains('nolist') ? false : true; if (!s.showList && s.options.some((o) => o.lines.some((l) => l.list != null || l.disc != null))) { toast('Some lines use list price + discount, so the columns stay visible.'); return; } save(); draw(); });
    $('[data-delsec]', secEl)?.addEventListener('click', () => { const old = structuredClone(q.sections); q.sections.splice(si, 1); save(); draw(); toast(`${s.product} removed.`, () => { q.sections = old; save(); draw(); }); });
    $('[data-optname]', secEl)?.addEventListener('change', (e) => { curSec(si).o.name = e.target.value.trim() || 'Option'; save(); draw(); });
    $('[data-secnote]', secEl)?.addEventListener('change', (e) => { s.note = e.target.value; save(); });
    $$('[data-addl]', secEl).forEach((b) => (b.onclick = () => { curSec(si).o.lines.push(newLine(b.dataset.addl, b.dataset.addl === 'install' ? { unit: 'job' } : b.dataset.addl === 'delivery' ? { unit: 'trip' } : {})); save(); draw(); }));
    $('[data-addref]', secEl)?.addEventListener('click', () => { curSec(si).o.lines.push(newLine('install', { deal: 'referral', unit: 'job' })); save(); draw(); });
    $$('tbody tr', secEl).forEach((tr) => {
      const li = +tr.dataset.li;
      const getL = () => curSec(si).o.lines[li];
      $$('[data-k]', tr).forEach((inp) => {
        const k = inp.dataset.k;
        const numeric = ['qty', 'list', 'disc', 'cost', 'markup', 'price', 'refPct'].includes(k);
        inp.addEventListener('input', () => { getL()[k] = numeric ? n(inp.value) : inp.value; if (numeric) refreshTotals(); });
        inp.addEventListener('change', () => {
          const l = getL();
          l[k] = numeric ? n(inp.value) : inp.value;
          if (k === 'desc') fromPricebook(l, s.product);
          save();
          if (['kind', 'deal', 'desc'].includes(k)) draw(); else refreshTotals();
        });
      });
      $('[data-more]', tr)?.addEventListener('click', () => lineMore(si, li));
    });
  });
}

function fromPricebook(l, product) {
  const p = S.pricebook.find((x) => x.name.toLowerCase() === (l.desc || '').trim().toLowerCase());
  if (!p) return;
  if (l.cost == null && l.list == null) l.cost = p.cost;
  if (l.markup == null && p.markup != null) l.markup = p.markup;
  if (!l.unit || l.unit === 'ea') l.unit = p.unit || l.unit;
  if (!l.partner) l.partner = p.partner || '';
  if (p.kind && KINDS.some(([k]) => k === p.kind)) l.kind = p.kind;
  l.pbId = p.id;
  D.update('pricebook', p.id, { uses: (p.uses || 0) + 1 }).catch(() => {});
  toast(`Filled from the price book: cost $${p.cost ?? '?'}/${p.unit || 'ea'}.`);
}

function lineMore(si, li) {
  const { o } = curSec(si);
  const l = o.lines[li];
  modal('<h2>Line details</h2>', `
    <label class="field"><span class="lbl">Customer note (prints under the line on the quote)</span><input type="text" id="lmC" value="${esc(l.cnote || '')}"></label>
    <label class="field"><span class="lbl">Internal note (never prints: supplier quote #, contractor, terms)</span><input type="text" id="lmN" value="${esc(l.note || '')}"></label>
    ${l.deal === 'referral' ? `<label class="field"><span class="lbl">Referral fee status</span><select id="lmF">${['expected', 'invoiced', 'received'].map((s) => `<option ${(l.feeStatus || 'expected') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}
    <label class="small row"><input type="checkbox" id="lmPB"> Save this line's COST to the price book now</label>
    <div class="row"><button class="btn primary" type="button" id="lmOk">Save</button><button class="btn" type="button" id="lmUp">Move up</button><button class="btn danger" type="button" id="lmDel">Delete line</button></div>`,
  (box, close) => {
    $('#lmOk', box).onclick = async () => {
      l.cnote = $('#lmC', box).value; l.note = $('#lmN', box).value;
      if ($('#lmF', box)) l.feeStatus = $('#lmF', box).value;
      if ($('#lmPB', box).checked) await upsertPricebook(l, live.q.sections[si].product, false);
      save(); close(); draw();
    };
    $('#lmUp', box).onclick = () => { if (li > 0) { [o.lines[li - 1], o.lines[li]] = [o.lines[li], o.lines[li - 1]]; save(); } close(); draw(); };
    $('#lmDel', box).onclick = () => { const old = o.lines.splice(li, 1)[0]; save(); close(); draw(); toast('Line deleted.', () => { o.lines.splice(li, 0, old); save(); draw(); }); };
  });
}

/* ───────── learning ───────── */
async function upsertPricebook(l, product, won) {
  const name = (l.desc || '').trim();
  const x = lineCalc(l);
  if (!name || x.unitCost == null) return;
  const p = S.pricebook.find((r) => r.name.toLowerCase() === name.toLowerCase());
  const hist = { cost: x.unitCost, at: todayISO(), won };
  const markup = l.deal === 'referral' ? null : x.markup != null ? r2(x.markup) : null;
  if (p) {
    await D.update('pricebook', p.id, { cost: x.unitCost, markup: markup ?? p.markup, unit: l.unit || p.unit, partner: l.partner || p.partner, kind: l.kind, product: product || p.product, won: (p.won || 0) + (won ? 1 : 0), history: [...(p.history || []), hist].slice(-30) });
  } else {
    await D.insert('pricebook', { name, product, kind: l.kind, unit: l.unit || 'ea', cost: x.unitCost, markup, partner: l.partner || null, uses: 1, won: won ? 1 : 0, history: [hist] });
  }
}
async function ensurePartner(name, kind, deal, won) {
  if (!name) return;
  const p = S.partners.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  const ptype = kind === 'install' || deal === 'referral' ? 'contractor' : 'supplier';
  if (p) { if (won) await D.update('partners', p.id, { jobs: (p.jobs || 0) + 1 }); }
  else await D.insert('partners', { name: name.trim(), ptype, jobs: won ? 1 : 0, referral_pct: deal === 'referral' ? settings().referralPct : null });
}
export async function learnFromQuote(q, c, paid) {
  const flag = paid ? 'learnedPaid' : 'learnedAccepted';
  if (q.settings?.[flag]) return;
  for (const s of q.sections || []) {
    const o = s.options.find((x) => x.id === s.chosen) || s.options[0];
    for (const l of o?.lines || []) {
      if (l.deal !== 'referral' && l.kind !== 'discount') await upsertPricebook(l, s.product, paid);
      await ensurePartner(l.partner, l.kind, l.deal, paid);
    }
  }
  q.settings = { ...(q.settings || {}), [flag]: true };
  await D.update('quotes', q.id, { settings: q.settings });
}

/* ───────── Claude drafts lines ───────── */
async function draftWithClaude(q, c) {
  modal('<h2>Draft lines with Claude</h2>', `
    <p class="small">Claude uses this customer's products, sizes, layout takeoff, supplier quotes already on the estimate, and your price book. It only fills a COST it can back up; anything else is left blank for you.</p>
    <label class="field"><span class="lbl">Anything specific? (optional)</span><input type="text" id="aiI" placeholder="e.g. add install and delivery for the cabinets; Option B with carpet"></label>
    <div class="row"><button class="btn primary" type="button" id="aiGo">Draft</button></div><div id="aiOut"></div>`,
  (box, close) => {
    $('#aiGo', box).onclick = async () => {
      const out = $('#aiOut', box);
      out.innerHTML = '<div class="thinking"><span class="spin"></span>Drafting…</div>';
      const lay = custLayouts(c.id)[0];
      const ctx = { customer: { name: c.name, products: c.products, services: c.services, city: c.city, budget: c.budget, finishes: c.data?.finishes, tldr: c.tldr }, sizes: custSizes(c.id).map((s) => ({ what: s.what, value: s.value, unit: s.unit, source: s.source })), takeoff: lay?.takeoff || null, currentEstimate: q.sections.map((s) => ({ product: s.product, options: s.options.map((o) => ({ name: o.name, lines: o.lines.map((l) => ({ kind: l.kind, deal: l.deal, desc: l.desc, qty: l.qty, unit: l.unit, cost: lineCalc(l).unitCost, partner: l.partner })) })) })) };
      try {
        const txt = await D.ai({ model: 'default', max_tokens: 4000, system: `You draft estimate lines for Twin Cities Remodeling Supply. COST = what TCRS pays a supplier or contractor per unit. Never invent a cost: use a price-book cost or a cost already on the estimate, else null with note "needs cost". Do not set customer prices; markup is applied later. Return JSON only: {"lines":[{"product":"Cabinets|Countertops|Flooring|Appliances|Other","option":"Option A","kind":"material|install|delivery|fee","deal":"resell|referral","desc":"","qty":0,"unit":"","cost":null,"partner":"","note":"where the cost came from"}],"assumptions":[""]}. Do not repeat lines already on the estimate.`, content: [{ type: 'text', text: `Today ${todayISO()}.\nRequest: ${$('#aiI', box).value || 'draft the missing lines'}\n\n${learnedContext()}\n\nJOB:\n${JSON.stringify(ctx)}` }] });
        const a = txt.indexOf('{'), z = txt.lastIndexOf('}');
        const j = JSON.parse(txt.slice(a, z + 1));
        const lines = j.lines || [];
        out.innerHTML = `<div class="tbl-wrap"><table class="simple"><thead><tr><th></th><th>Product</th><th>Item</th><th>Qty</th><th style="color:var(--cost)">COST/unit</th><th>Where from</th></tr></thead><tbody>${lines.map((l, i) => `<tr><td><input type="checkbox" data-ai="${i}" checked></td><td>${esc(l.product)}<div class="small muted">${esc(l.option || '')}</div></td><td>${esc(l.desc)}<div class="small muted">${esc(l.kind)} · ${esc(l.deal)}</div></td><td>${esc(l.qty)} ${esc(l.unit)}</td><td>${l.cost != null ? money(n(l.cost)) : '<span style="color:var(--red)">needs cost</span>'}</td><td class="small">${esc(l.note || '')}</td></tr>`).join('')}</tbody></table></div>
          ${(j.assumptions || []).length ? `<p class="small"><b>Assumptions (estimates, verify):</b> ${j.assumptions.map(esc).join('; ')}</p>` : ''}
          <div class="row"><button class="btn primary" type="button" id="aiAdd">Add ticked lines</button><button class="btn sm" type="button" data-fb="1">👍</button><button class="btn sm" type="button" data-fb="-1">👎</button><input type="text" id="aiFb" class="grow" placeholder="Feedback for next time"></div>`;
        let rating = 0;
        $$('[data-fb]', out).forEach((b) => (b.onclick = () => { rating = +b.dataset.fb; $$('[data-fb]', out).forEach((x) => x.classList.toggle('primary', x === b)); }));
        $('#aiAdd', out).onclick = async () => {
          const pick = lines.filter((_, i) => $(`[data-ai="${i}"]`, out).checked);
          for (const l of pick) {
            const prod = PRODUCTS.includes(l.product) ? l.product : 'Other';
            let s = live.q.sections.find((x) => x.product === prod);
            if (!s) { s = newSection(prod); live.q.sections.push(s); }
            let o = s.options.find((x) => x.name === l.option) || s.options.find((x) => x.id === s.chosen);
            o.lines.push(newLine(['material', 'install', 'delivery', 'fee'].includes(l.kind) ? l.kind : 'material', { deal: l.deal === 'referral' ? 'referral' : 'resell', desc: l.desc || '', qty: n(l.qty) ?? 1, unit: l.unit || 'ea', cost: n(l.cost), partner: l.partner || '', note: l.note || 'Drafted by Claude' }));
          }
          await D.update('quotes', live.q.id, { sections: live.q.sections });
          if (rating || $('#aiFb', out).value.trim()) await D.insert('feedback', { context: 'lines', rating: rating || null, note: $('#aiFb', out).value.trim() || null, by: S.me?.id });
          close(); draw();
        };
      } catch (e) { out.innerHTML = `<p style="color:var(--red)">${esc(e.message)}</p>`; }
    };
  }, false);
}

/* ───────── customer document ───────── */
export function missingCost(q) {
  const out = [];
  (q.sections || []).forEach((s) => s.options.forEach((o) => o.lines.forEach((l) => {
    const x = lineCalc(l);
    if (l.kind !== 'discount' && x.unitCost == null && n(l.price) == null) out.push(`${s.product} · ${o.name}: ${l.desc || 'unnamed line'}`);
  })));
  return out;
}
function rangeOf(v, pct) {
  if (!pct) return money0(Math.round(v));
  const lo = Math.floor(v * (1 - pct / 100) / 100) * 100, hi = Math.ceil(v * (1 + pct / 100) / 100) * 100;
  return `${money0(lo)} – ${money0(hi)}`;
}
export function docHTML(q, c) {
  const st = quoteSt(q);
  const co = settings().company;
  const t = quoteCalc(q, c, st);
  const isQ = q.mode === 'quote';
  const pct = isQ ? 0 : (n(q.settings?.range) ?? settings().estimateRangePct);
  const date = (q.sent_at || new Date().toISOString()).slice(0, 10);
  const valid = addDays(date, n(q.settings?.validDays) ?? settings().quoteValidDays);
  const showRefName = !!q.settings?.showReferralName;
  const S1 = 'font-family:Inter,Arial,sans-serif;color:#1B2620;';
  const secs = (q.sections || []).map((s) => {
    if (!isQ) {
      return `<div class="pdf-keep" style="border:1px solid #DAD1C1;border-radius:8px;padding:12px 14px;margin:0 0 12px">
        <div style="font:700 15px Cabin,Arial,sans-serif;color:#163126">${esc(s.product)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">${s.options.map((o) => { const x = optionCalc(o, st); const refs = o.lines.filter((l) => l.deal === 'referral'); return `<div style="flex:1;min-width:180px;background:${o.id === s.chosen ? '#EEF5EF' : '#F7F3EC'};border-radius:6px;padding:8px 10px">
          <div style="font-weight:700">${esc(o.name)}</div>
          <div style="font:700 18px Cabin,Arial,sans-serif;margin-top:2px">${x.price > 0 ? rangeOf(x.price, pct) : 'Price to come'}</div>
          <div style="font-size:11px;color:#5D6A61">${[x.mat ? 'materials' : '', x.del ? 'delivery' : '', x.ins ? 'installation' : ''].filter(Boolean).join(' · ') || ''}${refs.length ? ' · plus partner work billed directly' : ''}</div></div>`; }).join('')}</div>
        ${s.note ? `<div style="font-size:11.5px;color:#5D6A61;margin-top:6px">${esc(s.note)}</div>` : ''}</div>`;
    }
    const o = s.options.find((x) => x.id === s.chosen) || s.options[0];
    const x = optionCalc(o, st);
    const rows = (k) => o.lines.filter((l) => l.deal !== 'referral' && (BK[l.kind] || 'mat') === k).map((l) => { const y = lineCalc(l, st); return `<tr class="pdf-keep"><td style="padding:5px 6px;border-bottom:1px solid #ECE5D9">${esc(l.desc || '')}${l.cnote ? `<div style="font-size:11px;color:#5D6A61">${esc(l.cnote)}</div>` : ''}</td><td style="padding:5px 6px;text-align:right;border-bottom:1px solid #ECE5D9">${esc(y.qty)} ${esc(l.unit || '')}</td><td style="padding:5px 6px;text-align:right;border-bottom:1px solid #ECE5D9">${money(y.unitPrice)}</td><td style="padding:5px 6px;text-align:right;border-bottom:1px solid #ECE5D9">${money(y.price)}</td></tr>`; }).join('');
    const refs = o.lines.filter((l) => l.deal === 'referral');
    const tr = (lab, v, bold) => `<tr class="pdf-keep"><td colspan="3" style="padding:5px 6px;text-align:right;${bold ? 'font-weight:700' : 'color:#5D6A61'}">${lab}</td><td style="padding:5px 6px;text-align:right;${bold ? 'font-weight:700;font-size:14px' : ''}">${money(v)}</td></tr>`;
    return `<div style="margin:0 0 16px"><div class="pdf-keep" style="font:700 15px Cabin,Arial,sans-serif;color:#163126;border-bottom:2px solid #163126;padding:4px 0;margin-bottom:2px">${esc(s.product)}${s.options.length > 1 ? ` <span style="font-weight:500;color:#5D6A61;font-size:12px">· ${esc(o.name)}</span>` : ''}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <tr class="pdf-keep"><th style="text-align:left;padding:4px 6px;font-size:10px;letter-spacing:.06em;color:#5D6A61">ITEM</th><th style="text-align:right;padding:4px 6px;font-size:10px;color:#5D6A61">QTY</th><th style="text-align:right;padding:4px 6px;font-size:10px;color:#5D6A61">PRICE</th><th style="text-align:right;padding:4px 6px;font-size:10px;color:#5D6A61">AMOUNT</th></tr>
      ${rows('mat')}${tr('Subtotal (materials)', x.mat)}${rows('del')}${tr('Delivery', x.del)}${rows('ins')}${tr('Installation', x.ins)}${tr(esc(s.product) + ' total', x.price, true)}
      ${refs.map((l) => { const y = lineCalc(l, st); return `<tr class="pdf-keep"><td colspan="3" style="padding:5px 6px;font-size:11.5px;color:#5D6A61">${esc(l.desc || 'Partner work')}: billed directly by ${showRefName && l.partner ? esc(l.partner) : 'our partner'}, not included above</td><td style="padding:5px 6px;text-align:right;font-size:11.5px;color:#5D6A61">${money(y.partnerAmt)}</td></tr>`; }).join('')}
      </table>${s.note ? `<div class="pdf-keep" style="font-size:11.5px;color:#5D6A61;margin-top:4px">${esc(s.note)}</div>` : ''}</div>`;
  }).join('');
  const terms = q.settings?.terms || (isQ
    ? `Quote valid until ${fmtDateLong(valid)}. Prices include only the items listed.${t.depositCredit ? ' Your design deposit is credited above.' : ''}`
    : `This is an estimate, not a quote. Ranges are ±${pct}% and depend on final measurements and selections. An itemized quote follows the design deposit (${money0(settings().depositAmount)}, credited to your project if you proceed). Valid until ${fmtDateLong(valid)}.`);
  return `<div style="${S1}width:816px;padding:44px 52px 30px;background:#fff;box-sizing:border-box">
    <div class="pdf-keep" style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #163126;padding-bottom:14px">
      <img src="img/logo-cream.png" alt="Twin Cities Remodeling Supply" style="height:96px;border-radius:6px">
      <div style="text-align:right;font-size:12px;line-height:1.5">
        <div style="font:700 26px Cabin,Arial,sans-serif;color:#163126;letter-spacing:.02em">${isQ ? 'QUOTE' : 'ESTIMATE'}</div>
        <div><b>${esc(q.number || '')}</b></div><div>${fmtDateLong(date)}</div><div>Valid until ${fmtDateLong(valid)}</div>
      </div></div>
    <div class="pdf-keep" style="display:flex;justify-content:space-between;gap:20px;margin:14px 0 18px;font-size:12px;line-height:1.5">
      <div><div style="font-size:10px;letter-spacing:.08em;color:#AE6741;font-weight:700">PREPARED FOR</div><div style="font-weight:700;font-size:14px">${esc(c.name || '')}</div>${c.address ? `<div>${esc(c.address)}</div>` : ''}${c.city ? `<div>${esc(c.city)}${c.zip ? ' ' + esc(c.zip) : ''}</div>` : ''}${c.phone ? `<div>${esc(c.phone)}</div>` : ''}${c.email ? `<div>${esc(c.email)}</div>` : ''}</div>
      <div style="text-align:right"><div style="font-size:10px;letter-spacing:.08em;color:#AE6741;font-weight:700">FROM</div><div style="font-weight:700">${esc(co.name)}</div><div>${esc(co.address)}</div><div>${esc(co.phone)} · ${esc(co.email)}</div><div>${esc(co.web)}</div></div></div>
    ${secs || '<p>No items yet.</p>'}
    <div class="pdf-keep" style="background:#163126;color:#EEE5D8;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <div style="font:700 14px Cabin,Arial,sans-serif;letter-spacing:.06em">PROJECT TOTAL</div>
      <div style="text-align:right">${t.tax ? `<div style="font-size:11px">Sales tax ${t.taxRate}% on materials: ${money(t.tax)}</div>` : ''}${t.depositCredit ? `<div style="font-size:11px">Design deposit credit: −${money(t.depositCredit)}</div>` : ''}${t.revFeeCredit ? `<div style="font-size:11px">Revision fees credit: −${money(t.revFeeCredit)}</div>` : ''}
      <div style="font:700 22px Cabin,Arial,sans-serif">${isQ ? money(t.total) : rangeOf(t.total, pct)}</div>${!isQ && missingCost(q).length ? '<div style="font-size:11px">Some items still to be priced</div>' : ''}</div></div>
    <div class="pdf-keep" style="font-size:11px;color:#5D6A61;margin-top:14px;line-height:1.5">${esc(terms)}</div>
    <div class="pdf-keep" style="font-size:11px;color:#5D6A61;margin-top:8px">Questions? Call ${esc(co.phone)} or email ${esc(co.email)}.</div>
  </div>`;
}
const BK = { material: 'mat', fee: 'mat', discount: 'mat', delivery: 'del', install: 'ins' };

function openDoc(q, c) {
  const isQ = q.mode === 'quote';
  const dep = c.data?.deposit || {};
  modal(`<h2>${isQ ? 'Quote' : 'Estimate'} for ${esc(c.name || '')}</h2>`, `
    <p class="small muted">What the customer sees. Costs, partners' names, markup and internal notes never print.</p>
    ${missingCost(q).length ? `<div class="pill st-red" style="align-self:flex-start;white-space:normal">${missingCost(q).length} line${missingCost(q).length > 1 ? 's have' : ' has'} no COST or PRICE yet: ${esc(missingCost(q).slice(0, 4).join('; '))}${missingCost(q).length > 4 ? '…' : ''}</div>` : ''}
    <div class="row small">
      ${isQ ? '' : `<label class="row" style="gap:4px">Range ± <input type="text" id="dR" value="${esc(q.settings?.range ?? settings().estimateRangePct)}" style="width:50px">%</label>`}
      <label class="row" style="gap:4px">Valid <input type="text" id="dV" value="${esc(q.settings?.validDays ?? settings().quoteValidDays)}" style="width:50px"> days</label>
      <label class="row" style="gap:4px"><input type="checkbox" id="dRN" ${q.settings?.showReferralName ? 'checked' : ''}> Name the partner on referral lines</label>
      ${isQ ? `<label class="row" style="gap:4px"><input type="checkbox" id="dNC" ${q.settings?.noDepositCredit ? '' : 'checked'}> Credit design deposit${dep.paidAt ? '' : ' (not paid yet)'}</label>` : ''}
    </div>
    <label class="field"><span class="lbl">Terms (leave blank for the default)</span><input type="text" id="dT" value="${esc(q.settings?.terms || '')}"></label>
    <div style="overflow:auto;border:1px solid var(--line);border-radius:8px;background:#E9E4DA;padding:12px;max-height:60vh"><div id="docPrev" style="width:816px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.15)">${docHTML(q, c)}</div></div>
    <div class="row"><button class="btn primary" type="button" id="dPdf">Download PDF</button>
      <button class="btn" type="button" id="dSent">Mark sent + save PDF to files</button>
      <button class="btn" type="button" id="dCopy">Copy as text</button><span class="small muted" id="dMsg"></span></div>`,
  (box, close) => {
    const upd = async (k, v) => { q.settings = { ...(q.settings || {}), [k]: v }; await D.update('quotes', q.id, { settings: q.settings }); $('#docPrev', box).innerHTML = docHTML(q, c); };
    $('#dR', box)?.addEventListener('change', (e) => upd('range', n(e.target.value)));
    $('#dV', box).onchange = (e) => upd('validDays', n(e.target.value));
    $('#dRN', box).onchange = (e) => upd('showReferralName', e.target.checked);
    $('#dNC', box)?.addEventListener('change', (e) => upd('noDepositCredit', !e.target.checked));
    $('#dT', box).onchange = (e) => upd('terms', e.target.value.trim() || null);
    const fname = () => `${(c.name || 'Customer').replace(/[^\w ]+/g, '').trim()} ${isQ ? 'Quote' : 'Estimate'} ${q.number || ''}.pdf`;
    $('#dPdf', box).onclick = async () => {
      $('#dMsg', box).textContent = 'Building PDF…';
      try { const blob = await buildPdf(q, c); downloadBlob(blob, fname()); $('#dMsg', box).textContent = 'Downloaded.'; } catch (e) { $('#dMsg', box).textContent = e.message; }
    };
    $('#dSent', box).onclick = async () => {
      $('#dMsg', box).textContent = 'Saving…';
      try {
        const blob = await buildPdf(q, c);
        const file = new File([blob], fname(), { type: 'application/pdf' });
        const path = `${c.id}/${Date.now()}-${fname().replace(/[^\w.\-]+/g, '_')}`;
        await D.upload(file, path);
        const ft = isQ ? 'Quote' : 'Estimate';
        const v = Math.max(0, ...custFiles(c.id).filter((f) => f.ftype === ft).map((f) => f.version)) + 1;
        await D.insert('files', { customer_id: c.id, path, name: file.name, ftype: ft, version: v, size: file.size, mime: 'application/pdf', by: S.me?.id });
        await D.update('quotes', q.id, { status: 'sent', sent_at: new Date().toISOString() });
        await logEvent(c.id, 'system', `${ft} ${q.number} sent (v${v})`);
        await D.insert('actions', { customer_id: c.id, title: `Customer to review ${ft.toLowerCase()} ${q.number}`, due: addDays(todayISO(), 3), waiting_on: 'customer', done: false });
        downloadBlob(blob, fname());
        close();
        const to = isQ ? 'quote' : 'estimate';
        if (stageIdx(c.stage) < stageIdx(to)) moveStage(c, to);
      } catch (e) { $('#dMsg', box).textContent = e.message; }
    };
    $('#dCopy', box).onclick = async () => {
      const txt = $('#docPrev', box).innerText;
      try { await navigator.clipboard.writeText(txt); $('#dMsg', box).textContent = 'Copied.'; } catch { $('#dMsg', box).textContent = 'Copy blocked; select the text instead.'; }
    };
  }, false);
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function buildPdf(q, c) {
  if (!window.html2canvas || !window.jspdf) throw new Error('PDF tools are still loading. Try again in a moment.');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;background:#fff;z-index:-1';
  holder.innerHTML = docHTML(q, c);
  document.body.appendChild(holder);
  try {
    await document.fonts?.ready;
    await Promise.all([...holder.querySelectorAll('img')].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    const root = holder.firstElementChild;
    const scale = 2;
    const canvas = await window.html2canvas(root, { scale, backgroundColor: '#ffffff', useCORS: true });
    const top = root.getBoundingClientRect().top;
    const breaks = [...root.querySelectorAll('.pdf-keep')].map((e) => (e.getBoundingClientRect().top - top) * scale).sort((a, b) => a - b);
    const pageH = 1056 * scale, footer = 40 * scale, headPad = 40 * scale;
    const pages = []; let y = 0;
    while (y < canvas.height - 2) {
      const room = (pages.length ? pageH - headPad : pageH) - footer;
      let end = y + room;
      if (end < canvas.height) { const b = breaks.filter((v) => v > y + 100 && v <= end).pop(); if (b) end = b; }
      else end = canvas.height;
      pages.push([y, end]); y = end;
    }
    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    pages.forEach(([a, b], i) => {
      if (i) pdf.addPage();
      const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = b - a;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(canvas, 0, a, canvas.width, b - a, 0, 0, canvas.width, b - a);
      const k = 612 / canvas.width;
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, i ? 30 : 0, 612, (b - a) * k);
      if (pages.length > 1) { pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`Page ${i + 1} of ${pages.length}`, 612 - 40, 792 - 18, { align: 'right' }); }
    });
    return pdf.output('blob');
  } finally { holder.remove(); }
}
