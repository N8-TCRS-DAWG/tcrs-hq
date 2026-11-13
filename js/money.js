// Money: real revenue, costs, profit and channel ROI from HQ's own records.
// Revenue = what customers have paid (QuickBooks payment emails + manual entries).
// Costs = per-job cost typed here, else the cost side of the job's HQ quote. Unknown costs are shown as unknown, never guessed.
// Channel spend = what has been spent on each lead channel so far (typed here, admin only).
import * as D from './data.js?v=20261113003207';
import { S, esc, $, $$, n, money0, fmtDate, isPrePaid, custQuote, quoteCalc, toast, settings } from './core.js?v=20261113003207';
import { received, value } from './board.js?v=20261113003207';

/* Lead source (free text) → channel. Order matters: first match wins. */
const CHANNELS = [
  ['Trade show', /trade ?show|home ?show|eagan|2026eagan/i],
  ['Google (LSA + search)', /google/i],
  ['FB Marketplace', /marketplace/i],
  ['Facebook / Instagram', /facebook|\bfb\b|messenger|instagram/i],
  ['Nextdoor', /nextdoor/i],
  ['Website form', /website|framer|web form|site form/i],
  ['J&K referrals', /j ?& ?k|jk cab/i],
  ['Contractors', /contractor|authentic remodel|\btj\b/i],
  ['Designers', /designer|interiors/i],
  ['Repeat customers', /repeat/i],
  ['Team network (Lee / Trevor / A4L)', /\blee\b|trevor|a4l|appliances ?4 ?less/i],
  ['Walk-in', /walk-?in/i],
];
export const channel = (src) => (CHANNELS.find(([, rx]) => rx.test(src || '')) || ['Unknown / email'])[0];

const won = (c) => !c.lost && ['accepted', 'paid', 'ordered', 'installed'].includes(c.stage);   // accepted or later = won
function jobCost(c) {
  const m = n(c.data?.jobCost);
  if (m != null) return { v: m, src: 'typed' };
  const q = custQuote(c.id);
  if (q) { const t = quoteCalc(q, c); if (t.cost > 0) return { v: t.cost, src: 'quote' }; }
  return { v: null, src: '' };
}
const pct = (x) => (x == null || !isFinite(x) ? '—' : Math.round(x) + '%');
const ym = (iso) => (iso || '').slice(0, 7);

