// Layout grid: quick plan view (bird's eye) + wall-by-wall elevations.
// Units are inches. Walls run in order; items sit flush on a wall's room side.
import * as D from './data.js';
import { S, esc, $, $$, n, r2, toast, canWrite, logEvent, custLayouts, custSizes, todayISO } from './core.js';
import { bumpRevision } from './customer.js';
import { addLinesToQuote, ensureQuote } from './quote.js';

const TYPES = {
  base: { label: 'Base cabinet', d: 24, h: 34.5, z: 0, fill: '#E3C9A0', stroke: '#8E6A3A' },
  upper: { label: 'Wall cabinet', d: 12, h: 30, z: 54, fill: 'rgba(174,103,65,.28)', stroke: '#AE6741' },
  tall: { label: 'Tall / pantry', d: 24, h: 84, z: 0, fill: 'rgba(22,49,38,.25)', stroke: '#163126' },
  appliance: { label: 'Appliance', d: 26, h: 36, z: 0, fill: '#D5D9D5', stroke: '#5D6A61' },
  opening: { label: 'Opening', d: 5, h: 36, z: 40, fill: '#CFE3F0', stroke: '#4F86AD' },
  island: { label: 'Island', d: 36, h: 34.5, z: 0, fill: '#EAD7B5', stroke: '#8E6A3A' },
};
const SUBS = {
  range: { label: 'Range', w: 30, d: 26, h: 36, z: 0 }, fridge: { label: 'Fridge', w: 36, d: 30, h: 70, z: 0 },
  dw: { label: 'Dishwasher', w: 24, d: 24, h: 34.5, z: 0 }, micro: { label: 'Microwave (over range)', w: 30, d: 15, h: 17, z: 66 },
  hood: { label: 'Hood', w: 30, d: 20, h: 18, z: 66 }, washer: { label: 'Washer', w: 27, d: 30, h: 38, z: 0 }, dryer: { label: 'Dryer', w: 27, d: 30, h: 38, z: 0 },
  window: { label: 'Window', w: 36, d: 5, h: 36, z: 40 }, door: { label: 'Door', w: 32, d: 5, h: 80, z: 0 },
  sink: { label: 'Sink base', w: 36, d: 24, h: 34.5, z: 0 },
};
const WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 48];
const COUNTER_D = 25.5;

/* ───────── geometry ───────── */
const len = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
function frame(w) {
  const L = len(w) || 1, ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
  const nx = w.flip ? uy : -uy, ny = w.flip ? -ux : ux;
  return { L, ux, uy, nx, ny };
}
function itemPoly(it, plan) {
  if (it.wallId) {
    const w = plan.walls.find((x) => x.id === it.wallId);
    if (!w) return null;
    const f = frame(w);
    const sx = w.x1 + f.ux * it.off, sy = w.y1 + f.uy * it.off;
    const p = [[sx, sy], [sx + f.ux * it.w, sy + f.uy * it.w], [sx + f.ux * it.w + f.nx * it.d, sy + f.uy * it.w + f.ny * it.d], [sx + f.nx * it.d, sy + f.ny * it.d]];
    return p;
  }
  const a = (it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const hw = it.w / 2, hd = it.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [it.x + x * c - y * s, it.y + x * s + y * c]);
}
function segDist(px, py, w) {
  const f = frame(w);
  let t = ((px - w.x1) * f.ux + (py - w.y1) * f.uy);
  t = Math.max(0, Math.min(f.L, t));
  const qx = w.x1 + f.ux * t, qy = w.y1 + f.uy * t;
  return { d: Math.hypot(px - qx, py - qy), t };
}
const snap = (v, s = 3) => Math.round(v / s) * s;
const uid = () => D.uuid();
const subOf = (it) => (it.sub && SUBS[it.sub]) || null;
const labelOf = (it) => it.label || subOf(it)?.label || TYPES[it.cat]?.label || it.cat;

function autoFlip(plan) {
  const pts = plan.walls.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]]);
  if (!pts.length) return;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  plan.walls.forEach((w) => {
    w.flip = false;
    const f = frame(w);
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
    if ((cx - mx) * f.nx + (cy - my) * f.ny < -0.01) w.flip = true;
  });
}
function nameWalls(plan) { plan.walls.forEach((w, i) => { if (!w.name) w.name = String.fromCharCode(65 + i); }); }

/* walls from lengths, each turning 90° clockwise, starting heading right */
function wallsFromLengths(lengths, closeRoom) {
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let x = 0, y = 0;
  const walls = lengths.map((L, i) => {
    const [dx, dy] = dirs[i % 4];
    const w = { id: uid(), name: String.fromCharCode(65 + i), x1: x, y1: y, x2: x + dx * L, y2: y + dy * L, flip: false };
    x = w.x2; y = w.y2; return w;
  });
  if (closeRoom && walls.length >= 3 && Math.hypot(x, y) > 1) walls.push({ id: uid(), name: String.fromCharCode(65 + walls.length), x1: x, y1: y, x2: 0, y2: 0, flip: false });
  return walls;
}
export function planFromSpec(spec) {
  const lengths = (spec.walls || []).map((w) => n(w.length_in) || 0).filter((v) => v > 0);
  const plan = { ceiling: n(spec.ceiling) || 96, walls: wallsFromLengths(lengths, false), items: [] };
  (spec.walls || []).forEach((w, i) => { if (plan.walls[i] && w.name) plan.walls[i].name = String(w.name); });
  autoFlip(plan);
  const cursor = {};
  (spec.items || []).forEach((s) => {
    const cat = TYPES[s.cat] ? s.cat : (s.cat === 'wall' ? 'upper' : 'base');
    const sub = SUBS[s.sub] ? s.sub : null;
    const base = sub ? SUBS[sub] : TYPES[cat];
    const it = { id: uid(), cat: sub === 'sink' ? 'base' : cat, sub, w: n(s.w) || base.w || 30, d: n(s.d) || (base.d ?? TYPES[cat].d), h: n(s.h) || (base.h ?? TYPES[cat].h), z: n(s.z) ?? (base.z ?? TYPES[cat].z), label: s.code ? String(s.code).slice(0, 24) : undefined };
    const wall = plan.walls.find((w) => w.name === String(s.wall)) || null;
    if (wall && cat !== 'island') {
      const layer = it.cat === 'upper' || it.z >= 54 ? 'up' : it.cat === 'opening' ? 'op' : 'lo';
      const key = wall.id + layer;
      it.wallId = wall.id;
      it.off = n(s.off) != null ? n(s.off) : (cursor[key] || 0);
      cursor[key] = it.off + it.w;
    } else { it.x = 60; it.y = 60; it.rot = 0; if (cat === 'island') { it.w = n(s.w) || 84; it.d = 36; } }
    plan.items.push(it);
  });
  return plan;
}

