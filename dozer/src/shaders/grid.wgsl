// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Uniform grid build: clearGrid → countCells (+ accumOcc) → scanCells → scatter. Each entry point binds only what
// it uses. cellData = [cellStart: cells + 1][cellItems: itemCap] (one buffer, see buffers.ts).
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>, 8>;
@group(0) @binding(2) var<storage, read_write> cellCount: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellData: array<u32>;
@group(0) @binding(4) var<storage, read_write> cellCursor: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> occupancy: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> cellRange: array<u32>;
@group(0) @binding(7) var<storage, read> pose: array<Pose>;
@group(0) @binding(8) var<storage, read> shape: array<Shape>;
@group(0) @binding(9) var<storage, read> props: array<Props>;

fn cellCountTotal() -> u32 { return su.gridDim.x * su.gridDim.y; }

// Dispatched over cells. Workgroup 0 also resets the per-frame counters.
@compute @workgroup_size(WG) fn clearGrid(@builtin(global_invocation_id) g: vec3u) {
  if (g.x == 0u) {
    atomicStore(&counters[1], 0u);
    atomicStore(&counters[2], 0u);
    atomicStore(&counters[3], 0u);
  }
  if (g.x < cellCountTotal()) {
    atomicStore(&cellCount[g.x], 0u);
    atomicStore(&occupancy[g.x], 0u); // clearOcc
  }
}

// Polygon area of the (local) quad, shoelace.
fn shapeArea(s: Shape) -> f32 {
  var a = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let p = s.v[k];
    let q = s.v[(k + 1u) % 4u];
    a += p.x * q.y - q.x * p.y;
  }
  return abs(a) * 0.5;
}

// Load balancing (countCells, scatter): rather than each thread looping over its own body's cells (the biggest image
// covers ~1,000 cells and would set the pass time), each workgroup scans its bodies' cell counts and its 256 threads
// share the flattened (body, cell) items. scatter shares only bodies over SCATTER_SHARED_CELLS cells and inserts the
// rest one thread per body: the order of items within a cell affects the contacts pass's speed, which is much slower
// with every body's items interleaved.
var<workgroup> wgEnd: array<u32, WG>;    // inclusive scan of the workgroup's per-body cell counts
var<workgroup> wgRange: array<u32, WG>;  // packed cell range (cellRangeOf) per body
var<workgroup> wgLo: array<vec2f, WG>;   // countCells: world AABB and area-per-AABB-area per body
var<workgroup> wgHi: array<vec2f, WG>;
var<workgroup> wgApa: array<f32, WG>;

// scatter: bodies over this many cells are inserted by the whole workgroup, the rest by their own thread.
const SCATTER_SHARED_CELLS: u32 = 32u;

fn rangeCells(r: u32) -> u32 {
  let c = unpackRange(r);
  return (c.z - c.x + 1u) * (c.w - c.y + 1u);
}

// wgEnd[t] = n for every thread, then an inclusive Hillis-Steele scan over the workgroup. Returns the item total.
fn scanWorkgroup(t: u32, n: u32) -> u32 {
  wgEnd[t] = n;
  workgroupBarrier();
  for (var off = 1u; off < WG; off <<= 1u) {
    var v = 0u;
    if (t >= off) { v = wgEnd[t - off]; }
    workgroupBarrier();
    wgEnd[t] += v;
    workgroupBarrier();
  }
  return wgEnd[WG - 1u];
}

// Flattened item `idx` → (local body b, cell index within its range): b = first body whose inclusive end > idx.
fn itemBody(idx: u32) -> u32 {
  var lo = 0u;
  var hi = WG - 1u;
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    if (wgEnd[mid] > idx) { hi = mid; } else { lo = mid + 1u; }
  }
  return lo;
}

// Cell (x, y) of item `k` of a body with packed range r (row-major over the range).
fn itemCell(r: u32, k: u32) -> vec2u {
  let c = unpackRange(r);
  let w = c.z - c.x + 1u;
  return vec2u(c.x + k % w, c.y + k / w);
}

