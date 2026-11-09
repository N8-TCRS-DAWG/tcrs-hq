// The Drop: everything enters HQ here. Read → Check → Save.
import * as D from './data.js?v=20261109120943';
import { S, STAGES, PRODUCTS, SERVICES, CTYPES, FTYPES, WHOSE, esc, $, $$, n, toast, money0, todayISO, addDays, stageIdx, learnedContext, logEvent, patchCustomer, settings, custFiles, custLayouts } from './core.js?v=20261109120943';
import { bumpRevision } from './customer.js?v=20261109120943';
import { planFromSpec } from './layout.js?v=20261109120943';
import { addLinesToQuote } from './quote.js?v=20261109120943';

let box = null;
let st = null; // { customerId, files:[{file, type, thumb}], text, instr }

export function openDrop({ customerId = null, manual = false, files = [], text = '', auto = false } = {}) {
  close();
  st = { customerId, files: [], text, instr: '' };
  box = document.createElement('div');
  box.className = 'sheet-bg top-modal';
  box.style.zIndex = 55;
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.body.appendChild(box);
  manual ? drawManual() : drawDrop();
  if (files.length) addFiles(files);
  if (auto && !manual) { read(true); return; }   // dropped on a card / New lead: skip straight to Claude's read
  if (!manual) setTimeout(() => (text ? $('#dInstr', box) : $('#dText', box))?.focus(), 30);
}
export const dropOpen = () => !!box;
export function addToDrop(files) { if (box && $('#dzList', box)) addFiles(files); }
function close() { box?.remove(); box = null; }

function head(title, sub) {
  return `<div class="sheet-h"><h2>${title}</h2>${sub ? `<span class="small muted">${sub}</span>` : ''}<button class="x" type="button" aria-label="Close">×</button></div>`;
}
function wireClose() { $('.x', box).onclick = close; }

