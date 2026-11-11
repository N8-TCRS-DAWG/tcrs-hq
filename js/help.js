// Help & SOPs, and "Prices & partners" (what HQ learns from + settings).
import * as D from './data.js?v=20261111163514';
import { S, STAGES, PRODUCTS, esc, $, $$, n, toast, canWrite, settings, DEFAULT_SETTINGS, money, fmtDate } from './core.js?v=20261111163514';

const FORMS = 'https://script.google.com/macros/s/AKfycby_jpUiOvp36ytos3qfvdOpeaG_xvmkWuZLqGlufbKH9vlwi36wJmW0ZbyqJmWY6iix/exec';
export const STARTER_DOCS = [
  { kind: 'Doc', pinned: true, title: 'Customer intake form', url: `${FORMS}?page=intake`, tags: ['intake', 'link'], body: 'Send to every new lead. Answers land in the "TCRS Design Deposits" sheet (Customer Contact tab) and email nathan@. Add &lead=L-… to show saved answers.' },
  { kind: 'Doc', pinned: true, title: 'Design deposit agreement ($250)', url: FORMS, tags: ['deposit', 'link'], body: `Personal link: ${FORMS}?lead=<Lead ID>&pay=<QuickBooks payment link>\nLink builder (internal): ${FORMS}?builder=1\nSend to slow, vague or difficult leads before design work.` },
  { kind: 'SOP', pinned: true, title: 'COST vs PRICE', tags: ['pricing'], body: 'COST = $ TCRS spends on the product or service (supplier or contractor).\nPRICE = $ TCRS receives from the customer.\nMarkup = PRICE ÷ COST − 1. Minimum 25% on every line; one-off customers default to 55%.\nSupplier discount: type the list price and discount % and HQ works out the COST.\nCosts, partner names, markup and internal notes never print on customer documents.' },
  { kind: 'SOP', pinned: true, title: 'Resell vs referral', tags: ['pricing', 'contractors'], body: 'Resell: TCRS buys the product or sub work at COST, adds markup, and bills the customer. One company for the customer.\nReferral: the contractor bills the customer directly and pays TCRS a referral fee (usually 15%). Add it as a "Referral" line. It is not in the customer total; it shows as partner work billed directly. Track the fee on Money & dates: expected → invoiced → received.' },
  { kind: 'SOP', pinned: true, title: 'Using TCRS HQ: the fast way', tags: ['how-to'], body: 'Get anything in: press D, drag files onto any screen, or paste (Ctrl/⌘ V) an email or screenshot anywhere outside a text box. Inside a customer, it goes to that customer. Ctrl/⌘ Enter = Read with Claude.\nBoard: N = new lead by hand, / = search. "Due today / late" lists today\'s work. The colored bubbles list every step by whose move it is.\nCustomer page: ‹ › (or ← →) moves to the previous/next customer. Click any stage to move the job, in any order; HQ just notes what isn\'t on file yet. Use the "Common next steps" chips so a card never sits without a next step.\nEverything saves as you type; "✓ Saved" flashes bottom-left. "Not saved" in red means check your connection.' },
  { kind: 'SOP', title: 'New lead: first 24 hours', tags: ['intake'], body: '1. Drop the message, call notes or photos into HQ. Check what Claude read, then Save.\n2. Send the intake form (pinned above).\n3. Make sure the card has a next step and whose move it is. No step = red card.\n4. Book a measure visit when you can: close rate is higher with one.' },
  { kind: 'SOP', title: 'Quote format', tags: ['quote'], body: 'Each product is its own section: Subtotal (materials) → Delivery → Installation → product total. PROJECT TOTAL at the bottom. Prices only.\nCountertops include a 4" backsplash by default.\nCabinets: hinges and drawer slides included; knobs and pulls not.\nEstimates show ranges per option with no line items. Itemized quotes come after the $250 design deposit.' },
  { kind: 'FAQ', title: 'How many layout revisions are free?', tags: ['revisions', 'deposit'], body: 'Design deposit terms v1.3: 2 revisions included, a 3rd if all 12 intake questions are answered, then $200 per revision, paid before the revision. The deposit and paid revision fees are credited if they sign within 60 days of the final quote (projects over $250). HQ counts revisions on each card ("Rev 3/2") and adds a fee step when one goes over.' },
  { kind: 'FAQ', title: 'Where does payment get recorded?', tags: ['payment'], body: 'QuickBooks payments: automatic. HQ reads the QuickBooks "Payment received" emails in nathan@ every 10 minutes and adds each one to the matching customer (by email, then name). Anything it can\'t match shows as "💳 payments to match" on the Board. Cash, check and Clover: type them under Money & dates → Other payments. When a job is paid in full, HQ offers to move it to Paid.' },
  { kind: 'FAQ', title: 'Can customers visit a cabinet showroom?', tags: ['cabinets'], body: 'No public cabinet showroom. White Bear Lake is the A4L showroom, and the J&K Maple Grove showroom can\'t be used publicly. Cabinet samples are by appointment with the TCRS team.' },
  { kind: 'FAQ', title: 'Do we charge sales tax?', tags: ['tax'], body: 'Installed jobs usually have no tax line. The rate for materials-only sales is not settled: 8.75% was used, while MN Revenue lists 8.375% for White Bear Lake and White Bear Township. Confirm with the accountant before turning tax on.' },
  { kind: 'Doc', title: 'Intake questions (paste into an email)', tags: ['intake', 'email'], body: 'Thanks for reaching out! Answer what you can below and I\'ll get you a quote as soon as possible.\n1) Full name\n2) Phone number\n3) Email\n4) Project address (city + ZIP is fine for now)\n5) Products needed (cabinets, countertops, flooring, appliances, other)\n6) Services needed (delivery, installation, design/layout, removal of old materials)\n7) Project description + dimensions\n8) Finish or style preferences (color, door style, material), if you know them\n9) Budget range\n10) Timeline\n11) Current condition of the space (occupied home, gutting/remodel, new construction)\n12) How did you hear about us?\nPlease also send photos of the space and any layouts, drawings or measurements you have.' },
];

