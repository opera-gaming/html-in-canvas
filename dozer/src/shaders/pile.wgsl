// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Piling: resolveOcc turns the per-cell area sums into a blurred, normalised occupancy field (occF);
// spread nudges awake bodies in over-full cells down the occupancy gradient so heaps slump sideways.
@group(0) @binding(1) var<storage, read_write> occupancy: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> occF: array<f32>;
@group(0) @binding(3) var<storage, read_write> pose: array<Pose>;
@group(0) @binding(4) var<storage, read_write> props: array<Props>;
@group(0) @binding(5) var<storage, read> shape: array<Shape>;

fn occAt(p: vec2f) -> f32 {
  let b = bilin(p);
  return dot(b.w, vec4f(occF[b.i.x], occF[b.i.y], occF[b.i.z], occF[b.i.w]));
}

// Per cell: occF = 3×3 box blur of (occupancy / 16 / cellSize²). Out-of-page neighbours are skipped (the mean is
// over in-page cells), so the walls don't read as empty space that piles must spread into.
@compute @workgroup_size(WG) fn resolveOcc(@builtin(global_invocation_id) g: vec3u) {
  let dim = vec2i(su.gridDim);
  if (g.x >= su.gridDim.x * su.gridDim.y) { return; }
  let c = vec2i(i32(g.x % su.gridDim.x), i32(g.x / su.gridDim.x));
  var sum = 0.0;
  var n = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = c + vec2i(dx, dy);
      if (any(q < vec2i(0)) || any(q >= dim)) { continue; }
      sum += f32(atomicLoad(&occupancy[q.y * dim.x + q.x]));
      n += 1.0;
    }
  }
  occF[g.x] = sum / max(n, 1.0) / (16.0 * su.cellSize * su.cellSize);
}

// After the contact iterations, before dozerPost (in place on the final pose buffer). Awake bodies only.
@compute @workgroup_size(WG) fn spread(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= su.bodyCap) { return; }
  var pr = props[i];
  if (!isAwake(pr.flags)) { return; }
  var p = pose[i];
  let occ = occAt(p.pos);
  if (occ <= tPileLimit()) { return; }
  // Central differences of the bilinear field, one cell apart.
  let h = su.cellSize;
  let grad = vec2f(occAt(p.pos + vec2f(h, 0.0)) - occAt(p.pos - vec2f(h, 0.0)),
                   occAt(p.pos + vec2f(0.0, h)) - occAt(p.pos - vec2f(0.0, h))) / (2.0 * h);
  let gl = length(grad);
  if (!(gl > 1e-5)) { return; } // flat top (or NaN): no downhill direction
  // Position-only, capped like a contact correction (contactStep px per step).
  let step = min(tSpreadK() * (occ - tPileLimit()) * su.dt, tContactStep());
  let before = p.pos;
  p.pos -= grad / gl * step;
  p.pos = clampWalls(p, shape[i]);
  pose[i] = p;
  // "Wake" on noticeable motion: the body is already awake, so this keeps it from falling asleep mid-slump.
  if (length(p.pos - before) > tWakeDepth()) {
    pr.sleepTimer = 0.0;
    props[i] = pr;
  }
}