/* ───────── manual new lead ───────── */
function drawManual() {
  box.innerHTML = `<div class="sheet narrow">${head('New lead by hand')}<form class="sheet-b" id="mForm">
    <div class="fields">
      <label class="field"><span class="lbl">Name *</span><input type="text" id="mName" required></label>
      <label class="field"><span class="lbl">Phone</span><input type="tel" id="mPhone"></label>
      <label class="field"><span class="lbl">Email</span><input type="email" id="mEmail"></label>
      <label class="field"><span class="lbl">City</span><input type="text" id="mCity"></label>
      <label class="field"><span class="lbl">Lead source</span><input type="text" id="mSrc" placeholder="Facebook, referral, phone…"></label>
    </div>
    <div class="lbl">Products</div>
    <div class="row">${PRODUCTS.map((p) => `<button type="button" class="chip pick" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <label class="field"><span class="lbl">What do they want? (one or two lines)</span><textarea id="mNote" rows="3"></textarea></label>
    <p class="small muted">Have an email, transcript or photos? Use <b>Drop</b> instead and Claude fills this in.</p>
    <div class="row"><button class="btn primary" type="submit">Create lead</button></div>
  </form></div>`;
  wireClose();
  $$('[data-p]', box).forEach((b) => (b.onclick = () => b.classList.toggle('on')));
  $('#mForm', box).onsubmit = async (e) => {
    e.preventDefault();
    const products = $$('[data-p].on', box).map((b) => b.dataset.p);
    const note = $('#mNote', box).value.trim();
    const c = await D.insert('customers', { name: $('#mName', box).value.trim(), phone: $('#mPhone', box).value.trim() || null, email: $('#mEmail', box).value.trim() || null, city: $('#mCity', box).value.trim() || null, source: $('#mSrc', box).value.trim() || null, products, services: [], stage: 'new', first_contact: todayISO(), tldr: note || null, data: {}, created_by: S.me?.id });
    await logEvent(c.id, 'note', 'Lead created by hand', note || null);
    await D.insert('actions', { customer_id: c.id, title: 'Send intake form', due: todayISO(), waiting_on: 'us', done: false });
    close();
    location.hash = 'c-' + c.id;
  };
}

/* ───────── drop ───────── */
function guessType(f) {
  const nm = f.name.toLowerCase();
  if (/\.(usdz|obj|glb|ply|e57|las)$/.test(nm) || nm.includes('scan')) return 'Scan';
  if (/\.(kit|dwg|dxf)$/.test(nm) || /layout|2020|design|floor ?plan|elevation/.test(nm)) return 'Layout';
  if (/render/.test(nm)) return 'Rendering';
  if (/agreement|contract|signed/.test(nm)) return 'Agreement';
  if (/quote|estimate|proposal|invoice|bid/.test(nm)) return f.type === 'application/pdf' ? 'Supplier quote' : 'Supplier quote';
  if ((f.type || '').startsWith('image/')) return 'Photo';
  return 'Other';
}
const CHIPS_NEW = ['Build a new profile with all pertinent context', 'Read the supplier quote into estimate lines', 'Update the layout from these measurements'];
const CHIPS_OLD = ['Add pertinent updates to this profile', 'Read the supplier quote into estimate lines', 'Customer asked for layout changes (count a revision)', 'Update the layout from these measurements'];

function drawDrop() {
  const target = st.customerId ? S.customers.find((c) => c.id === st.customerId) : null;
  const opts = [...S.customers].filter((c) => !c.lost).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  box.innerHTML = `<div class="sheet narrow">${head('Drop', 'Photos, layouts, PDFs, scans, emails, call transcripts, notes')}<div class="sheet-b">
    <label class="field"><span class="lbl">Goes to</span>
      <select id="dTarget"><option value="">Let Claude decide (match or new)</option><option value="__new" ${st.customerId === '__new' ? 'selected' : ''}>New customer</option>
      ${opts.map((c) => `<option value="${c.id}" ${c.id === st.customerId ? 'selected' : ''}>${esc(c.name || 'No name')}${c.city ? ' · ' + esc(c.city) : ''}</option>`).join('')}</select></label>
    <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Add files">
      <h3>Drag files here, or click to choose</h3>
      <p class="small muted" style="margin:4px 0 0">You can also paste a screenshot (Ctrl/⌘ V). Phone: tap to pick photos.</p>
      <input type="file" id="dzIn" multiple hidden>
    </div>
    <div class="dz-files" id="dzList"></div>
    <label class="field"><span class="lbl">Paste the email thread, call transcript, texts or notes</span>
      <textarea id="dText" rows="6" placeholder="Paste here…">${esc(st.text)}</textarea></label>
    <label class="field"><span class="lbl">Tell Claude what to do (optional)</span>
      <input type="text" id="dInstr" value="${esc(st.instr)}" placeholder="e.g. parse this email thread and add pertinent updates to Stacy's profile"></label>
    <div class="row" id="dChips">${(target ? CHIPS_OLD : CHIPS_NEW).map((t) => `<button type="button" class="chip pick">${esc(t)}</button>`).join('')}</div>
    <div class="row">
      <button class="btn primary" type="button" id="dRead">Read with Claude →</button>
      <button class="btn" type="button" id="dHand">Fill it in myself →</button>
      <span class="small muted">Nothing saves until you check it.</span>
    </div>
  </div></div>`;
  wireClose();
  const dz = $('#dz', box), inp = $('#dzIn', box);
  dz.onclick = () => inp.click();
  dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
  inp.onchange = () => { addFiles([...inp.files]); inp.value = ''; };
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('hot'); };
  dz.ondragleave = () => dz.classList.remove('hot');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('hot'); addFiles([...e.dataTransfer.files]); };
  box.onpaste = (e) => {
    const fs = [...(e.clipboardData?.files || [])];
    if (fs.length) { e.preventDefault(); addFiles(fs.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type }))); }
  };
  $('#dText', box).oninput = (e) => (st.text = e.target.value);
  $('#dInstr', box).oninput = (e) => (st.instr = e.target.value);
  $('#dTarget', box).onchange = (e) => { st.target = e.target.value; };
  st.target = st.customerId || '';
  $$('#dChips .chip', box).forEach((b) => (b.onclick = () => { st.instr = b.textContent; $('#dInstr', box).value = st.instr; }));
  $('#dRead', box).onclick = () => read(true);
  box.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); read(true); } };
  $('#dHand', box).onclick = () => read(false);
  drawFiles();
}
function addFiles(list) {
  list.forEach((f) => {
    const item = { file: f, type: guessType(f), thumb: (f.type || '').startsWith('image/') ? URL.createObjectURL(f) : null };
    st.files.push(item);
  });
  drawFiles();
}
function drawFiles() {
  const el = $('#dzList', box); if (!el) return;
  el.innerHTML = st.files.map((f, i) => `<div class="dz-file">${f.thumb ? `<img src="${f.thumb}" alt="">` : '<span class="lbl" style="width:40px;text-align:center">' + esc((f.file.name.split('.').pop() || '').toUpperCase()) + '</span>'}
    <span class="nm" title="${esc(f.file.name)}">${esc(f.file.name)}</span><span class="small muted">${(f.file.size / 1024 / 1024).toFixed(1)} MB</span>
    <select data-i="${i}" aria-label="File type">${FTYPES.map((t) => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button class="btn ghost sm" type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
  $$('select[data-i]', el).forEach((s) => (s.onchange = () => (st.files[+s.dataset.i].type = s.value)));
  $$('[data-rm]', el).forEach((b) => (b.onclick = () => { st.files.splice(+b.dataset.rm, 1); drawFiles(); }));
}

/* ───────── reading ───────── */
export async function toBase64(blob) {
  const buf = await blob.arrayBuffer();
  let s = ''; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function shrinkImage(file, max = 1568) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    return { data: await toBase64(blob), media_type: 'image/jpeg' };
  } catch { return null; }
}

function customerBrief(c) {
  const sz = S.sizes.filter((s) => s.customer_id === c.id).map((s) => `${s.what}: ${s.value ?? '?'} ${s.unit || ''}`).join('; ');
  const lay = custLayouts(c.id)[0];
  return JSON.stringify({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, city: c.city, zip: c.zip, source: c.source, ctype: c.ctype, budget: c.budget, timeline: c.timeline, products: c.products, services: c.services, stage: c.stage, tldr: c.tldr, finishes: c.data?.finishes, revisions: c.revisions, sizes: sz, hasLayout: !!lay, layoutWalls: lay?.plan?.walls?.map((w) => ({ name: w.name, length_in: Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)) })) });
}

