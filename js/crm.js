// CRM: every customer and partner, kept current by Drop and the 9am/9pm inbox sweep.
import { S, STAGES, esc, $, $$, status, stageIdx, fmtDate, money0, STATUS_TEXT, isPrePaid } from './core.js?v=20261112192956';
import { value, received } from './board.js?v=20261112192956';

const C = { q: '', f: 'open', sort: 'last', dir: -1 };
const COURT = { us: 'Our court', customer: "Customer's court", supplier: "Supplier's court", contractor: "Contractor's court" };
const FILTERS = [
  ['open', 'Open leads', (c) => !c.lost && isPrePaid(c)],
  ['won', 'Paid jobs', (c) => !c.lost && !isPrePaid(c)],
  ['review', 'Needs a check', (c) => !c.lost && (c.data?.needsReview || (c.data?.changes || []).length)],
  ['lost', 'Lost', (c) => !!c.lost],
  ['all', 'Everyone', () => true],
];

function lastLog(c) {
  return S.logs.filter((l) => l.customer_id === c.id && l.kind !== 'system').sort((a, b) => b.at.localeCompare(a.at))[0] || null;
}
function row(c) {
  const l = lastLog(c);
  const st = status(c);
  return { c, l, st, last: l?.at || c.first_contact || '', name: (c.name || '').toLowerCase(), stage: stageIdx(c.stage), value: value(c), paid: received(c), first: c.first_contact || '' };
}

