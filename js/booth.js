// Booth mode: 15-second lead capture at a trade show, on a phone.
// Each lead lands in HQ (source = the show), gets a "send follow-up" step, and is queued for a
// personalized follow-up email that the Gmail script saves as a DRAFT the same evening (never sent).
import * as D from './data.js?v=20261112182510';
import { S, esc, $, $$, todayISO, toast, canWrite, fmtDate } from './core.js?v=20261112182510';

export const SHOW = { key: 'eagan-2026-11-14', name: 'Trade show – Eagan 11/14/26', date: '2026-11-14' };
const PRODUCTS = ['Cabinets', 'Countertops', 'Flooring', 'Appliances', 'Furniture', 'Sauna / plunge', 'Garage doors', 'Other'];
// Booth offers (Nathan's rules, Nov 2026). One offer per project; prizes can't be combined with 2026EAGAN.
export const OFFERS = [
  ['code', '2026EAGAN — 10% off total project'],
  ['100', 'Prize: $100 off'],
  ['500', 'Prize: $500 off (project $2,500+)'],
  ['1000', 'Prize: $1,000 off (project $5,000+)'],
  ['delivery', 'Prize: free delivery (within 50 miles)'],
  ['hood', 'Prize: free custom range hood'],
];
const WHEN = ['Now', '1–3 months', '3–6 months', 'Later / just looking'];

let F = fresh();
function fresh() { return { name: '', phone: '', email: '', city: '', ctype: 'Homeowner', products: [], when: '', offer: 'code', notes: '' }; }
const showLeads = () => S.customers.filter((c) => c.data?.booth?.show === SHOW.key).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