@compute @workgroup_size(WG)
fn countCells(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) t: u32) {
  let i = g.x;
  var n = 0u;
  if (i < su.bodyCap && i < atomicLoad(&counters[0]) && (props[i].flags & FLAG_ACTIVE) != 0u) {
    let s = shape[i];
    let v = worldVerts(pose[i], s);
    let r = cellRangeOf(v);
    cellRange[i] = r;
    // accumOcc: the body's area × 16 is splatted over the cells its AABB covers, weighted by AABB-cell overlap
    // (splatting into the centre cell alone makes big resting headlines read as piles).
    var lo = v[0];
    var hi = v[0];
    for (var k = 1u; k < 4u; k++) { lo = min(lo, v[k]); hi = max(hi, v[k]); }
    let ext = max(hi - lo, vec2f(1e-3));
    // Non-finite pose or shape (before finalize's NaN guard runs) splats nothing rather than corrupting a cell.
    let apa = shapeArea(s) * 16.0 / (ext.x * ext.y);
    let ok = finiteF(apa) && finiteF(lo.x) && finiteF(lo.y) && finiteF(hi.x) && finiteF(hi.y);
    wgLo[t] = lo;
    wgHi[t] = hi;
    wgApa[t] = select(0.0, apa, ok);
    wgRange[t] = r;
    n = rangeCells(r);
  }
  let total = scanWorkgroup(t, n);
  for (var idx = t; idx < total; idx += WG) {
    let b = itemBody(idx);
    let k = idx - select(0u, wgEnd[max(b, 1u) - 1u], b > 0u);
    let xy = itemCell(wgRange[b], k);
    let cell = xy.y * su.gridDim.x + xy.x;
    atomicAdd(&cellCount[cell], 1u);
    let c0 = vec2f(xy) * su.cellSize;
    let ov = max(min(wgHi[b], c0 + su.cellSize) - max(wgLo[b], c0), vec2f(0.0));
    let a = u32(clamp(round(ov.x * ov.y * wgApa[b]), 0.0, 1.0e6));
    if (a > 0u) { atomicAdd(&occupancy[cell], a); }
  }
}

var<workgroup> partial: array<u32, WG>;

// One workgroup: exclusive prefix sum of cellCount into cellStart (and the cellCursor seeds).
@compute @workgroup_size(WG) fn scanCells(@builtin(local_invocation_index) t: u32) {
  let cells = cellCountTotal();
  let chunk = (cells + WG - 1u) / WG;
  let begin = min(t * chunk, cells);
  let end = min(begin + chunk, cells);
  var sum = 0u;
  for (var c = begin; c < end; c++) { sum += atomicLoad(&cellCount[c]); }
  partial[t] = sum;
  workgroupBarrier();
  // Hillis-Steele inclusive scan over the 256 chunk sums.
  for (var off = 1u; off < WG; off <<= 1u) {
    var v = 0u;
    if (t >= off) { v = partial[t - off]; }
    workgroupBarrier();
    partial[t] += v;
    workgroupBarrier();
  }
  var run = partial[t] - sum;
  for (var c = begin; c < end; c++) {
    cellData[c] = run;
    atomicStore(&cellCursor[c], run);
    run += atomicLoad(&cellCount[c]);
  }
  if (t == WG - 1u) { cellData[cells] = partial[t]; }
}

@compute @workgroup_size(WG)
fn scatter(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) t: u32) {
  let i = g.x;
  var n = 0u;
  let base = cellCountTotal() + 1u;
  let cap = arrayLength(&cellData) - base;
  if (i < su.bodyCap && i < atomicLoad(&counters[0]) && (props[i].flags & FLAG_ACTIVE) != 0u) {
    let r = cellRange[i];
    if (rangeCells(r) > SCATTER_SHARED_CELLS) {
      wgRange[t] = r;
      n = rangeCells(r);
    } else {
      let c = unpackRange(r);
      for (var y = c.y; y <= c.w; y++) {
        for (var x = c.x; x <= c.z; x++) {
          let slot = atomicAdd(&cellCursor[y * su.gridDim.x + x], 1u);
          if (slot < cap) { cellData[base + slot] = i; } else { atomicAdd(&counters[1], 1u); }
        }
      }
    }
  }
  let total = scanWorkgroup(t, n);
  let first = g.x - t; // body index of local thread 0
  for (var idx = t; idx < total; idx += WG) {
    let b = itemBody(idx);
    let k = idx - select(0u, wgEnd[max(b, 1u) - 1u], b > 0u);
    let xy = itemCell(wgRange[b], k);
    let slot = atomicAdd(&cellCursor[xy.y * su.gridDim.x + xy.x], 1u);
    if (slot < cap) { cellData[base + slot] = first + b; } else { atomicAdd(&counters[1], 1u); }
  }
}