const SYSTEM = `You are the intake reader for Twin Cities Remodeling Supply (TCRS), a Minnesota supplier of cabinets, countertops, flooring and appliances that also arranges delivery and installation through partner contractors.
Read everything the salesperson dropped (emails, call transcripts, texts, notes, photos, PDFs such as supplier quotes or layouts) and return ONE JSON object, nothing else.

Hard rules:
- Never invent facts, names, prices or measurements. Leave a field null when it is not stated. If you estimate anything, say so in "warnings".
- COST = money TCRS pays a supplier or contractor. PRICE = money the customer pays TCRS. Supplier and contractor quotes are COSTS. Never put a customer price in a cost field.
- Supplier countertop quotes: the per-sq-ft price is material; cutouts, strips and install lines are installation labor.
- Dates as YYYY-MM-DD. Lengths in inches unless the source says otherwise. Money as plain numbers.
- Matching: if the drop is clearly about one of the existing customers listed, set match.customerId to that id. If unsure, set it null and explain in match.why.
- tldr: 2–4 plain sentences, the whole project and where it stands now, rewritten to include the new information.
- actions: only real next steps. "whose" is who must act next: us (TCRS), supplier, contractor or customer.
- revision.requested = true only when the customer asks TCRS to change a layout TCRS already made.
- payment: if the drop says the customer paid anything (deposit, materials, in full), set payment.status. Put the amount ONLY if a dollar figure for that payment is written; otherwise amount null and say so in payment.note. Never guess an amount.
- job_value: the agreed or quoted total PRICE to the customer if a figure is stated (quote total, invoice total). Not the budget.
- dates: measure_date, delivery_date, install_date as YYYY-MM-DD when stated or clearly scheduled. For a range ("11/4 or 11/5") use the first day and mention the range in warnings.
- layout: only when wall lengths or cabinet positions are actually given. Walls in order, each turning 90° clockwise.
- lines: only from a supplier or contractor quote in the drop. deal = "resell" when TCRS buys and resells; "referral" when the contractor will bill the customer directly and pay TCRS a referral fee.

JSON shape:
{"match":{"customerId":null,"confidence":"high|medium|low","why":""},
 "customer":{"name":null,"phone":null,"email":null,"address":null,"city":null,"zip":null,"source":null,"ctype":"Homeowner|Contractor|Flipper|Landlord|Designer|null","budget":null,"timeline":null,"products":[],"services":[],"finishes":null,"first_contact":null,"measure_date":null,"delivery_date":null,"install_date":null},
 "payment":{"status":"none|deposit|partial|full","amount":null,"method":"QuickBooks|Clover|Check|Cash|Card|Other|null","date":null,"note":""},
 "job_value":null,
 "tldr":"",
 "log":[{"kind":"email|call|text|note|visit","date":"YYYY-MM-DD","who":"us|customer|supplier|contractor","summary":"one line, starting with who spoke (e.g. \"Nathan sent…\", \"Bri asked…\", \"J&K returned…\")"}],
 "actions":[{"title":"","due":"YYYY-MM-DD|null","whose":"us|supplier|contractor|customer"}],
 "sizes":[{"what":"","value":0,"unit":"in|ft|lf|sf|ea","source":"tape|layout|photo|scan|customer"}],
 "files":[{"index":0,"type":"Photo|Layout|Rendering|Supplier quote|Contractor quote|Estimate|Quote|Agreement|Scan|Other","note":""}],
 "revision":{"requested":false,"why":""},
 "stage":null,
 "conversion":{"score":null,"why":""},
 "layout":null,
 "lines":[],
 "questions":[],
 "warnings":[]}
layout (when given): {"ceiling":96,"walls":[{"name":"A","length_in":162}],"items":[{"wall":"A","cat":"base|wall|tall|appliance|opening|island","sub":"sink|range|fridge|dw|micro|window|door|null","w":36,"off":null}]}
lines item: {"product":"Cabinets|Countertops|Flooring|Appliances|Other","kind":"material|install|delivery|fee","deal":"resell|referral","desc":"","qty":0,"unit":"","cost":0,"list":null,"disc":null,"partner":"","note":""}
products use exactly: ${PRODUCTS.join(', ')}. services use exactly: ${SERVICES.join(', ')}. stage, if the drop clearly moves the project, one of: ${STAGES.map((s) => s.k).join(', ')}.`;