export function renderBooth(v) {
  if (!canWrite()) { v.innerHTML = '<section class="panel" style="margin:16px"><p>Booth mode needs a sales or admin login.</p></section>'; return; }
  const leads = showLeads();
  const queued = leads.filter((c) => !c.data?.booth?.followed).length;
  v.innerHTML = `<div class="bo">
    <div class="bo-head"><div><h1>Booth</h1><span class="small muted">${esc(SHOW.name)} · ${leads.length} lead${leads.length === 1 ? '' : 's'} captured${queued ? ` · ${queued} follow-up${queued === 1 ? '' : 's'} queued` : ''}</span></div></div>
    <form class="bo-form" id="boF" autocomplete="off">
      <label class="field"><span class="lbl">Name *</span><input id="boName" required value="${esc(F.name)}" autocapitalize="words" enterkeyhint="next"></label>
      <div class="bo-2"><label class="field"><span class="lbl">Phone</span><input id="boPhone" type="tel" inputmode="tel" value="${esc(F.phone)}"></label>
      <label class="field"><span class="lbl">Email</span><input id="boEmail" type="email" inputmode="email" autocapitalize="off" value="${esc(F.email)}"></label></div>
      <div class="bo-2"><label class="field"><span class="lbl">City</span><input id="boCity" value="${esc(F.city)}" autocapitalize="words"></label>
      <div class="field"><span class="lbl">Who</span><div class="row">${['Homeowner', 'Contractor', 'Designer', 'Flipper'].map((k) => `<button type="button" class="chip pick ${F.ctype === k ? 'on' : ''}" data-ct="${k}">${k}</button>`).join('')}</div></div></div>
      <div class="field"><span class="lbl">Interested in</span><div class="row">${PRODUCTS.map((p) => `<button type="button" class="chip pick ${F.products.includes(p) ? 'on' : ''}" data-pr="${p}">${p}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl">Timeline</span><div class="row">${WHEN.map((w) => `<button type="button" class="chip pick ${F.when === w ? 'on' : ''}" data-wh="${w}">${w}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl">Offer (one per project)</span><select id="boOffer">${OFFERS.map(([k, l]) => `<option value="${k}" ${F.offer === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <label class="field"><span class="lbl">Notes (what they want, room size, style)</span><textarea id="boNotes" rows="2">${esc(F.notes)}</textarea></label>
      <p class="small muted bo-msg" id="boMsg" role="status"></p>
      <button class="btn primary bo-save" type="submit">Save lead</button>
    </form>
    <h2>Captured at the show</h2>
    <ol class="bo-list">${leads.length ? leads.map((c) => `<li><a href="#c-${c.id}"><b>${esc(c.name)}</b></a> <span class="small muted">${esc([(c.products || []).join(', '), c.data?.booth?.when, c.phone || c.email].filter(Boolean).join(' · '))}</span> <span class="chip ${c.data?.booth?.followed ? '' : 'ag-amber'}">${c.data?.booth?.followed ? 'Follow-up drafted ' + fmtDate(c.data.booth.followed.slice(0, 10)) : (c.email ? 'Follow-up queued' : 'No email — call/text')}</span></li>`).join('') : '<li class="muted">No leads yet.</li>'}</ol>
    <p class="small muted">Follow-up emails: the Gmail script writes a personal thank-you with their offer and the intake link, and saves it as a <b>Gmail draft</b> (7pm daily, or run <b>chaseNow</b>). Nothing sends until you press Send.</p>
  </div>`;
  const keep = () => { F.name = $('#boName', v).value; F.phone = $('#boPhone', v).value; F.email = $('#boEmail', v).value; F.city = $('#boCity', v).value; F.offer = $('#boOffer', v).value; F.notes = $('#boNotes', v).value; };
  $$('[data-ct]', v).forEach((b) => (b.onclick = () => { keep(); F.ctype = b.dataset.ct; renderBooth(v); }));
  $$('[data-pr]', v).forEach((b) => (b.onclick = () => { keep(); const p = b.dataset.pr; F.products = F.products.includes(p) ? F.products.filter((x) => x !== p) : [...F.products, p]; renderBooth(v); }));
  $$('[data-wh]', v).forEach((b) => (b.onclick = () => { keep(); F.when = F.when === b.dataset.wh ? '' : b.dataset.wh; renderBooth(v); }));
  $('#boF', v).onsubmit = async (e) => {
    e.preventDefault(); keep();
    const msg = $('#boMsg', v);
    if (!F.name.trim()) { msg.textContent = 'Add a name first.'; return; }
    if (!F.phone.trim() && !F.email.trim()) { msg.textContent = 'Add a phone or an email so we can follow up.'; return; }
    if (F.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(F.email.trim())) { msg.textContent = 'That email looks off — check it.'; return; }
    const dupe = S.customers.find((c) => (F.email && c.email && c.email.toLowerCase() === F.email.trim().toLowerCase()) || (F.phone && c.phone && c.phone.replace(/\D/g, '').slice(-10) === F.phone.replace(/\D/g, '').slice(-10)));
    const offer = OFFERS.find((o) => o[0] === F.offer)?.[1] || '';
    const booth = { show: SHOW.key, at: new Date().toISOString(), offer: F.offer, offerText: offer, when: F.when, notes: F.notes.trim(), followed: null };
    try {
      let c;
      if (dupe) {
        c = dupe;
        await D.update('customers', c.id, { data: { ...(c.data || {}), booth }, products: [...new Set([...(c.products || []), ...F.products])] });
      } else {
        c = await D.insert('customers', {
          name: F.name.trim(), phone: F.phone.trim() || null, email: F.email.trim().toLowerCase() || null, city: F.city.trim() || null,
          ctype: F.ctype, source: SHOW.name, stage: 'new', products: F.products, services: [], first_contact: todayISO(), timeline: F.when || null,
          tldr: [`Met at the ${SHOW.name.replace('Trade show – ', '')} show.`, F.products.length ? `Interested in ${F.products.join(', ').toLowerCase()}.` : '', F.when ? `Timeline: ${F.when}.` : '', F.notes.trim()].filter(Boolean).join(' '),
          data: { booth }, revisions: 0, intake_complete: false, repeat: false,
        });
      }
      await D.insert('actions', { customer_id: c.id, title: c.email ? 'Review + send the post-show follow-up draft' : 'Call or text: post-show follow-up', due: SHOW.date, waiting_on: 'us', done: false, owner: S.me?.id || null });
      await D.insert('logs', { customer_id: c.id, kind: 'note', at: new Date().toISOString(), who: 'us', summary: `Met at the booth (${SHOW.name}). Offer: ${offer}${F.notes.trim() ? '. Notes: ' + F.notes.trim().slice(0, 160) : ''}`, by: S.me?.id || null });
      toast(dupe ? `${c.name} was already in HQ — updated.` : `Saved ${c.name}.`);
      F = fresh();
      renderBooth(v);
      setTimeout(() => { if (document.getElementById('boF')) { renderBooth(v); $('#boName', v)?.focus(); } }, 450);   // list refreshes once HQ reloads
    } catch (err) { msg.textContent = 'Not saved: ' + err.message; }
  };
}