export function renderMoney(v) {
  const admin = S.role === 'admin';
  if (!admin) { v.innerHTML = '<section class="panel" style="margin:16px"><p>Money is visible to admins only.</p></section>'; return; }
  const all = S.customers;
  const jobs = all.filter(won).map((c) => {
    const rev = received(c); const booked = value(c); const k = jobCost(c);
    const base = rev || booked;
    return { c, rev, booked, cost: k.v, csrc: k.src, profit: k.v != null ? base - k.v : null, ch: channel(c.source), month: ym(c.paid?.at || c.install_date || c.updated_at) };
  });
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const revenue = sum(jobs, (j) => j.rev);
  const booked = sum(jobs, (j) => j.booked);
  const withCost = jobs.filter((j) => j.cost != null);
  const costKnown = sum(withCost, (j) => j.cost);
  const profitKnown = sum(withCost, (j) => j.profit);
  const baseKnown = sum(withCost, (j) => j.rev || j.booked);
  const spendMap = settings().spend || {};
  const spend = Object.values(spendMap).reduce((s, x) => s + (n(x) || 0), 0);
  const open = all.filter((c) => !c.lost && isPrePaid(c) && !won(c));
  const pipeline = sum(open, (c) => value(c));
  const decided = all.filter((c) => won(c) || c.lost).length;

  // Channels
  const chRows = {};
  for (const c of all) { const k = channel(c.source); (chRows[k] ||= { leads: 0, won: 0, lost: 0, booked: 0, profit: 0, profitKnown: 0, jobs: 0 }); const r = chRows[k]; r.leads++; if (c.lost) r.lost++; }
  for (const j of jobs) { const r = chRows[j.ch]; r.won++; r.booked += j.rev || j.booked; if (j.profit != null) { r.profit += j.profit; r.profitKnown++; } r.jobs++; }
  const chList = Object.entries(chRows).sort((a, b) => b[1].booked - a[1].booked || b[1].leads - a[1].leads);

  // Months (revenue collected vs known costs + channel spend is not dated, so it's shown separately)
  const months = [...new Set(jobs.map((j) => j.month).filter(Boolean))].sort().slice(-6);
  const mRows = months.map((m) => { const js = jobs.filter((j) => j.month === m); return { m, rev: sum(js, (j) => j.rev || j.booked), cost: sum(js.filter((j) => j.cost != null), (j) => j.cost), unknown: js.filter((j) => j.cost == null).length }; });
  const mMax = Math.max(1, ...mRows.map((r) => Math.max(r.rev, r.cost)));

  v.innerHTML = `<div class="mn">
    <div class="mn-head"><div><h1>Money</h1><span class="small muted">Real numbers from HQ: what customers paid, job costs you enter or quote costs, and what each lead channel has cost. Unknown costs stay unknown — nothing is guessed.</span></div></div>
    <div class="ag-tiles">
      <div class="ag-tile"><b>${money0(revenue)}</b><span>collected from customers</span></div>
      <div class="ag-tile"><b>${money0(booked)}</b><span>won jobs' value (${jobs.length} jobs)</span></div>
      <div class="ag-tile"><b>${withCost.length ? money0(profitKnown) : '—'}</b><span>gross profit on ${withCost.length} of ${jobs.length} jobs with a cost</span></div>
      <div class="ag-tile"><b>${withCost.length ? pct(profitKnown / baseKnown * 100) : '—'}</b><span>profit rate (gross margin) on those jobs</span></div>
      <div class="ag-tile"><b>${withCost.length ? money0(profitKnown / withCost.length) : '—'}</b><span>average profit per project</span></div>
      <div class="ag-tile"><b>${money0(pipeline)}</b><span>open pipeline (${open.length} leads) · win rate ${decided ? pct(jobs.length / decided * 100) : '—'}</span></div>
    </div>
    ${withCost.length < jobs.length ? `<p class="mn-note">⚠ ${jobs.length - withCost.length} won job${jobs.length - withCost.length === 1 ? ' has' : 's have'} no cost yet, so profit covers only ${withCost.length}. Type what TCRS paid (supplier + install + delivery) in the table below.</p>` : ''}

    <h2>Revenue vs costs by month</h2>
    <div class="ag-bars">${mRows.length ? mRows.map((r) => `<div class="mn-m"><span>${new Date(r.m + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span>
      <div class="mn-pair"><div class="ag-bar-row"><i class="b-rev" style="width:${(r.rev / mMax * 100).toFixed(1)}%"></i><b>${money0(r.rev)}</b></div>
      <div class="ag-bar-row"><i class="b-cogs" style="width:${(r.cost / mMax * 100).toFixed(1)}%"></i><b>${money0(r.cost)}${r.unknown ? ` <em class="muted">+ ${r.unknown} unknown</em>` : ''}</b></div></div></div>`).join('')
      : '<p class="small muted">No won jobs with dates yet.</p>'}
      <div class="small muted"><span class="mn-key b-rev"></span> Revenue (paid, else job value) &nbsp; <span class="mn-key b-cogs"></span> Known job costs. Channel spend: ${money0(spend)} total so far (not dated).</div></div>

    <h2>Return by lead channel</h2>
    <div class="crm-wrap"><table class="mn-t">
      <thead><tr><th>Channel</th><th>Leads</th><th>Won</th><th>Win rate</th><th>Revenue</th><th>Spent so far</th><th title="Revenue per $1 spent">Revenue per $1</th><th title="(Profit − spend) ÷ spend">ROI</th></tr></thead>
      <tbody>${chList.map(([k, r]) => { const sp = n(spendMap[k]) || 0; const dec = r.won + r.lost; return `<tr>
        <td><b>${esc(k)}</b></td><td>${r.leads}</td><td>${r.won}</td><td>${dec ? pct(r.won / dec * 100) : '—'}</td><td>${money0(r.booked)}</td>
        <td><input type="text" class="mn-in" data-spend="${esc(k)}" value="${sp || ''}" placeholder="$0"></td>
        <td>${sp ? '$' + (r.booked / sp).toFixed(2) : '—'}</td>
        <td>${sp && r.profitKnown === r.jobs && r.jobs ? pct((r.profit - sp) / sp * 100) : sp ? '<span class="muted" title="Needs a cost on every won job in this channel">needs costs</span>' : '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="small muted">Win rate = won ÷ (won + lost); open leads aren't counted yet. ROI (return on investment) = (gross profit − spend) ÷ spend, shown only when every won job in that channel has a cost. Channels are read from each lead's source; fix a source on the customer file to move it.</p>

    <h2>Won jobs</h2>
    <div class="crm-wrap"><table class="mn-t">
      <thead><tr><th>Customer</th><th>Channel</th><th>Paid</th><th>Job value</th><th>What TCRS paid</th><th>Profit</th><th>Margin</th></tr></thead>
      <tbody>${jobs.sort((a, b) => (b.rev || b.booked) - (a.rev || a.booked)).map((j) => `<tr>
        <td><a href="#c-${j.c.id}">${esc(j.c.name || 'No name')}</a></td><td class="small">${esc(j.ch)}</td><td>${money0(j.rev)}</td><td>${money0(j.booked)}</td>
        <td><input type="text" class="mn-in" data-cost="${j.c.id}" value="${j.csrc === 'typed' ? j.cost : ''}" placeholder="${j.csrc === 'quote' ? money0(j.cost) + ' (quote)' : 'cost?'}"></td>
        <td>${j.profit != null ? money0(j.profit) : '—'}</td><td>${j.profit != null && (j.rev || j.booked) ? pct(j.profit / (j.rev || j.booked) * 100) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Saving: click out of a box. QuickBooks isn't connected to HQ yet; once it is, costs can fill in from bills automatically.</p>
  </div>`;

  $$('[data-cost]', v).forEach((i) => (i.onchange = async () => {
    const c = S.customers.find((x) => x.id === i.dataset.cost); if (!c) return;
    const val = n(i.value);
    await D.update('customers', c.id, { data: { ...(c.data || {}), jobCost: val } });
    toast(val == null ? 'Cost cleared.' : `Cost saved for ${c.name}.`);
  }));
  $$('[data-spend]', v).forEach((i) => (i.onchange = async () => {
    const row = S.settings.find((r) => r.id === 'main');
    const data = { ...(row?.data || {}) };
    data.spend = { ...(data.spend || {}), [i.dataset.spend]: n(i.value) || 0 };
    await D.upsert('settings', { id: 'main', data });
    toast('Spend saved.');
  }));
}