/* ───────── takeoff ───────── */
export function takeoff(plan) {
  const items = plan.items || [];
  const onCounter = (it) => it.wallId && (it.cat === 'base' || it.sub === 'dw');
  let base = 0, upper = 0, tall = 0, boxes = 0, islandBoxes = 0, counterRun = 0, islandSf = 0;
  items.forEach((it) => {
    if (it.cat === 'base') { base += it.w; boxes++; }
    if (it.cat === 'upper') { upper += it.w; boxes++; }
    if (it.cat === 'tall') { tall++; boxes++; }
    if (it.cat === 'island') { islandSf += it.w * it.d / 144; islandBoxes += Math.ceil(it.w / 30); }
    if (onCounter(it)) counterRun += it.w;
  });
  // corners where both walls carry counter right at the shared end
  let corners = 0;
  const ws = plan.walls || [];
  for (let i = 0; i < ws.length; i++) for (let j = 0; j < ws.length; j++) {
    if (i === j) continue;
    const a = ws[i], b = ws[j];
    if (Math.hypot(a.x2 - b.x1, a.y2 - b.y1) > 1) continue;
    const La = len(a);
    const endA = items.some((it) => it.wallId === a.id && onCounter(it) && it.off + it.w >= La - COUNTER_D - 0.5);
    const startB = items.some((it) => it.wallId === b.id && onCounter(it) && it.off <= COUNTER_D + 0.5);
    if (endA && startB) corners++;
  }
  const topsSf = (counterRun * COUNTER_D) / 144 - corners * (COUNTER_D * COUNTER_D) / 144 + islandSf;
  const splashSf = (counterRun * 4) / 144;
  let floorSf = null;
  if (ws.length >= 3 && Math.hypot(ws[ws.length - 1].x2 - ws[0].x1, ws[ws.length - 1].y2 - ws[0].y1) < 1) {
    let a = 0; ws.forEach((w) => (a += w.x1 * w.y2 - w.x2 * w.y1)); floorSf = Math.abs(a / 2) / 144;
  }
  return { baseLf: r2(base / 12), upperLf: r2(upper / 12), tall, boxes, islandBoxes, counterRunIn: r2(counterRun), corners, topsSf: r2(topsSf), splashSf: r2(splashSf), floorSf: floorSf != null ? r2(floorSf) : null, walls: ws.map((w) => ({ name: w.name, in: r2(len(w)) })) };
}

/* ───────── editor state ───────── */
let E = null; // { c, el, layoutId, plan, tool, sub, width, sel, view, wallPts, elevWall, vb, undo }

export function renderLayout(el, c) {
  const list = custLayouts(c.id);
  if (!E || E.c.id !== c.id || !E.dirty) {
    const cur = (E && E.c.id === c.id && list.find((l) => l.id === E.layoutId)) || list[0];
    E = { c, el, layoutId: cur?.id || null, plan: structuredClone(cur?.plan || { ceiling: 96, walls: [], items: [] }), tool: 'select', sub: 'range', opening: 'window', width: 30, sel: null, view: E?.view || 'plan', wallPts: [], elevWall: null, vb: null, undo: [], dirty: false };
    E.plan.walls = E.plan.walls || []; E.plan.items = E.plan.items || []; E.plan.ceiling = E.plan.ceiling || 96;
  }
  E.el = el; E.c = c;
  drawUI();
}

function pushUndo() { E.undo.push(JSON.stringify(E.plan)); if (E.undo.length > 40) E.undo.shift(); E.dirty = true; }