const FLOW = {
  new: 'Drop it in. Send the intake form.', intake: 'Get photos, sizes, finishes. Book a measure.', estimate: 'Ranges per option. No line items.',
  design: '$250 paid. Measure, layout, revisions counted.', quote: 'Itemized, branded. Mark sent.', accepted: 'Deposit / PO. Learn prices.',
  ordered: 'Order placed. Set delivery + install dates.', installed: 'Punch list. Invoice.', paid: 'QuickBooks or Clover. Done.',
};

let q = '';
export function renderHelp(v) {
  const docs = S.docs.length ? S.docs : STARTER_DOCS.map((d, i) => ({ ...d, id: 'starter-' + i }));
  const term = q.trim().toLowerCase();
  const list = docs.filter((d) => !term || [d.title, d.body, (d.tags || []).join(' ')].join(' ').toLowerCase().includes(term));
  const tile = (d) => `<article class="doc"><span class="kind">${esc(d.kind)}${d.pinned ? ' · pinned' : ''}</span><h3>${esc(d.title)}</h3>
    ${d.url ? `<div class="row"><a class="btn sm primary" href="${esc(d.url)}" target="_blank" rel="noopener">Open</a><button class="btn sm" type="button" data-copy="${esc(d.url)}">Copy link</button></div>` : ''}
    ${d.body ? `<div class="body">${esc(d.body)}</div>` : ''}
    <div class="row">${(d.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}<span class="grow"></span>${d.body ? `<button class="btn ghost sm" type="button" data-copy="${esc(d.body)}">Copy text</button>` : ''}${canWrite() && !String(d.id).startsWith('starter') ? `<button class="btn ghost sm" type="button" data-edit="${d.id}">Edit</button>` : ''}</div></article>`;
  v.innerHTML = `
  <section class="panel" style="margin-bottom:14px"><h2>How a job flows</h2>
    <div class="tbl-wrap" style="margin-top:10px"><div style="display:grid;grid-template-columns:repeat(9,minmax(120px,1fr));gap:6px;min-width:1080px">
    ${STAGES.map((s, i) => `<div style="background:var(--sunk);border-radius:8px;padding:8px;position:relative;border-top:4px solid ${i === 8 ? 'var(--green)' : 'var(--gold)'}"><div class="lbl">${i + 1}</div><b style="font-family:var(--display)">${esc(s.label)}</b><div class="small" style="margin-top:4px">${esc(FLOW[s.k])}</div></div>`).join('')}
    </div></div>
    <p class="small muted" style="margin:8px 0 0">HQ checks each move. Skipping a step asks first and notes it in the history.</p>
  </section>
  <div class="row" style="margin-bottom:10px"><input type="search" id="hq" placeholder="Search SOPs, FAQs and documents" value="${esc(q)}" class="grow" style="max-width:420px">
    ${canWrite() ? '<button class="btn" type="button" id="hAdd">+ Add SOP, FAQ or doc</button>' : ''}
    ${!S.docs.length && canWrite() ? '<button class="btn primary" type="button" id="hSeed">Save these starter docs to HQ</button>' : ''}</div>
  ${!S.docs.length ? '<p class="small muted">These starter docs come from the TCRS project notes. Save them so the team can edit them.</p>' : ''}
  <h3 style="margin:6px 0 8px">Pinned</h3><div class="help-grid">${list.filter((d) => d.pinned).map(tile).join('') || '<p class="small muted">None.</p>'}</div>
  ${['SOP', 'FAQ', 'Doc'].map((k) => { const ds = list.filter((d) => !d.pinned && d.kind === k); return ds.length ? `<h3 style="margin:16px 0 8px">${k === 'SOP' ? 'SOPs' : k === 'FAQ' ? 'Common questions' : 'Documents'}</h3><div class="help-grid">${ds.map(tile).join('')}</div>` : ''; }).join('')}`;
  const hq = $('#hq', v);
  hq.oninput = () => { q = hq.value; clearTimeout(hq._t); hq._t = setTimeout(() => { renderHelp(v); const x = $('#hq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 200); };
  $$('[data-copy]', v).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); } catch { toast('Copy blocked by the browser.'); } }));
  $('#hSeed', v)?.addEventListener('click', async () => { for (const d of STARTER_DOCS) await D.insert('docs', { ...d, tags: d.tags || [], pinned: !!d.pinned }); toast('Starter docs saved.'); });
  $('#hAdd', v)?.addEventListener('click', () => editDoc(null));
  $$('[data-edit]', v).forEach((b) => (b.onclick = () => editDoc(S.docs.find((d) => d.id === b.dataset.edit))));
}