async function read(useClaude) {
  const target = st.target === '__new' ? null : S.customers.find((c) => c.id === st.target) || null;
  if (!st.files.length && !st.text.trim()) return toast('Add a file or paste some text first.');
  const b = $('.sheet-b', box);
  if (!useClaude) return check(fallback(target), target);
  b.innerHTML = `<div class="thinking"><span class="spin"></span><span>Claude is reading ${st.files.length ? st.files.length + ' file' + (st.files.length > 1 ? 's' : '') : ''}${st.files.length && st.text ? ' and ' : ''}${st.text ? 'your text' : ''}…</span></div>`;
  try {
    const content = [];
    const list = S.customers.filter((c) => !c.lost).slice(0, 400).map((c) => `${c.id} | ${c.name} | ${c.phone || ''} | ${c.email || ''} | ${c.city || ''}`).join('\n');
    content.push({ type: 'text', text: `Today is ${todayISO()}.\nSalesperson's instruction: ${st.instr || '(none — use judgment)'}\n\n${target ? `TARGET CUSTOMER (the salesperson chose this one; set match.customerId to "${target.id}"):\n${customerBrief(target)}` : st.target === '__new' ? 'The salesperson says this is a NEW customer: set match.customerId to null.' : `EXISTING CUSTOMERS (id | name | phone | email | city):\n${list || '(none)'}`}\n\n${learnedContext()}\n\nPASTED TEXT:\n${st.text || '(none)'}\n\nFILES (index: name, type the salesperson picked):\n${st.files.map((f, i) => `${i}: ${f.file.name} (${f.type})`).join('\n') || '(none)'}` });
    let complex = false;
    for (let i = 0; i < st.files.length; i++) {
      const f = st.files[i].file;
      if ((f.type || '').startsWith('image/')) {
        const img = await shrinkImage(f);
        if (img) { content.push({ type: 'text', text: `File ${i}: ${f.name}` }); content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }); complex = true; }
      } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        if (f.size < 20 * 1024 * 1024) { content.push({ type: 'text', text: `File ${i}: ${f.name}` }); content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(f) } }); complex = true; }
      } else if (/\.(txt|eml|csv|json|md|html?)$/i.test(f.name) || (f.type || '').startsWith('text/')) {
        content.push({ type: 'text', text: `File ${i}: ${f.name}\n${(await f.text()).slice(0, 60000)}` });
      }
    }
    const raw = await D.ai({ system: SYSTEM, content, model: complex ? 'complex' : 'default', max_tokens: 8000 });
    const j = parseJSON(raw);
    if (!j) throw new Error('Claude answered in a format HQ could not read. Try again, or fill it in yourself.');
    check(j, target);
  } catch (e) {
    const fb = fallback(target);
    fb.__hand = false;
    fb.warnings = [`Claude couldn't read this: ${e.message}`, 'The fields below are from a quick pattern match. Fill in the rest.'];
    check(fb, target);
  }
}
function parseJSON(t) {
  const a = t.indexOf('{'), z = t.lastIndexOf('}');
  if (a < 0 || z < a) return null;
  try { return JSON.parse(t.slice(a, z + 1)); } catch { return null; }
}
function fallback(target) {
  const t = st.text || '';
  const email = (t.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || null;
  const phone = (t.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [])[0] || null;
  return {
    __hand: true, match: { customerId: target?.id || null, confidence: 'low', why: 'Filled in by hand' },
    customer: { name: null, email, phone, products: [] }, tldr: target?.tldr || t.slice(0, 400),
    log: t ? [{ kind: 'note', date: todayISO(), summary: t.split('\n').find((x) => x.trim())?.slice(0, 120) || 'Drop' }] : [],
    actions: [], sizes: [], files: st.files.map((f, i) => ({ index: i, type: f.type })), revision: { requested: false }, lines: [], questions: [], warnings: [],
  };
}

/* ───────── Check screen ───────── */
const CFIELDS = [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['city', 'City'], ['zip', 'ZIP'], ['source', 'Lead source'], ['ctype', 'Customer type'], ['budget', 'Budget'], ['timeline', 'Timeline'], ['finishes', 'Finishes'], ['first_contact', 'First contact'], ['measure_date', 'Measure date'], ['delivery_date', 'Delivery date'], ['install_date', 'Install date']];
let fbRating = 0;
const MOVE = { us: 'Our move', supplier: "Supplier's move", contractor: "Contractor's move", customer: "Customer's move" };

function check(j, target) {
  fbRating = 0;
  const matchId = target?.id || (j.match?.customerId && S.customers.find((c) => c.id === j.match.customerId) ? j.match.customerId : '');
  const ex = matchId ? S.customers.find((c) => c.id === matchId) : null;
  const cu = j.customer || {};
  const fieldRows = CFIELDS.map(([k, l]) => {
    const nv = cu[k]; const ov = k === 'finishes' ? ex?.data?.finishes : ex?.[k];
    if (nv == null || nv === '' || String(nv) === String(ov ?? '')) return '';
    return `<div class="crow"><input type="checkbox" data-cf="${k}" checked aria-label="Use ${l}"><span class="lbl" style="width:100px">${l}</span><input type="text" data-cv="${k}" value="${esc(nv)}">${ov ? `<span class="small muted">was: ${esc(ov)}</span>` : ''}</div>`;
  }).join('');
  const prods = [...new Set([...(ex?.products || []), ...(cu.products || []).filter((p) => PRODUCTS.includes(p))])];
  const servs = [...new Set([...(ex?.services || []), ...(cu.services || []).filter((p) => SERVICES.includes(p))])];
  const fileInfo = (i) => (j.files || []).find((f) => f.index === i) || {};
  const opts = S.customers.filter((c) => !c.lost).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const lay = j.layout && Array.isArray(j.layout.walls) && j.layout.walls.length ? j.layout : null;
  const lines = Array.isArray(j.lines) ? j.lines : [];
  const stageOk = j.stage && STAGES.some((s) => s.k === j.stage) && stageIdx(j.stage) > (ex ? stageIdx(ex.stage) : 0);
  $('.sheet', box).classList.remove('narrow');
  $('.sheet', box).innerHTML = `${head('Check before saving', 'Untick anything wrong. Edit anything. Nothing is saved yet.')}<div class="sheet-b">
    ${(j.warnings || []).length ? `<div class="check-sec st-yellow" style="border-color:var(--amber)"><div class="hd"><h3>⚠ Heads up</h3></div>${j.warnings.map((w) => `<div class="small">${esc(w)}</div>`).join('')}</div>` : ''}
    <div class="check-sec"><div class="hd"><h3>Customer</h3><span class="small muted">${esc(j.match?.why || '')}</span></div>
      <div class="row"><select id="cTarget" class="grow"><option value="">➕ Create a new customer</option>${opts.map((c) => `<option value="${c.id}" ${c.id === matchId ? 'selected' : ''}>Add to: ${esc(c.name || 'No name')}${c.city ? ' · ' + esc(c.city) : ''}</option>`).join('')}</select>
      ${j.match?.confidence && matchId && !j.__hand ? `<span class="chip">${esc(j.match.confidence)} match</span>` : ''}</div>
      ${fieldRows || '<p class="small muted">No new contact details.</p>'}
      <div class="lbl">Products</div><div class="row" id="cProds">${PRODUCTS.map((p) => `<button type="button" class="chip pick ${prods.includes(p) ? 'on' : ''}">${esc(p)}</button>`).join('')}</div>
      <div class="lbl">Services</div><div class="row" id="cServs">${SERVICES.map((p) => `<button type="button" class="chip pick ${servs.includes(p) ? 'on' : ''}">${esc(p)}</button>`).join('')}</div>
    </div>
    <div class="check-sec"><div class="hd"><input type="checkbox" id="cTldrOn" checked aria-label="Use TL;DR"><h3>TL;DR</h3></div><textarea id="cTldr" rows="3">${esc(j.tldr || '')}</textarea></div>
    ${payHTML(j, ex)}
    ${(j.log || []).length ? `<div class="check-sec"><div class="hd"><h3>History entries</h3></div>${j.log.map((l, i) => `<div class="crow"><input type="checkbox" data-log="${i}" checked><select data-lk="${i}">${['email', 'call', 'text', 'note', 'visit'].map((k) => `<option ${l.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select><input type="date" data-ld="${i}" value="${esc(l.date || todayISO())}"><input type="text" data-ls="${i}" value="${esc(l.summary || '')}"></div>`).join('')}</div>` : ''}
    <div class="check-sec"><div class="hd"><h3>Next steps</h3><span class="small muted">The card color comes from these.</span></div>
      ${(j.actions || []).map((a, i) => `<div class="crow"><input type="checkbox" data-act="${i}" checked><input type="text" data-at="${i}" value="${esc(a.title || '')}"><select data-aw="${i}">${WHOSE.map((w) => `<option value="${w.k}" ${a.whose === w.k ? 'selected' : ''}>${MOVE[w.k]}</option>`).join('')}</select><input type="date" data-ad="${i}" value="${esc(a.due || '')}"></div>`).join('') || '<p class="small muted">None suggested.</p>'}
      <div class="crow"><input type="checkbox" id="naOn"><input type="text" id="naT" placeholder="Add another step"><select id="naW">${WHOSE.map((w) => `<option value="${w.k}">${MOVE[w.k]}</option>`).join('')}</select><input type="date" id="naD" value="${addDays(todayISO(), 1)}"></div>
    </div>
    ${(j.sizes || []).length ? `<div class="check-sec"><div class="hd"><h3>Sizes</h3></div>${j.sizes.map((s, i) => `<div class="crow"><input type="checkbox" data-sz="${i}" checked><input type="text" data-sw="${i}" value="${esc(s.what || '')}"><input type="text" data-sv="${i}" value="${esc(s.value ?? '')}" style="flex:0 0 90px"><input type="text" data-su="${i}" value="${esc(s.unit || '')}" style="flex:0 0 60px"><span class="small muted">${esc(s.source || '')}</span></div>`).join('')}</div>` : ''}
    ${st.files.length ? `<div class="check-sec"><div class="hd"><h3>Files</h3></div>${st.files.map((f, i) => `<div class="crow"><input type="checkbox" data-fl="${i}" checked>${f.thumb ? `<img src="${f.thumb}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:4px">` : ''}<span class="grow">${esc(f.file.name)} <span class="small muted">${esc(fileInfo(i).note || '')}</span></span><select data-ft="${i}">${FTYPES.map((t) => `<option ${(fileInfo(i).type || f.type) === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`).join('')}</div>` : ''}
    <div class="check-sec"><div class="hd"><input type="checkbox" id="revOn" ${j.revision?.requested ? 'checked' : ''}><h3>Count a layout revision</h3></div><span class="small muted">${esc(j.revision?.why || 'Tick if the customer asked us to change a layout we made.')}</span></div>
    ${lay ? `<div class="check-sec"><div class="hd"><input type="checkbox" id="layOn" checked><h3>Draw the layout</h3></div><span class="small">${lay.walls.map((w) => `${esc(w.name || '')} ${w.length_in}"`).join(' · ')}${(lay.items || []).length ? ` · ${lay.items.length} cabinets/appliances` : ''}. Saved as a new layout version you can adjust on the Layout tab.</span></div>` : ''}
    ${lines.length ? `<div class="check-sec"><div class="hd"><input type="checkbox" id="linesOn" checked><h3>Add to the estimate (COST lines)</h3></div><div class="tbl-wrap"><table class="simple"><thead><tr><th>Product</th><th>What</th><th>Qty</th><th>Unit</th><th style="color:var(--cost)">COST / unit</th><th>Partner</th><th>Deal</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.product)}</td><td>${esc(l.desc)}<div class="small muted">${esc(l.kind)}</div></td><td>${esc(l.qty)}</td><td>${esc(l.unit)}</td><td>${l.cost != null ? '$' + esc(l.cost) : l.list != null ? `list $${esc(l.list)} − ${esc(l.disc || 0)}%` : '—'}</td><td>${esc(l.partner || '')}</td><td>${esc(l.deal || 'resell')}</td></tr>`).join('')}</tbody></table></div><span class="small muted">Prices (what the customer pays) are set on the Estimate tab with your markup.</span></div>` : ''}
    ${stageOk ? `<div class="check-sec"><div class="hd"><input type="checkbox" id="stOn" checked><h3>Move to "${esc(STAGES[stageIdx(j.stage)].label)}"</h3></div></div>` : ''}
    ${j.conversion?.score ? `<div class="check-sec"><div class="hd"><input type="checkbox" id="convOn" checked><h3>Likely to buy: ${esc(j.conversion.score)}/5</h3></div><span class="small muted">${esc(j.conversion.why || '')}</span></div>` : ''}
    ${(j.questions || []).length ? `<div class="check-sec"><div class="hd"><input type="checkbox" id="qOn" checked><h3>Still missing to quote</h3></div>${j.questions.map((q) => `<div class="small">• ${esc(q)}</div>`).join('')}<span class="small muted">Saved as one "Ask customer" step.</span></div>` : ''}
    <div class="row" ${j.__hand ? 'hidden' : ''}><span class="small muted">Was Claude's read good?</span><button type="button" class="btn sm" data-fb="1">👍</button><button type="button" class="btn sm" data-fb="-1">👎</button><input type="text" id="fbNote" class="grow" placeholder="What should it do differently next time? (it learns from this)"></div>
    <div class="row sticky-save"><button class="btn primary" type="button" id="save">Save to HQ</button><button class="btn" type="button" id="back">← Back</button><span class="small muted" id="saveTo"></span></div>
  </div>`;
  wireClose();
  $$('#cProds .chip, #cServs .chip', box).forEach((b) => (b.onclick = () => b.classList.toggle('on')));
  $$('[data-fb]', box).forEach((b) => (b.onclick = () => { fbRating = +b.dataset.fb; $$('[data-fb]', box).forEach((x) => x.classList.toggle('primary', x === b)); }));
  $('#back', box).onclick = () => { $('.sheet', box).classList.add('narrow'); drawDrop(); };
  $('#save', box).onclick = () => save(j, lay, lines);
  const upd = () => { const sel = $('#cTarget', box); $('#saveTo', box).textContent = sel.value ? 'Adds to ' + sel.options[sel.selectedIndex].text.replace(/^Add to: /, '') : 'Creates a new customer'; };
  $('#cTarget', box).onchange = upd; upd();
}

function payHTML(j, ex) {
  const p = j.payment || {};
  const paidNow = Number(ex?.paid?.amount) || 0;
  const jv = Number(j.job_value) || null;
  if ((!p.status || p.status === 'none') && !jv) return '';
  const hasAmt = p.amount != null && p.amount !== '';
  return `<div class="check-sec" style="border-color:${hasAmt ? 'var(--line)' : 'var(--amber)'}"><div class="hd"><input type="checkbox" id="payOn" checked><h3>Money</h3></div>
    ${p.status && p.status !== 'none' ? `<div class="crow"><span class="lbl" style="width:110px">Paid</span>
      <input type="text" id="payAmt" value="${esc(hasAmt ? p.amount : '')}" placeholder="${hasAmt ? '' : 'Amount not in the email: type it'}" inputmode="decimal" style="flex:0 1 220px">
      <select id="payHow">${['', 'QuickBooks', 'Clover', 'Check', 'Cash', 'Card', 'Other'].map((m) => `<option ${p.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <input type="date" id="payAt" value="${esc(p.date || '')}">
      <span class="small muted">${esc(p.status)}${p.note ? ' · ' + esc(p.note) : ''}${paidNow ? ` · already recorded ${money0(paidNow)}` : ''}</span></div>` : ''}
    <div class="crow"><span class="lbl" style="width:110px">Job value</span><input type="text" id="jobVal" value="${esc(jv ?? (ex?.est_price ?? ''))}" placeholder="Total PRICE to the customer, if known" inputmode="decimal" style="flex:0 1 220px"><span class="small muted">Counts toward the pipeline</span></div>
  </div>`;
}

async function save(j, lay, lines) {
  const btn = $('#save', box); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const tid = $('#cTarget', box).value;
    let c = tid ? S.customers.find((x) => x.id === tid) : null;
    const patch = {};
    $$('[data-cf]', box).forEach((cb) => {
      if (!cb.checked) return;
      const k = cb.dataset.cf; let v = $(`[data-cv="${k}"]`, box).value.trim();
      if (k === 'budget') v = n(v);
      if (k === 'finishes') patch.__finishes = v; else patch[k] = v || null;
    });
    patch.products = $$('#cProds .chip.on', box).map((b) => b.textContent);
    patch.services = $$('#cServs .chip.on', box).map((b) => b.textContent);
    if ($('#cTldrOn', box).checked) patch.tldr = $('#cTldr', box).value.trim() || null;
    if ($('#payOn', box)?.checked) {
      const jv = n($('#jobVal', box)?.value);
      if (jv) patch.est_price = jv;
      if ($('#payAmt', box)) {
        const amt = n($('#payAmt', box).value);
        if (amt) patch.paid = { amount: amt, method: $('#payHow', box).value || null, at: $('#payAt', box).value || todayISO(), ref: null };
        patch.__paidUnknown = !amt;
      }
    }
    if ($('#convOn', box)?.checked) patch.conversion = Math.min(5, Math.max(1, parseInt(j.conversion.score, 10) || 3));
    const fin = patch.__finishes; delete patch.__finishes;
    const pu = patch.__paidUnknown; delete patch.__paidUnknown;
    ['measure_date', 'delivery_date', 'install_date'].forEach((k) => { if (patch[k] && !/^\d{4}-\d{2}-\d{2}$/.test(patch[k])) delete patch[k]; });
    if (patch.first_contact && !/^\d{4}-\d{2}-\d{2}$/.test(patch.first_contact)) delete patch.first_contact;
    if (!c) {
      c = await D.insert('customers', { name: patch.name || 'New lead', stage: 'new', first_contact: patch.first_contact || todayISO(), data: { ...(fin ? { finishes: fin } : {}), ...(pu ? { paidUnknown: true } : {}) }, revisions: 0, created_by: S.me?.id, ...patch });
      S.customers.push(c);
      await logEvent(c.id, 'system', 'Lead created from a drop');
    } else {
      if (fin || pu != null) patch.data = { ...(c.data || {}), ...(fin ? { finishes: fin } : {}), ...(pu != null ? { paidUnknown: pu && !c.paid?.amount } : {}) };
      await patchCustomer(c, patch);
    }
    // files
    for (let i = 0; i < st.files.length; i++) {
      if (!$(`[data-fl="${i}"]`, box)?.checked) continue;
      const f = st.files[i].file; const type = $(`[data-ft="${i}"]`, box).value;
      const path = `${c.id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
      await D.upload(f, path);
      const v = Math.max(0, ...custFiles(c.id).concat(S.files.filter((x) => x.customer_id === c.id)).filter((x) => x.ftype === type).map((x) => x.version)) + 1;
      const row = await D.insert('files', { customer_id: c.id, path, name: f.name, ftype: type, version: v, size: f.size, mime: f.type || null, by: S.me?.id });
      S.files.push(row);
    }
    // history
    for (const [i, l] of (j.log || []).entries()) {
      if (!$(`[data-log="${i}"]`, box)?.checked) continue;
      const d = $(`[data-ld="${i}"]`, box).value;
      await D.insert('logs', { customer_id: c.id, kind: $(`[data-lk="${i}"]`, box).value, at: d ? new Date(d + 'T12:00').toISOString() : new Date().toISOString(), summary: $(`[data-ls="${i}"]`, box).value, who: ['us', 'customer', 'supplier', 'contractor'].includes(j.log[i]?.who) ? j.log[i].who : null, by: S.me?.id });
    }
    if (st.text.trim()) await logEvent(c.id, 'upload', `Dropped text${st.instr ? ': ' + st.instr : ''}`, st.text);
    else if (st.files.length) await logEvent(c.id, 'upload', `Dropped ${st.files.length} file${st.files.length > 1 ? 's' : ''}`);
    // steps
    for (const [i] of (j.actions || []).entries()) {
      if (!$(`[data-act="${i}"]`, box)?.checked) continue;
      await D.insert('actions', { customer_id: c.id, title: $(`[data-at="${i}"]`, box).value, waiting_on: $(`[data-aw="${i}"]`, box).value, due: $(`[data-ad="${i}"]`, box).value || null, done: false, owner: S.me?.id });
    }
    if ($('#naOn', box).checked && $('#naT', box).value.trim()) await D.insert('actions', { customer_id: c.id, title: $('#naT', box).value.trim(), waiting_on: $('#naW', box).value, due: $('#naD', box).value || null, done: false, owner: S.me?.id });
    if ($('#qOn', box)?.checked) await D.insert('actions', { customer_id: c.id, title: 'Ask customer: ' + j.questions.join('; ').slice(0, 400), waiting_on: 'us', due: todayISO(), done: false, owner: S.me?.id });
    // sizes
    for (const [i, s] of (j.sizes || []).entries()) {
      if (!$(`[data-sz="${i}"]`, box)?.checked) continue;
      await D.insert('sizes', { customer_id: c.id, what: $(`[data-sw="${i}"]`, box).value, value: n($(`[data-sv="${i}"]`, box).value), unit: $(`[data-su="${i}"]`, box).value, source: s.source || 'drop' });
    }
    // layout
    if (lay && $('#layOn', box)?.checked) {
      const prev = custLayouts(c.id)[0];
      await D.insert('layouts', { customer_id: c.id, name: prev?.name || 'Kitchen', version: (prev?.version || 0) + 1, plan: planFromSpec(lay), is_revision: false, by: S.me?.id });
      await logEvent(c.id, 'system', `Layout drawn from drop (v${(prev?.version || 0) + 1})`);
    }
    if ($('#revOn', box)?.checked) await bumpRevision(c, +1, j.revision?.why || 'From a drop');
    if (lines.length && $('#linesOn', box)?.checked) await addLinesToQuote(c, lines);
    if (pu) await D.insert('actions', { customer_id: c.id, title: 'Enter how much was paid (Money & dates tab)', waiting_on: 'us', due: todayISO(), done: false, owner: S.me?.id });
    if ($('#stOn', box)?.checked) { await patchCustomer(c, { stage: j.stage }); await logEvent(c.id, 'system', `Moved to ${STAGES[stageIdx(j.stage)].label} (from a drop)`); }
    if (fbRating || $('#fbNote', box).value.trim()) await D.insert('feedback', { context: 'drop', rating: fbRating || null, note: $('#fbNote', box).value.trim() || null, by: S.me?.id });
    close();
    toast('Saved to HQ.');
    location.hash = 'c-' + c.id;
  } catch (e) {
    console.error(e);
    btn.disabled = false; btn.textContent = 'Save to HQ';
    toast('Save failed: ' + e.message);
  }
}