function drawUI() {
  const { c, el } = E;
  const list = custLayouts(c.id);
  const cur = list.find((l) => l.id === E.layoutId);
  const t = takeoff(E.plan);
  const ro = !canWrite();
  const tools = [['select', 'Select / move'], ['wall', 'Draw walls'], ['base', 'Base'], ['upper', 'Wall cab'], ['tall', 'Tall'], ['appliance', 'Appliance'], ['opening', 'Window / door'], ['island', 'Island']];
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
    <div class="panel row">
      <b>${esc(cur ? `${cur.name} v${cur.version}${cur.is_revision ? ' (revision)' : ''}` : 'New layout')}</b>
      ${list.length > 1 ? `<select id="lvSel" aria-label="Version">${list.map((l) => `<option value="${l.id}" ${l.id === E.layoutId ? 'selected' : ''}>v${l.version}${l.is_revision ? ' · revision' : ''} · ${new Date(l.updated_at || l.created_at).toLocaleDateString()}</option>`).join('')}</select>` : ''}
      ${E.dirty ? '<span class="pill st-yellow">Unsaved changes</span>' : ''}
      <span class="grow"></span>
      <div class="whose"><button type="button" data-view="plan" class="${E.view === 'plan' ? 'on customer' : ''}">Bird's eye</button><button type="button" data-view="elev" class="${E.view === 'elev' ? 'on customer' : ''}">Wall by wall</button></div>
      ${ro ? '' : `<button class="btn" type="button" id="lUp">⬆ Upload a layout → draw it</button><input type="file" id="lUpIn" accept="application/pdf,image/*" hidden><button class="btn" type="button" id="lSave">Save</button><button class="btn primary" type="button" id="lRev" title="Customer asked for changes: saves a new version and counts a revision">Save as revision</button>`}
    </div>
    ${ro ? '' : `<div class="panel row small">
      <span class="lbl">Quick walls</span>
      <input type="text" id="qw" placeholder='Lengths in inches, e.g. 162, 78, 87' style="min-width:220px" class="grow">
      <label class="row" style="gap:4px"><input type="checkbox" id="qwClose"> close the room</label>
      <button class="btn sm" type="button" id="qwGo">Draw</button>
      <span class="muted">or room</span><input type="text" id="qrW" placeholder="W" style="width:56px"> × <input type="text" id="qrD" placeholder="D" style="width:56px"><button class="btn sm" type="button" id="qrGo">Room</button>
      <span class="muted">Ceiling</span><input type="text" id="ceil" value="${E.plan.ceiling}" style="width:52px">"
    </div>`}
    <div class="lay">
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
        ${E.view === 'plan' && !ro ? `<div class="tools">${tools.map(([k, l]) => `<button class="btn sm ${E.tool === k ? 'on' : ''}" type="button" data-tool="${k}">${l}</button>`).join('')}
          ${['base', 'upper', 'tall', 'island'].includes(E.tool) ? `<select id="wSel" aria-label="Width">${WIDTHS.concat(E.tool === 'island' ? [60, 72, 84, 96, 108] : []).map((w) => `<option ${w === E.width ? 'selected' : ''}>${w}</option>`).join('')}</select><span class="small muted">in wide</span>` : ''}
          ${E.tool === 'appliance' ? `<select id="subSel">${['range', 'fridge', 'dw', 'micro', 'hood', 'washer', 'dryer'].map((k) => `<option value="${k}" ${E.sub === k ? 'selected' : ''}>${SUBS[k].label}</option>`).join('')}</select>` : ''}
          ${E.tool === 'base' ? `<label class="small row" style="gap:4px"><input type="checkbox" id="sinkChk" ${E.sinkBase ? 'checked' : ''}> sink base</label>` : ''}
          ${E.tool === 'opening' ? `<select id="opSel"><option value="window" ${E.opening === 'window' ? 'selected' : ''}>Window</option><option value="door" ${E.opening === 'door' ? 'selected' : ''}>Door</option></select>` : ''}
          ${E.tool === 'wall' ? `<button class="btn sm primary" type="button" id="wDone">Finish walls</button><span class="small muted">Click each corner. Snaps to 3" and square angles.</span>` : ''}
          <span class="grow"></span><button class="btn sm" type="button" id="lUndo" ${E.undo.length ? '' : 'disabled'}>Undo</button><button class="btn sm" type="button" id="lFit">Fit</button><button class="btn sm" type="button" id="lPng">Download PNG</button>
        </div>` : ''}
        ${E.view === 'elev' ? `<div class="tools">${E.plan.walls.map((w) => `<button class="btn sm ${E.elevWall === w.id ? 'on' : ''}" type="button" data-ew="${w.id}">Wall ${esc(w.name)} · ${r2(len(w))}"</button>`).join('') || '<span class="small muted">Draw walls first.</span>'}<span class="grow"></span><button class="btn sm" type="button" id="lPng">Download PNG</button></div>` : ''}
        <div class="canvas" id="cv"></div>
        <p class="small muted" style="margin:0">${E.view === 'plan' ? 'Click a wall with a cabinet tool to place it flush. Drag to slide along the wall. Select something to edit its size on the right. Delete key removes it.' : 'Looking at the wall from inside the room. Drag items left or right.'}</p>
      </div>
      <aside style="display:flex;flex-direction:column;gap:10px;min-width:0">
        <div class="panel" id="props">${propsHTML()}</div>
        <div class="panel"><h3 style="font-size:15px">Takeoff <span class="small muted">(from the drawing)</span></h3>
          <div class="takeoff" style="margin-top:6px">
            <span>Base cabinets</span><b>${t.baseLf} LF</b><span>Wall cabinets</span><b>${t.upperLf} LF</b>
            <span>Tall units</span><b>${t.tall}</b><span>Cabinet boxes</span><b>${t.boxes}${t.islandBoxes ? ` + ~${t.islandBoxes} island (est.)` : ''}</b>
            <span>Countertop</span><b>${t.topsSf} sf</b><span>4" backsplash</span><b>${t.splashSf} sf</b>
            <span>Floor</span><b>${t.floorSf != null ? t.floorSf + ' sf' : '—'}</b>
          </div>
          <p class="small muted" style="margin:6px 0">Countertop = counter run × ${COUNTER_D}" deep${t.corners ? `, minus ${t.corners} corner overlap${t.corners > 1 ? 's' : ''}` : ''}, plus islands. Approximate: verify before ordering.${t.floorSf == null ? ' Close the room to get floor sf.' : ''}</p>
          ${ro ? '' : '<button class="btn sm" type="button" id="toEst">Send takeoff to sizes + estimate</button>'}
        </div>
      </aside>
    </div></div>`;
  wireUI();
  E.view === 'plan' ? drawPlan() : drawElev();
}

function propsHTML() {
  const sel = E.sel;
  if (!sel) return `<h3 style="font-size:15px">Nothing selected</h3><p class="small muted">${E.plan.walls.length ? 'Pick the Select tool and click a wall or cabinet.' : 'Start with Quick walls above, or Draw walls.'}</p>`;
  if (sel.type === 'wall') {
    const w = E.plan.walls.find((x) => x.id === sel.id); if (!w) return '';
    return `<h3 style="font-size:15px">Wall ${esc(w.name)}</h3><div class="fields" style="margin-top:6px">
      <label class="field"><span class="lbl">Name</span><input type="text" data-wp="name" value="${esc(w.name)}"></label>
      <label class="field"><span class="lbl">Length (in)</span><input type="text" data-wp="len" value="${r2(len(w))}" inputmode="decimal"></label></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" type="button" id="wFlip">Flip room side</button><button class="btn sm danger" type="button" id="wDel">Delete wall</button></div>`;
  }
  const it = E.plan.items.find((x) => x.id === sel.id); if (!it) return '';
  const w = it.wallId ? E.plan.walls.find((x) => x.id === it.wallId) : null;
  return `<h3 style="font-size:15px">${esc(labelOf(it))}</h3><div class="fields" style="margin-top:6px">
    <label class="field"><span class="lbl">Width</span><input type="text" data-ip="w" value="${it.w}" inputmode="decimal"></label>
    <label class="field"><span class="lbl">Depth</span><input type="text" data-ip="d" value="${it.d}" inputmode="decimal"></label>
    <label class="field"><span class="lbl">Height</span><input type="text" data-ip="h" value="${it.h}" inputmode="decimal"></label>
    <label class="field"><span class="lbl">Off floor</span><input type="text" data-ip="z" value="${it.z ?? 0}" inputmode="decimal"></label>
    ${w ? `<label class="field"><span class="lbl">From wall ${esc(w.name)} start</span><input type="text" data-ip="off" value="${r2(it.off)}" inputmode="decimal"></label>` : ''}
    <label class="field"><span class="lbl">Label / finish</span><input type="text" data-ip="label" value="${esc(it.label || '')}" placeholder="${esc(labelOf(it))}"></label></div>
    <div class="row" style="margin-top:8px">${!w ? '<button class="btn sm" type="button" id="iRot">Rotate 90°</button>' : ''}<button class="btn sm" type="button" id="iDup">Duplicate</button><button class="btn sm danger" type="button" id="iDel">Delete</button></div>`;
}

function wireUI() {
  const { el, c } = E;
  $('#lvSel', el)?.addEventListener('change', (e) => { const l = custLayouts(c.id).find((x) => x.id === e.target.value); E.layoutId = l.id; E.plan = structuredClone(l.plan); E.dirty = false; E.sel = null; E.undo = []; drawUI(); });
  $$('[data-view]', el).forEach((b) => (b.onclick = () => { E.view = b.dataset.view; if (!E.elevWall) E.elevWall = E.plan.walls[0]?.id || null; drawUI(); }));
  $$('[data-tool]', el).forEach((b) => (b.onclick = () => { E.tool = b.dataset.tool; E.wallPts = []; if (E.tool === 'island') E.width = 84; else if (E.width > 48) E.width = 30; drawUI(); }));
  $('#wSel', el)?.addEventListener('change', (e) => (E.width = +e.target.value));
  $('#subSel', el)?.addEventListener('change', (e) => (E.sub = e.target.value));
  $('#opSel', el)?.addEventListener('change', (e) => (E.opening = e.target.value));
  $('#sinkChk', el)?.addEventListener('change', (e) => (E.sinkBase = e.target.checked));
  $$('[data-ew]', el).forEach((b) => (b.onclick = () => { E.elevWall = b.dataset.ew; drawUI(); }));
  $('#wDone', el)?.addEventListener('click', finishWalls);
  $('#lUndo', el)?.addEventListener('click', () => { const s = E.undo.pop(); if (s) { E.plan = JSON.parse(s); E.sel = null; drawUI(); } });
  $('#lFit', el)?.addEventListener('click', () => { E.vb = null; drawUI(); });
  $('#lPng', el)?.addEventListener('click', exportPng);
  $('#ceil', el)?.addEventListener('change', (e) => { pushUndo(); E.plan.ceiling = n(e.target.value) || 96; drawUI(); });
  $('#qwGo', el)?.addEventListener('click', () => {
    const ls = ($('#qw', el).value.match(/[\d.]+/g) || []).map(Number).filter((v) => v > 0);
    if (!ls.length) return toast('Type wall lengths in inches, e.g. 162, 78, 87');
    if (E.plan.walls.length && !confirmReplace()) return;
    pushUndo(); E.plan.walls = wallsFromLengths(ls, $('#qwClose', el).checked); E.plan.items = []; autoFlip(E.plan); E.vb = null; E.sel = null; drawUI();
  });
  $('#qrGo', el)?.addEventListener('click', () => {
    const W = n($('#qrW', el).value), Dd = n($('#qrD', el).value);
    if (!W || !Dd) return toast('Type the room width and depth in inches.');
    if (E.plan.walls.length && !confirmReplace()) return;
    pushUndo(); E.plan.walls = wallsFromLengths([W, Dd, W, Dd], false); E.plan.items = []; autoFlip(E.plan); E.vb = null; E.sel = null; drawUI();
  });
  $('#lSave', el)?.addEventListener('click', () => saveLayout(false));
  $('#lRev', el)?.addEventListener('click', () => saveLayout(true));
  $('#lUp', el)?.addEventListener('click', () => $('#lUpIn', el).click());
  $('#lUpIn', el)?.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) readLayoutFile(f); });
  $('#toEst', el)?.addEventListener('click', sendTakeoff);
  wireProps();
}
function wireProps() {
  const P = $('#props', E.el);
  $$('[data-wp]', P).forEach((inp) => (inp.onchange = () => {
    const w = E.plan.walls.find((x) => x.id === E.sel.id); pushUndo();
    if (inp.dataset.wp === 'name') w.name = inp.value.trim() || w.name;
    else { const L = n(inp.value); if (L > 0) { const f = frame(w); const ox = w.x2, oy = w.y2; w.x2 = w.x1 + f.ux * L; w.y2 = w.y1 + f.uy * L; E.plan.walls.forEach((o) => { if (o !== w && Math.hypot(o.x1 - ox, o.y1 - oy) < 1) { const dx = w.x2 - ox, dy = w.y2 - oy; moveChain(o, dx, dy); } }); } }
    drawUI();
  }));
  $('#wFlip', P)?.addEventListener('click', () => { pushUndo(); const w = E.plan.walls.find((x) => x.id === E.sel.id); w.flip = !w.flip; drawUI(); });
  $('#wDel', P)?.addEventListener('click', () => { pushUndo(); E.plan.items = E.plan.items.filter((i) => i.wallId !== E.sel.id); E.plan.walls = E.plan.walls.filter((x) => x.id !== E.sel.id); E.sel = null; drawUI(); });
  $$('[data-ip]', P).forEach((inp) => (inp.onchange = () => {
    const it = E.plan.items.find((x) => x.id === E.sel.id); pushUndo();
    const k = inp.dataset.ip; it[k] = k === 'label' ? inp.value.trim() : (n(inp.value) ?? it[k]);
    drawUI();
  }));
  $('#iDel', P)?.addEventListener('click', delSel);
  $('#iDup', P)?.addEventListener('click', () => { const it = E.plan.items.find((x) => x.id === E.sel.id); pushUndo(); const cp = { ...it, id: uid() }; if (cp.wallId) cp.off = it.off + it.w; else { cp.x += 12; cp.y += 12; } E.plan.items.push(cp); E.sel = { type: 'item', id: cp.id }; drawUI(); });
  $('#iRot', P)?.addEventListener('click', () => { const it = E.plan.items.find((x) => x.id === E.sel.id); pushUndo(); it.rot = ((it.rot || 0) + 90) % 360; drawUI(); });
}
function confirmReplace() { try { return window.confirm('Replace the current walls and items?'); } catch { return true; } }
function moveChain(w, dx, dy) { w.x1 += dx; w.y1 += dy; w.x2 += dx; w.y2 += dy; }
function delSel() { if (!E.sel || E.sel.type !== 'item') return; pushUndo(); E.plan.items = E.plan.items.filter((x) => x.id !== E.sel.id); E.sel = null; drawUI(); }
document.addEventListener('keydown', (e) => {
  if (!E || !document.body.contains(E.el)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { if (E.sel?.type === 'item') { e.preventDefault(); delSel(); } }
  if (e.key === 'Enter' && E.tool === 'wall' && E.wallPts.length > 1) finishWalls();
});

/* ───────── plan drawing ───────── */
function bounds() {
  const pts = [...E.plan.walls.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]]), ...E.plan.items.flatMap((it) => itemPoly(it, E.plan) || [])];
  if (!pts.length) return { x: -24, y: -24, w: 288, h: 216 };
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  const pad = 48;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let w = Math.max(x1 - x0, 240), h = Math.max(y1 - y0, 180);
  const ar = 1.6; if (w / h < ar) { const nw = h * ar; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / ar; y0 -= (nh - h) / 2; h = nh; }
  return { x: x0, y: y0, w, h };
}
function svgPt(svg, ev) {
  const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
  const m = svg.getScreenCTM().inverse(); const q = p.matrixTransform(m); return { x: q.x, y: q.y };
}
function drawPlan() {
  const cv = $('#cv', E.el);
  if (!E.vb) E.vb = bounds();
  const vb = E.vb;
  const k = vb.w / 800; // inches per css px approx
  const grid = [];
  for (let gx = Math.ceil(vb.x / 12) * 12; gx < vb.x + vb.w; gx += 12) grid.push(`<line x1="${gx}" y1="${vb.y}" x2="${gx}" y2="${vb.y + vb.h}" stroke="${gx % 60 === 0 ? '#DDD5C6' : '#EEE8DD'}" stroke-width="${k}"/>`);
  for (let gy = Math.ceil(vb.y / 12) * 12; gy < vb.y + vb.h; gy += 12) grid.push(`<line x1="${vb.x}" y1="${gy}" x2="${vb.x + vb.w}" y2="${gy}" stroke="${gy % 60 === 0 ? '#DDD5C6' : '#EEE8DD'}" stroke-width="${k}"/>`);
  const fs = Math.max(4, 11 * k);
  const walls = E.plan.walls.map((w) => {
    const f = frame(w); const mx = (w.x1 + w.x2) / 2 - f.nx * (fs * 1.6), my = (w.y1 + w.y2) / 2 - f.ny * (fs * 1.6);
    const sel = E.sel?.type === 'wall' && E.sel.id === w.id;
    return `<line data-wall="${w.id}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${sel ? '#C0392B' : '#1B2620'}" stroke-width="${5}" stroke-linecap="square"/>
      <line data-wall="${w.id}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="transparent" stroke-width="${Math.max(14, 20 * k)}"/>
      <text x="${mx}" y="${my}" font-size="${fs}" text-anchor="${Math.abs(f.nx) > Math.abs(f.ny) ? (f.nx < 0 ? 'start' : 'end') : 'middle'}" dominant-baseline="middle" fill="#1B2620" font-family="Inter,Arial" font-weight="700">${esc(w.name)} · ${r2(len(w))}"</text>`;
  }).join('');
  const handles = E.tool === 'select' ? E.plan.walls.map((w) => `<circle data-end="${w.id}:2" cx="${w.x2}" cy="${w.y2}" r="${Math.max(3, 6 * k)}" fill="#CBA070" stroke="#1B2620" stroke-width="${k}"/>${E.plan.walls.some((o) => Math.hypot(o.x2 - w.x1, o.y2 - w.y1) < 1) ? '' : `<circle data-end="${w.id}:1" cx="${w.x1}" cy="${w.y1}" r="${Math.max(3, 6 * k)}" fill="#CBA070" stroke="#1B2620" stroke-width="${k}"/>`}`).join('') : '';
  const order = { opening: 0, base: 1, appliance: 1, island: 1, tall: 2, upper: 3 };
  const items = [...E.plan.items].sort((a, b) => (order[a.cat] || 0) - (order[b.cat] || 0)).map((it) => {
    const p = itemPoly(it, E.plan); if (!p) return '';
    const ty = TYPES[it.cat] || TYPES.base;
    const sel = E.sel?.type === 'item' && E.sel.id === it.id;
    const cx = p.reduce((a, q) => a + q[0], 0) / 4, cy = p.reduce((a, q) => a + q[1], 0) / 4;
    const dash = it.cat === 'upper' ? `stroke-dasharray="${4 * k} ${3 * k}"` : '';
    const txt = it.cat === 'opening' ? '' : `<text x="${cx}" y="${cy}" font-size="${Math.min(fs, it.w / 3.2)}" text-anchor="middle" dominant-baseline="middle" fill="#1B2620" font-family="Inter,Arial" pointer-events="none">${esc((it.sub === 'sink' ? 'SB' : it.sub ? SUBS[it.sub].label.split(' ')[0] : it.cat === 'upper' ? 'W' : it.cat === 'tall' ? 'T' : it.cat === 'island' ? 'Island' : 'B') + it.w)}</text>`;
    return `<polygon data-item="${it.id}" points="${p.map((q) => q.join(',')).join(' ')}" fill="${it.sub === 'sink' ? '#D9E8F0' : ty.fill}" stroke="${sel ? '#C0392B' : ty.stroke}" stroke-width="${sel ? 2.5 * k + 1 : 1.2 * k + 0.4}" ${dash}/>${txt}`;
  }).join('');
  const temp = E.wallPts.length ? `<polyline points="${E.wallPts.map((p) => p.join(',')).join(' ')}${E.hover ? ' ' + E.hover.join(',') : ''}" fill="none" stroke="#AE6741" stroke-width="4" stroke-dasharray="6 4"/>${E.hover && E.wallPts.length ? `<text x="${E.hover[0] + 6 * k}" y="${E.hover[1] - 6 * k}" font-size="${fs}" fill="#AE6741" font-family="Inter,Arial" font-weight="700">${r2(Math.hypot(E.hover[0] - E.wallPts.at(-1)[0], E.hover[1] - E.wallPts.at(-1)[1]))}"</text>` : ''}` : '';
  cv.innerHTML = `<svg id="planSvg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plan view">
    <rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#FFFDF9"/>${grid.join('')}${items}${walls}${handles}${temp}
    <text x="${vb.x + 8 * k}" y="${vb.y + vb.h - 8 * k}" font-size="${fs * 0.85}" fill="#8A938C" font-family="Inter,Arial">Grid: 1 ft squares · dashed = wall cabinets</text></svg>`;
  wirePlan($('#planSvg', cv));
}