function editDoc(d) {
  const b = document.createElement('div');
  b.className = 'sheet-bg top-modal';
  b.innerHTML = `<div class="sheet narrow"><div class="sheet-h"><h2>${d ? 'Edit' : 'Add'} SOP, FAQ or doc</h2><button class="x" type="button" aria-label="Close">×</button></div><form class="sheet-b" id="df">
    <div class="row"><select id="dk">${['SOP', 'FAQ', 'Doc'].map((k) => `<option ${d?.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select><input type="text" id="dt" class="grow" placeholder="Title" value="${esc(d?.title || '')}" required></div>
    <input type="text" id="du" placeholder="Link (optional): Google Doc, form, PDF" value="${esc(d?.url || '')}">
    <textarea id="db" rows="8" placeholder="Steps, answer or notes">${esc(d?.body || '')}</textarea>
    <input type="text" id="dg" placeholder="Tags, comma separated" value="${esc((d?.tags || []).join(', '))}">
    <label class="small row"><input type="checkbox" id="dp" ${d?.pinned ? 'checked' : ''}> Pin to the top</label>
    <div class="row"><button class="btn primary" type="submit">Save</button>${d ? '<button class="btn danger" type="button" id="dd">Delete</button>' : ''}</div></form></div>`;
  document.body.appendChild(b);
  b.querySelector('.x').onclick = () => b.remove();
  b.querySelector('#df').onsubmit = async (e) => {
    e.preventDefault();
    const row = { kind: $('#dk', b).value, title: $('#dt', b).value.trim(), url: $('#du', b).value.trim() || null, body: $('#db', b).value, tags: $('#dg', b).value.split(',').map((x) => x.trim()).filter(Boolean), pinned: $('#dp', b).checked };
    d ? await D.update('docs', d.id, row) : await D.insert('docs', row);
    b.remove();
  };
  $('#dd', b)?.addEventListener('click', async () => { await D.remove('docs', d.id); b.remove(); });
}

/* ───────── Prices & partners ───────── */
let btab = 'pricebook';
export function renderBrain(v) {
  const admin = S.role === 'admin';
  v.innerHTML = `<div class="tabs" style="margin-bottom:12px">${[['pricebook', 'Price book'], ['partners', 'Suppliers & contractors'], ['learned', 'What HQ learned'], ['settings', 'Settings'], ['team', 'Team']].map(([k, l]) => `<button type="button" data-bt="${k}" class="${btab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="bb"></div>`;
  $$('[data-bt]', v).forEach((b) => (b.onclick = () => { btab = b.dataset.bt; renderBrain(v); }));
  const bb = $('#bb', v);
  if (btab === 'pricebook') pricebook(bb);
  else if (btab === 'partners') partners(bb);
  else if (btab === 'learned') learned(bb);
  else if (btab === 'settings') settingsTab(bb, admin);
  else team(bb, admin);
}

function pricebook(el) {
  const rows = [...S.pricebook].sort((a, b) => (a.product || '').localeCompare(b.product || '') || a.name.localeCompare(b.name));
  el.innerHTML = `<section class="panel"><div class="row"><h3 class="grow">Price book</h3></div>
    <p class="small muted" style="margin:4px 0 8px">COST is what TCRS pays per unit. HQ adds lines here when a quote is accepted, counts how often each is used and how often it ends up paid, and suggests them while you type an estimate. Claude reads this list too.</p>
    <div class="tbl-wrap"><table class="simple"><thead><tr><th>Item</th><th>Product</th><th>Type</th><th>Unit</th><th style="color:var(--cost)">COST</th><th>Markup %</th><th>Partner</th><th>Used</th><th>Paid jobs</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr data-id="${p.id}"><td><input type="text" data-k="name" value="${esc(p.name)}"></td><td><select data-k="product">${PRODUCTS.map((x) => `<option ${p.product === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><select data-k="kind">${['material', 'install', 'delivery', 'fee'].map((x) => `<option ${p.kind === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td><input type="text" data-k="unit" value="${esc(p.unit || '')}" style="width:60px"></td>
      <td><input type="text" data-k="cost" value="${esc(p.cost ?? '')}" style="width:80px"></td><td><input type="text" data-k="markup" value="${esc(p.markup ?? '')}" style="width:60px"></td>
      <td><input type="text" data-k="partner" value="${esc(p.partner || '')}"></td><td class="n">${p.uses}</td><td class="n">${p.won}</td><td>${canWrite() ? '<button class="btn ghost sm" type="button" data-del>×</button>' : ''}</td></tr>`).join('')}
    ${canWrite() ? `<tr><td><input type="text" id="pN" placeholder="e.g. Cabinet install (per box)"></td><td><select id="pP">${PRODUCTS.map((x) => `<option>${x}</option>`).join('')}</select></td><td><select id="pK"><option>material</option><option>install</option><option>delivery</option><option>fee</option></select></td><td><input type="text" id="pU" placeholder="ea" style="width:60px"></td><td><input type="text" id="pC" placeholder="0" style="width:80px"></td><td><input type="text" id="pM" placeholder="25" style="width:60px"></td><td><input type="text" id="pR"></td><td colspan="3"><button class="btn sm" type="button" id="pAdd">Add</button></td></tr>` : ''}
    </tbody></table></div></section>`;
  $$('tr[data-id]', el).forEach((tr) => {
    $$('[data-k]', tr).forEach((i) => (i.onchange = () => D.update('pricebook', tr.dataset.id, { [i.dataset.k]: ['cost', 'markup'].includes(i.dataset.k) ? n(i.value) : i.value })));
    $('[data-del]', tr)?.addEventListener('click', () => D.remove('pricebook', tr.dataset.id));
  });
  $('#pAdd', el)?.addEventListener('click', async () => {
    const name = $('#pN', el).value.trim(); if (!name) return toast('Name the item.');
    await D.insert('pricebook', { name, product: $('#pP', el).value, kind: $('#pK', el).value, unit: $('#pU', el).value || 'ea', cost: n($('#pC', el).value), markup: n($('#pM', el).value), partner: $('#pR', el).value || null, uses: 0, won: 0, history: [] });
  });
}

function partners(el) {
  const rows = [...S.partners].sort((a, b) => a.ptype.localeCompare(b.ptype) || a.name.localeCompare(b.name));
  el.innerHTML = `<section class="panel"><h3>Suppliers &amp; contractors</h3>
    <p class="small muted" style="margin:4px 0 8px">Discount % = what the supplier takes off list for TCRS. Referral % = what a contractor pays TCRS when they bill the customer directly. Names never print on customer documents unless you choose to.</p>
    <div class="tbl-wrap"><table class="simple"><thead><tr><th>Name</th><th>Type</th><th>Trades / products</th><th>Phone</th><th>Email</th><th>Discount %</th><th>Referral %</th><th>Paid jobs</th><th>Notes</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr data-id="${p.id}"><td><input type="text" data-k="name" value="${esc(p.name)}"></td><td><select data-k="ptype"><option ${p.ptype === 'supplier' ? 'selected' : ''}>supplier</option><option ${p.ptype === 'contractor' ? 'selected' : ''}>contractor</option></select></td>
      <td><input type="text" data-k="trades" value="${esc(p.trades || '')}"></td><td><input type="text" data-k="phone" value="${esc(p.phone || '')}"></td><td><input type="text" data-k="email" value="${esc(p.email || '')}"></td>
      <td><input type="text" data-k="discount_pct" value="${esc(p.discount_pct ?? '')}" style="width:60px"></td><td><input type="text" data-k="referral_pct" value="${esc(p.referral_pct ?? '')}" style="width:60px"></td><td class="n">${p.jobs}</td>
      <td><input type="text" data-k="notes" value="${esc(p.notes || '')}"></td><td>${canWrite() ? '<button class="btn ghost sm" type="button" data-del>×</button>' : ''}</td></tr>`).join('')}
    ${canWrite() ? `<tr><td><input type="text" id="aN" placeholder="Name"></td><td><select id="aT"><option>supplier</option><option>contractor</option></select></td><td><input type="text" id="aR" placeholder="e.g. countertops"></td><td colspan="6"></td><td><button class="btn sm" type="button" id="aAdd">Add</button></td></tr>` : ''}
    </tbody></table></div>
    ${!rows.length && canWrite() ? '<button class="btn" type="button" id="aSeed" style="margin-top:8px">Add the partners from the TCRS notes (J&amp;K, Twin Rivers, Set in Stone, Aztek, Unique Flooring, Diaz, 4 Pines)</button>' : ''}</section>`;
  $$('tr[data-id]', el).forEach((tr) => {
    $$('[data-k]', tr).forEach((i) => (i.onchange = () => D.update('partners', tr.dataset.id, { [i.dataset.k]: ['discount_pct', 'referral_pct'].includes(i.dataset.k) ? n(i.value) : i.value })));
    $('[data-del]', tr)?.addEventListener('click', () => D.remove('partners', tr.dataset.id));
  });
  $('#aAdd', el)?.addEventListener('click', async () => { const name = $('#aN', el).value.trim(); if (!name) return; await D.insert('partners', { name, ptype: $('#aT', el).value, trades: $('#aR', el).value || null, jobs: 0 }); });
  $('#aSeed', el)?.addEventListener('click', async () => {
    const seed = [
      ['J&K Cabinetry', 'supplier', 'Stock cabinets (preferred dealer)', 'Standing 30% dealer discount; 50% Oct–Nov 2026 (per TCRS notes)'],
      ['Twin Rivers Cabinetry', 'supplier', 'Custom cabinets', 'Name unconfirmed: public records show "Twin River Cabinets"'],
      ['Set in Stone Countertops', 'supplier', 'Countertops', 'Per-sf price = material; cutouts etc. = labor'],
      ['Aztek Countertops', 'supplier', 'Countertops', ''],
      ['Unique Flooring', 'contractor', 'Flooring', ''],
      ['Diaz Premier Services', 'contractor', 'Garage doors', ''],
      ['4 Pines Logistics', 'contractor', 'Delivery & installation (internal)', 'TCRS / A4L internal jobs'],
    ];
    for (const [name, ptype, trades, notes] of seed) await D.insert('partners', { name, ptype, trades, notes: notes || null, jobs: 0, discount_pct: name === 'J&K Cabinetry' ? 30 : null });
  });
}

function learned(el) {
  const fb = [...S.feedback].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const top = [...S.pricebook].sort((a, b) => b.won - a.won || b.uses - a.uses).slice(0, 10);
  el.innerHTML = `<div class="two"><section class="panel"><h3>Team feedback on Claude</h3>
    <p class="small muted" style="margin:4px 0 8px">Every 👍/👎 and note from the Check screen and the estimate drafts. The 15 newest notes are sent to Claude on every read, so it adjusts.</p>
    ${fb.map((f) => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${f.rating > 0 ? '👍' : f.rating < 0 ? '👎' : '•'}</span><span class="chip">${esc(f.context || '')}</span><span class="grow">${esc(f.note || '')}</span><span class="small muted">${fmtDate(f.created_at)}</span>${canWrite() ? `<button class="btn ghost sm" type="button" data-fdel="${f.id}">×</button>` : ''}</div>`).join('') || '<p class="small muted">No feedback yet.</p>'}
  </section><section class="panel"><h3>Most-won price book lines</h3>
    ${top.map((p) => `<div class="row" style="padding:4px 0"><span class="grow">${esc(p.name)}</span><span class="small muted">${p.won} paid · ${p.uses} used</span><b class="num">${money(p.cost)}</b></div>`).join('') || '<p class="small muted">Fills in as quotes get accepted and paid.</p>'}
  </section></div>`;
  $$('[data-fdel]', el).forEach((b) => (b.onclick = () => D.remove('feedback', b.dataset.fdel)));
}

function settingsTab(el, admin) {
  const st = settings();
  const f = (k, l, suf = '') => `<label class="field"><span class="lbl">${l}</span><span class="row" style="gap:4px"><input type="text" data-s="${k}" value="${esc(st[k] ?? '')}" ${admin ? '' : 'disabled'} style="width:90px">${suf}</span></label>`;
  el.innerHTML = `<section class="panel"><h3>Rules</h3>${admin ? '' : '<p class="small muted">Only an admin can change these.</p>'}
    <div class="fields" style="margin-top:8px">
      ${f('markupDefault', 'Default markup', '%')}${f('markupOneOff', 'One-off customer markup', '%')}${f('markupFloor', 'Markup floor (warns below)', '%')}${f('referralPct', 'Referral fee', '%')}
      ${f('depositAmount', 'Design deposit', '$')}${f('revisionsIncluded', 'Revisions included')}${f('revisionBonusIfIntakeComplete', 'Extra if intake complete')}${f('revisionFee', 'Fee per extra revision', '$')}
      ${f('staleDays', 'Flag steps late after', 'days')}${f('quoteValidDays', 'Quotes valid', 'days')}${f('estimateRangePct', 'Estimate range ±', '%')}
    </div>
    <h3 style="margin-top:14px">Lead score weights</h3><div class="fields" style="margin-top:8px">
      ${['conversion', 'budget', 'repeat', 'intake'].map((k) => `<label class="field"><span class="lbl">${{ conversion: 'Feels likely to buy', budget: 'Budget / job size', repeat: 'Repeat / reliable', intake: 'Intake quality' }[k]}</span><input type="text" data-w="${k}" value="${st.scoreWeights[k]}" ${admin ? '' : 'disabled'} style="width:90px"></label>`).join('')}</div>
    <h3 style="margin-top:14px">On customer documents</h3><div class="fields" style="margin-top:8px">
      ${['name', 'address', 'phone', 'email', 'web'].map((k) => `<label class="field"><span class="lbl">${k}</span><input type="text" data-co="${k}" value="${esc(st.company[k])}" ${admin ? '' : 'disabled'}></label>`).join('')}</div>
    <h3 style="margin-top:14px">Inbox sweep (9am + 9pm)</h3>
    <label class="row small" style="gap:8px;margin-top:6px"><input type="checkbox" id="sAuto" ${st.sweep?.autoSend ? 'checked' : ''} ${admin ? '' : 'disabled'}> Auto-send the first reply to brand-new email leads (thanks + intake questions). Off = saved as a Gmail draft for you to send.</label>
    ${admin ? '<button class="btn primary" type="button" id="sSave" style="margin-top:12px">Save settings</button>' : ''}</section>`;
  $('#sSave', el)?.addEventListener('click', async () => {
    const data = { ...settings() };
    $$('[data-s]', el).forEach((i) => (data[i.dataset.s] = n(i.value) ?? DEFAULT_SETTINGS[i.dataset.s]));
    data.scoreWeights = {}; $$('[data-w]', el).forEach((i) => (data.scoreWeights[i.dataset.w] = n(i.value) ?? 25));
    data.company = {}; $$('[data-co]', el).forEach((i) => (data.company[i.dataset.co] = i.value.trim()));
    data.sweep = { ...(data.sweep || {}), autoSend: $('#sAuto', el).checked };
    await D.upsert('settings', { id: 'main', data });
    toast('Settings saved.');
  });
}

function team(el, admin) {
  el.innerHTML = `<section class="panel"><h3>Team logins</h3>
    <p class="small muted" style="margin:4px 0 8px"><b>admin</b>: everything, including settings and roles. <b>sales</b>: everything else. <b>tv</b>: view-only office screen.</p>
    ${admin ? `<form class="row" id="invF" style="margin:6px 0 12px;padding:10px;border:1.5px dashed var(--gold);border-radius:10px">
      <b>Invite a teammate</b>
      <input type="email" id="invE" placeholder="email@tcremodelingsupply.com" required class="grow" style="min-width:220px">
      <input type="text" id="invN" placeholder="Name (e.g. Lee)" style="width:150px">
      <select id="invR"><option value="sales">sales</option><option value="admin">admin</option><option value="tv">tv</option></select>
      <button class="btn primary" type="submit">Send invite</button>
      <span class="small muted" style="flex-basis:100%">They get an email from Supabase, click the link, and choose their own password in HQ.</span>
    </form>` : ''}
    <table class="simple"><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>
    ${S.profiles.map((p) => `<tr data-id="${p.id}"><td><input type="text" data-k="name" value="${esc(p.name)}" ${admin ? '' : 'disabled'}></td><td><select data-k="role" ${admin ? '' : 'disabled'}>${['admin', 'sales', 'tv'].map((r) => `<option ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></section>`;
  $$('tr[data-id] [data-k]', el).forEach((i) => (i.onchange = () => D.update('profiles', i.closest('tr').dataset.id, { [i.dataset.k]: i.value })));
  $('#invF', el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await D.invite({ email: $('#invE', el).value.trim(), name: $('#invN', el).value.trim(), role: $('#invR', el).value });
      toast(`Invite sent to ${r.email} (${r.role}).`);
      e.target.reset();
    } catch (err) { toast('Invite failed: ' + err.message); }
    btn.disabled = false; btn.textContent = 'Send invite';
  });
}