export function renderCRM(v) {
  const sweep = S.settings.find((r) => r.id === 'sweep')?.data?.runs?.[0];
  const q = C.q.trim().toLowerCase();
  const fil = FILTERS.find((f) => f[0] === C.f) || FILTERS[0];
  let rows = S.customers.filter(fil[2]).filter((c) => !q || [c.name, c.email, c.phone, (c.phone || '').replace(/\D/g, ''), c.address, c.city, c.source, (c.products || []).join(' '), c.tldr].join(' ').toLowerCase().includes(q)).map(row);
  const key = { last: 'last', name: 'name', stage: 'stage', value: 'value', first: 'first', paid: 'paid' }[C.sort] || 'last';
  rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * C.dir);
  const th = (k, l) => `<th><button type="button" data-sort="${k}" class="${C.sort === k ? 'on' : ''}">${l}${C.sort === k ? (C.dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;

  v.innerHTML = `
  <div class="crm-top">
    <h2>CRM</h2>
    <div class="crm-f">${FILTERS.map(([k, l, fn]) => `<button type="button" data-f="${k}" class="${C.f === k ? 'on' : ''}">${l} <span class="num">${S.customers.filter(fn).length}</span></button>`).join('')}<button type="button" data-f="partners" class="${C.f === 'partners' ? 'on' : ''}">Suppliers & contractors <span class="num">${S.partners.length}</span></button></div>
    <input type="search" id="cq" placeholder="Search name, phone, email, address, product" value="${esc(C.q)}" aria-label="Search CRM">
    <button class="btn sm" type="button" id="csv">Export CSV</button>
  </div>
  <p class="small muted crm-sweep">${sweep ? `Inbox sweep (${esc(sweep.box || 'nathan')}@) last ran ${fmtDate(sweep.at.slice(0, 10))} ${new Date(sweep.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${sweep.created || 0} new lead${sweep.created === 1 ? '' : 's'}, ${sweep.updated || 0} updated, ${(sweep.drafts || 0) + (sweep.sent || 0)} first repl${(sweep.drafts || 0) + (sweep.sent || 0) === 1 ? 'y' : 'ies'}${sweep.errors ? `, <b style="color:var(--red)">${sweep.errors} errors</b>` : ''}.` : 'Inbox sweep not running yet. Once it is, this list updates itself at 9am and 9pm.'} Drop uploads update it instantly.</p>
  ${C.f === 'partners' ? partnersTable() : `
  <div class="crm-wrap"><table class="crm">
    <thead><tr>${th('name', 'Name')}<th>Contact</th><th>Project</th>${th('stage', 'Stage')}<th>Whose move</th>${th('last', 'Last contact')}${th('value', 'Value')}${th('paid', 'Paid')}${th('first', 'First contact')}</tr></thead>
    <tbody>${rows.map(({ c, l, st }) => `<tr data-id="${c.id}" tabindex="0">
      <td class="nm"><b>${esc(c.name || 'No name')}</b>${c.data?.auto ? ' <span class="chip" title="Kept current from email">auto</span>' : ''}${c.data?.needsReview || (c.data?.changes || []).length ? ' <span class="chip warn" title="Claude wasn\'t sure, or new contact info arrived">check</span>' : ''}<div class="small muted">${esc([c.ctype, c.source].filter(Boolean).join(' · '))}</div></td>
      <td><div>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="muted">no phone</span>'}</div><div class="small">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">no email</span>'}</div></td>
      <td><div>${esc((c.products || []).join(', ') || '—')}</div><div class="small muted">${esc([c.address, c.city].filter(Boolean).join(', '))}</div></td>
      <td>${esc(STAGES[stageIdx(c.stage)].label)}${c.lost ? ' <span class="chip warn">Lost</span>' : ''}</td>
      <td>${st.k === 'none' ? '<span class="muted">—</span>' : `<span class="court c-${st.who || (st.k === 'green' ? 'customer' : st.k === 'yellow' ? 'supplier' : 'us')}">${COURT[st.who] || STATUS_TEXT[st.k]}</span><div class="small muted clamp1">${esc(st.why)}</div>`}</td>
      <td>${l ? `${fmtDate(l.at.slice(0, 10))}<div class="small muted clamp1">${esc(l.summary || '')}</div>` : '<span class="muted">—</span>'}</td>
      <td class="num">${value(c) ? money0(value(c)) : '—'}</td>
      <td class="num">${received(c) ? `<span style="color:var(--green);font-weight:700">${money0(received(c))}</span>` : '—'}</td>
      <td>${c.first_contact ? fmtDate(c.first_contact) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">Nobody matches.</td></tr>'}</tbody>
  </table></div>`}`;

  $$('[data-f]', v).forEach((b) => (b.onclick = () => { C.f = b.dataset.f; renderCRM(v); }));
  $$('[data-sort]', v).forEach((b) => (b.onclick = () => { if (C.sort === b.dataset.sort) C.dir = -C.dir; else { C.sort = b.dataset.sort; C.dir = b.dataset.sort === 'name' ? 1 : -1; } renderCRM(v); }));
  $$('tr[data-id]', v).forEach((r) => {
    r.onclick = (e) => { if (e.target.closest('a')) return; location.hash = 'c-' + r.dataset.id; };
    r.onkeydown = (e) => { if (e.key === 'Enter') location.hash = 'c-' + r.dataset.id; };
  });
  const cq = $('#cq', v);
  cq.oninput = () => { C.q = cq.value; clearTimeout(cq._t); cq._t = setTimeout(() => { renderCRM(v); const x = $('#cq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 200); };
  $('#csv', v).onclick = () => exportCSV(C.f === 'partners' ? null : rows);
}

function partnersTable() {
  const ps = [...S.partners].sort((a, b) => (a.ptype || '').localeCompare(b.ptype || '') || (a.name || '').localeCompare(b.name || ''));
  return `<div class="crm-wrap"><table class="crm"><thead><tr><th>Name</th><th>Type</th><th>Trades</th><th>Contact</th><th>Discount / referral</th><th>Notes</th></tr></thead><tbody>
    ${ps.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.ptype)}</td><td>${esc(p.trades || '')}</td><td>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}<div class="small">${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</div></td><td>${p.discount_pct != null ? esc(p.discount_pct) + '% off list' : ''}${p.referral_pct != null ? esc(p.referral_pct) + '% referral' : ''}</td><td class="small">${esc(p.notes || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No partners yet. Add them under Prices & partners.</td></tr>'}
  </tbody></table></div>`;
}

function exportCSV(rows) {
  const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  let lines;
  if (!rows) lines = [['Name', 'Type', 'Trades', 'Phone', 'Email', 'Discount %', 'Referral %', 'Notes'], ...S.partners.map((p) => [p.name, p.ptype, p.trades, p.phone, p.email, p.discount_pct, p.referral_pct, p.notes])];
  else lines = [['Name', 'Phone', 'Email', 'Address', 'City', 'Products', 'Stage', 'Whose move', 'Why', 'Last contact', 'Last note', 'Value', 'Paid', 'First contact', 'Source', 'Type'],
    ...rows.map(({ c, l, st }) => [c.name, c.phone, c.email, c.address, c.city, (c.products || []).join('; '), STAGES[stageIdx(c.stage)].label, COURT[st.who] || '', st.why, l?.at?.slice(0, 10), l?.summary, value(c) || '', received(c) || '', c.first_contact, c.source, c.ctype])];
  const blob = new Blob([lines.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `TCRS-CRM-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