function wirePlan(svg) {
  if (!canWrite()) return;
  let drag = null;
  svg.onpointerdown = (ev) => {
    const p = svgPt(svg, ev);
    const tg = ev.target;
    if (E.tool === 'wall') {
      let x = snap(p.x), y = snap(p.y);
      const last = E.wallPts.at(-1);
      if (last) { const dx = x - last[0], dy = y - last[1]; if (Math.abs(dx) < Math.abs(dy) * 0.2) x = last[0]; else if (Math.abs(dy) < Math.abs(dx) * 0.2) y = last[1]; }
      const ends = E.plan.walls.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]]).concat(E.wallPts.slice(0, 1));
      const near = ends.find((q) => Math.hypot(q[0] - x, q[1] - y) < 8);
      if (near) [x, y] = near;
      if (E.wallPts.length && E.wallPts[0][0] === x && E.wallPts[0][1] === y && E.wallPts.length > 2) { E.wallPts.push([x, y]); finishWalls(); return; }
      E.wallPts.push([x, y]); drawPlan(); return;
    }
    if (E.tool === 'select') {
      if (tg.dataset.end) { const [id, which] = tg.dataset.end.split(':'); const w = E.plan.walls.find((x) => x.id === id); pushUndo(); drag = { type: 'end', w, which, ox: which === '2' ? w.x2 : w.x1, oy: which === '2' ? w.y2 : w.y1 }; svg.setPointerCapture(ev.pointerId); return; }
      if (tg.dataset.item) { const it = E.plan.items.find((x) => x.id === tg.dataset.item); E.sel = { type: 'item', id: it.id }; pushUndo(); drag = { type: 'item', it, sx: p.x, sy: p.y, ox: it.x, oy: it.y, off: it.off }; svg.setPointerCapture(ev.pointerId); refreshSide(); drawPlan(); return; }
      if (tg.dataset.wall) { E.sel = { type: 'wall', id: tg.dataset.wall }; refreshSide(); drawPlan(); return; }
      E.sel = null; refreshSide(); drawPlan(); return;
    }
    place(p);
  };
  svg.onpointermove = (ev) => {
    const p = svgPt(svg, ev);
    if (E.tool === 'wall' && E.wallPts.length) {
      let x = snap(p.x), y = snap(p.y); const last = E.wallPts.at(-1);
      const dx = x - last[0], dy = y - last[1]; if (Math.abs(dx) < Math.abs(dy) * 0.2) x = last[0]; else if (Math.abs(dy) < Math.abs(dx) * 0.2) y = last[1];
      E.hover = [x, y]; drawPlan(); return;
    }
    if (!drag) return;
    if (drag.type === 'item') {
      const it = drag.it;
      if (it.wallId) {
        const w = E.plan.walls.find((x) => x.id === it.wallId); const f = frame(w);
        const dt = (p.x - drag.sx) * f.ux + (p.y - drag.sy) * f.uy;
        it.off = Math.max(0, Math.min(f.L - it.w, snap(drag.off + dt, 1.5)));
      } else { it.x = snap(drag.ox + p.x - drag.sx, 1.5); it.y = snap(drag.oy + p.y - drag.sy, 1.5); }
      drawPlan();
    } else if (drag.type === 'end') {
      const x = snap(p.x), y = snap(p.y);
      E.plan.walls.forEach((w) => { if (Math.hypot(w.x1 - drag.ox, w.y1 - drag.oy) < 1) { w.x1 = x; w.y1 = y; } if (Math.hypot(w.x2 - drag.ox, w.y2 - drag.oy) < 1) { w.x2 = x; w.y2 = y; } });
      drag.ox = x; drag.oy = y; drawPlan();
    }
  };
  svg.onpointerup = () => { if (drag) { drag = null; drawUI(); } };
  svg.ondblclick = () => { if (E.tool === 'wall') finishWalls(); };
}
function refreshSide() { const P = $('#props', E.el); if (P) { P.innerHTML = propsHTML(); wireProps(); } }

function place(p) {
  const tool = E.tool;
  const near = E.plan.walls.map((w) => ({ w, ...segDist(p.x, p.y, w) })).sort((a, b) => a.d - b.d)[0];
  let it;
  if (tool === 'appliance') { const s = SUBS[E.sub]; it = { id: uid(), cat: 'appliance', sub: E.sub, w: s.w, d: s.d, h: s.h, z: s.z }; }
  else if (tool === 'opening') { const s = SUBS[E.opening]; it = { id: uid(), cat: 'opening', sub: E.opening, w: s.w, d: s.d, h: s.h, z: s.z }; }
  else if (tool === 'island') { it = { id: uid(), cat: 'island', sub: null, w: E.width || 84, d: 36, h: 34.5, z: 0 }; }
  else { const ty = TYPES[tool]; it = { id: uid(), cat: tool, sub: tool === 'base' && E.sinkBase ? 'sink' : null, w: E.width, d: ty.d, h: ty.h, z: ty.z }; }
  pushUndo();
  if (tool !== 'island' && near && near.d < 40) {
    const f = frame(near.w);
    it.wallId = near.w.id;
    it.off = Math.max(0, Math.min(f.L - it.w, snap(near.t - it.w / 2, 1.5)));
  } else { it.x = snap(p.x, 1.5); it.y = snap(p.y, 1.5); it.rot = 0; }
  E.plan.items.push(it);
  E.sel = { type: 'item', id: it.id };
  drawUI();
}

function finishWalls() {
  const pts = E.wallPts;
  if (pts.length < 2) { E.wallPts = []; drawPlan(); return; }
  pushUndo();
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 1) continue;
    E.plan.walls.push({ id: uid(), name: '', x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], flip: false });
  }
  nameWalls(E.plan); autoFlip(E.plan);
  E.wallPts = []; E.hover = null; E.tool = 'select'; E.vb = null;
  drawUI();
}

/* ───────── elevation ───────── */
function drawElev() {
  const cv = $('#cv', E.el);
  const w = E.plan.walls.find((x) => x.id === E.elevWall) || E.plan.walls[0];
  if (!w) { cv.innerHTML = '<div class="empty" style="margin:10px">Draw walls first.</div>'; return; }
  E.elevWall = w.id;
  const L = len(w), H = E.plan.ceiling || 96;
  const pad = 30, vbw = L + pad * 2, vbh = H + pad * 2.4;
  const fs = Math.max(5, vbw / 90);
  const items = E.plan.items.filter((it) => it.wallId === w.id).sort((a, b) => (a.z || 0) - (b.z || 0));
  const rects = items.map((it) => {
    const ty = TYPES[it.cat] || TYPES.base; const z = it.z ?? ty.z ?? 0;
    const x = it.off, y = H - z - it.h;
    const sel = E.sel?.type === 'item' && E.sel.id === it.id;
    const counter = (it.cat === 'base' || it.sub === 'dw') ? `<rect x="${x}" y="${H - 36}" width="${it.w}" height="1.5" fill="#9AA39C"/>` : '';
    const doors = it.cat === 'base' || it.cat === 'upper' || it.cat === 'tall' ? (it.w > 24 ? `<line x1="${x + it.w / 2}" y1="${y + 1.5}" x2="${x + it.w / 2}" y2="${y + it.h - 1.5}" stroke="${ty.stroke}" stroke-width=".5"/>` : '') : '';
    return `<rect data-item="${it.id}" x="${x}" y="${y}" width="${it.w}" height="${it.h}" fill="${it.sub === 'sink' ? '#D9E8F0' : ty.fill}" stroke="${sel ? '#C0392B' : ty.stroke}" stroke-width="${sel ? 1.6 : 0.8}"/>${doors}${counter}
      <text x="${x + it.w / 2}" y="${y + it.h / 2}" font-size="${Math.min(fs, it.w / 3)}" text-anchor="middle" dominant-baseline="middle" fill="#1B2620" font-family="Inter,Arial" pointer-events="none">${esc(it.label || (it.sub ? SUBS[it.sub].label.split(' ')[0] : '') || '')}</text>
      <text x="${x + it.w / 2}" y="${H + fs * 1.6}" font-size="${fs * 0.8}" text-anchor="middle" fill="#5D6A61" font-family="Inter,Arial">${r2(it.w)}</text>`;
  }).join('');
  cv.innerHTML = `<svg id="elevSvg" viewBox="${-pad} ${-pad} ${vbw} ${vbh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Wall ${esc(w.name)} elevation">
    <rect x="${-pad}" y="${-pad}" width="${vbw}" height="${vbh}" fill="#FFFDF9"/>
    <rect x="0" y="0" width="${L}" height="${H}" fill="#F4EFE6" stroke="#1B2620" stroke-width="1.2"/>
    <line x1="0" y1="${H}" x2="${L}" y2="${H}" stroke="#1B2620" stroke-width="2"/>
    ${rects}
    <line x1="0" y1="${H + fs * 3}" x2="${L}" y2="${H + fs * 3}" stroke="#1B2620" stroke-width=".6"/>
    <text x="${L / 2}" y="${H + fs * 4.4}" font-size="${fs}" text-anchor="middle" fill="#1B2620" font-family="Inter,Arial" font-weight="700">Wall ${esc(w.name)} · ${r2(L)}" · ceiling ${H}"</text>
  </svg>`;
  const svg = $('#elevSvg', cv);
  if (!canWrite()) return;
  let drag = null;
  svg.onpointerdown = (ev) => {
    const tg = ev.target; const p = svgPt(svg, ev);
    if (tg.dataset.item) { const it = E.plan.items.find((x) => x.id === tg.dataset.item); E.sel = { type: 'item', id: it.id }; pushUndo(); drag = { it, sx: p.x, off: it.off }; svg.setPointerCapture(ev.pointerId); refreshSide(); drawElev(); }
    else { E.sel = null; refreshSide(); drawElev(); }
  };
  svg.onpointermove = (ev) => { if (!drag) return; const p = svgPt(svg, ev); drag.it.off = Math.max(0, Math.min(L - drag.it.w, snap(drag.off + p.x - drag.sx, 1.5))); drawElev(); };
  svg.onpointerup = () => { if (drag) { drag = null; drawUI(); } };
}

/* ───────── upload a layout (customer sketch, J&K / 2020 PDF) → draw it ───────── */
const LAYOUT_SYSTEM = `You read kitchen/bath cabinet layouts (J&K or 2020 Design PDFs, hand sketches, photos of drawings) for Twin Cities Remodeling Supply.
Return ONE JSON object only. Never invent dimensions: if a length is not printed or clearly derivable, leave it null and add a warning.
Walls: list the walls that carry cabinets or appliances in order around the room, each turning 90 degrees clockwise from the previous one (an L = 2 walls, a U = 3). Lengths in inches.
Items: every cabinet, appliance, window and door on each wall, in order from the wall's start (left end when facing that wall from inside the room). Use the J&K/2020 code when printed (e.g. B30, SB36, W3042, DB18, BBC42, REF36, DW24). off = inches from the wall start to the item's left edge if derivable, else null (items are then placed end to end). Wall cabinets: cat "wall" and h = height from the code (W3042 → 42). Islands: cat "island" with w = length.
Shape: {"ceiling":96,"walls":[{"name":"A","length_in":162}],"items":[{"wall":"A","cat":"base|wall|tall|appliance|opening|island","sub":"sink|range|fridge|dw|micro|hood|window|door|null","code":"B30","w":30,"h":null,"off":null}],"notes":"","warnings":[]}`;

async function readLayoutFile(file) {
  const { c } = E;
  const { toBase64, shrinkImage } = await import('./drop.js');
  const box = modalBox('<h2>Reading the layout…</h2>', '<div class="thinking"><span class="spin"></span>Claude is reading ' + esc(file.name) + '. Large PDFs take up to a minute.</div>');
  try {
    // keep the original file on the customer
    const path = `${c.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    await D.upload(file, path);
    const v = Math.max(0, ...S.files.filter((f) => f.customer_id === c.id && f.ftype === 'Layout').map((f) => f.version)) + 1;
    await D.insert('files', { customer_id: c.id, path, name: file.name, ftype: 'Layout', version: v, size: file.size, mime: file.type || null, by: S.me?.id });
    const content = [{ type: 'text', text: `Customer: ${c.name || ''}. Read this layout. File: ${file.name}` }];
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > 20 * 1024 * 1024) throw new Error('That PDF is over 20 MB. Export just the plan/elevation pages.');
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(file) } });
    } else {
      const img = await shrinkImage(file, 2000);
      if (!img) throw new Error('That image could not be read.');
      content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
    }
    const txt = await D.ai({ system: LAYOUT_SYSTEM, content, model: 'complex', max_tokens: 6000 });
    const a = txt.indexOf('{'), z = txt.lastIndexOf('}');
    const spec = JSON.parse(txt.slice(a, z + 1));
    const walls = (spec.walls || []).filter((w) => n(w.length_in) > 0);
    if (!walls.length) throw new Error('Claude could not find wall lengths in that file. ' + ((spec.warnings || []).join(' ') || ''));
    const byWall = {};
    (spec.items || []).forEach((i) => { (byWall[i.wall] = byWall[i.wall] || []).push(i.code || i.sub || i.cat); });
    box.querySelector('.sheet-h h2').textContent = 'Check the layout';
    box.querySelector('.sheet-b').innerHTML = `
      ${(spec.warnings || []).length ? `<div class="check-sec" style="border-color:var(--amber)"><b>⚠ Heads up</b>${spec.warnings.map((w) => `<div class="small">${esc(w)}</div>`).join('')}</div>` : ''}
      <div class="check-sec"><b>Ceiling</b> ${esc(spec.ceiling ?? '?')}"
      ${walls.map((w) => `<div class="crow"><b style="width:70px">Wall ${esc(w.name)}</b><span>${esc(w.length_in)}"</span><span class="small muted grow">${esc((byWall[w.name] || []).join(' · ') || 'no items')}</span></div>`).join('')}
      ${(spec.items || []).filter((i) => i.cat === 'island').length ? '<div class="small">Island included (placed in the middle; drag it into position).</div>' : ''}
      ${spec.notes ? `<div class="small muted">${esc(spec.notes)}</div>` : ''}</div>
      <label class="small row"><input type="checkbox" id="luRev"> Count this as a layout revision (customer asked for changes)</label>
      <div class="row"><button class="btn primary" type="button" id="luGo">Draw it as a new layout version</button><button class="btn" type="button" id="luNo">Cancel</button></div>
      <p class="small muted">The original file is saved under Files as Layout v${v}. Everything stays editable after drawing.</p>`;
    box.querySelector('#luNo').onclick = () => box.remove();
    box.querySelector('#luGo').onclick = async () => {
      const plan = planFromSpec({ ...spec, walls });
      const prev = custLayouts(c.id)[0];
      const ver = (prev?.version || 0) + 1;
      const asRev = box.querySelector('#luRev').checked && !!prev;
      const row = await D.insert('layouts', { customer_id: c.id, name: prev?.name || 'Kitchen', version: ver, plan, takeoff: takeoff(plan), is_revision: asRev, by: S.me?.id });
      S.layouts.push(row);
      await logEvent(c.id, 'system', `Layout v${ver} drawn from ${file.name}`);
      if (asRev) await bumpRevision(c, +1, `Layout v${ver} from ${file.name}`);
      box.remove();
      E = null; // reload editor on the new version
      renderLayout(document.querySelector('#tabBody') || E?.el, c);
      toast(`Layout v${ver} drawn. Check wall lengths and positions.`);
    };
  } catch (err) {
    box.querySelector('.sheet-h h2').textContent = 'Could not draw that layout';
    box.querySelector('.sheet-b').innerHTML = `<p>${esc(err.message)}</p><p class="small muted">The file is still saved under Files. You can type the wall lengths into Quick walls instead.</p><div class="row"><button class="btn" type="button" id="luX">Close</button></div>`;
    box.querySelector('#luX').onclick = () => box.remove();
  }
}
function modalBox(head, body) {
  const b = document.createElement('div');
  b.className = 'sheet-bg top-modal'; b.style.zIndex = 60;
  b.innerHTML = `<div class="sheet narrow"><div class="sheet-h">${head}<button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-b">${body}</div></div>`;
  b.querySelector('.x').onclick = () => b.remove();
  document.body.appendChild(b);
  return b;
}

/* ───────── save / export ───────── */
async function saveLayout(asRevision) {
  const { c } = E;
  const list = custLayouts(c.id);
  const t = takeoff(E.plan);
  try {
    if (!asRevision && E.layoutId) {
      await D.update('layouts', E.layoutId, { plan: E.plan, takeoff: t });
      toast('Layout saved.');
    } else {
      const v = (list[0]?.version || 0) + 1;
      const row = await D.insert('layouts', { customer_id: c.id, name: list[0]?.name || 'Kitchen', version: v, plan: E.plan, takeoff: t, is_revision: !!asRevision && list.length > 0, by: S.me?.id });
      S.layouts.push(row);
      E.layoutId = row.id;
      await logEvent(c.id, 'system', `Layout v${v} saved${asRevision && list.length ? ' as a revision' : ''}`);
      if (asRevision && list.length) await bumpRevision(c, +1, `Layout v${v}`);
      else toast(`Layout v${v} saved.`);
    }
    E.dirty = false; E.undo = [];
    drawUI();
  } catch (e) { toast('Not saved: ' + e.message); }
}

async function sendTakeoff() {
  const { c } = E;
  const t = takeoff(E.plan);
  const rows = [['Base cabinets', t.baseLf, 'lf'], ['Wall cabinets', t.upperLf, 'lf'], ['Cabinet boxes', t.boxes + t.islandBoxes, 'ea'], ['Countertop (layout)', t.topsSf, 'sf'], ['4" backsplash (layout)', t.splashSf, 'sf']];
  if (t.floorSf != null) rows.push(['Floor (layout)', t.floorSf, 'sf']);
  E.plan.walls.forEach((w) => rows.push([`Wall ${w.name}`, r2(len(w)), 'in']));
  for (const [what, value, unit] of rows) {
    if (!value) continue;
    const ex = custSizes(c.id).find((s) => s.what === what && s.source === 'grid');
    if (ex) await D.update('sizes', ex.id, { value, unit }); else await D.insert('sizes', { customer_id: c.id, what, value, unit, source: 'grid' });
  }
  const q = await ensureQuote(c);
  const has = (desc) => (q.sections || []).some((s) => s.options.some((o) => o.lines.some((l) => l.desc === desc)));
  const lines = [];
  if ((c.products || []).includes('Cabinets') && (t.boxes + t.islandBoxes) && !has('Cabinet installation')) lines.push({ product: 'Cabinets', kind: 'install', deal: 'resell', desc: 'Cabinet installation', qty: t.boxes + t.islandBoxes, unit: 'box', cost: null, note: 'From layout takeoff' });
  if ((c.products || []).includes('Countertops') && t.topsSf && !has('Countertop incl. 4" backsplash')) lines.push({ product: 'Countertops', kind: 'material', deal: 'resell', desc: 'Countertop incl. 4" backsplash', qty: r2(t.topsSf + t.splashSf), unit: 'sf', cost: null, note: `From layout: tops ${t.topsSf} sf + splash ${t.splashSf} sf` });
  if ((c.products || []).includes('Flooring') && t.floorSf && !has('Flooring')) lines.push({ product: 'Flooring', kind: 'material', deal: 'resell', desc: 'Flooring', qty: t.floorSf, unit: 'sf', cost: null, note: 'From layout floor area; add waste on the line' });
  if (lines.length) await addLinesToQuote(c, lines);
  toast(`Sizes saved${lines.length ? ` and ${lines.length} estimate line${lines.length > 1 ? 's' : ''} added (costs blank)` : ''}.`);
}

async function exportPng() {
  const svg = $('#cv svg', E.el); if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const vb = svg.viewBox.baseVal; const W = 1600, H = Math.round(W * vb.height / vb.width);
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, 0, 0, W, H);
    cv.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(E.c.name || 'layout').replace(/[^\w ]+/g, '')} ${E.view === 'plan' ? 'plan' : 'wall'} ${todayISO()}.png`; document.body.appendChild(a); a.click(); a.remove(); });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}
