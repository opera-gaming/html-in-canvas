// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// One Jacobi contact-relaxation iteration: poseIn → poseOut. Each awake body gathers SAT corrections from the bodies
// sharing its grid cells and applies their (averaged) sum to itself. Corrections are position-only and capped per
// iteration, so overlaps resolve as a push, never a fling.
// Exactly 8 storage buffers (the default per-stage limit), so the early-out uses flags, not counters[0].
@group(0) @binding(1) var<storage, read> poseIn: array<Pose>;
@group(0) @binding(2) var<storage, read_write> poseOut: array<Pose>;
@group(0) @binding(3) var<storage, read> shape: array<Shape>;
@group(0) @binding(4) var<storage, read_write> props: array<Props>;
@group(0) @binding(5) var<storage, read_write> wake: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> cellData: array<u32>; // [cellStart: cells + 1][cellItems]
@group(0) @binding(7) var<storage, read> cellRange: array<u32>;
@group(0) @binding(8) var<storage, read> occF: array<f32>;

fn occAt(p: vec2f) -> f32 {
  let b = bilin(p);
  return dot(b.w, vec4f(occF[b.i.x], occF[b.i.y], occF[b.i.z], occF[b.i.w]));
}

// Per-iteration rotation limit (rad); keeps thin bodies from spinning up on deep overlaps.
const MAX_DANG: f32 = 0.2;

@compute @workgroup_size(WG) fn contacts(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= su.bodyCap) { return; }
  let flagsI = props[i].flags;
  if ((flagsI & FLAG_ACTIVE) == 0u) { return; }
  let pi = poseIn[i];
  if ((flagsI & FLAG_ASLEEP) != 0u) { poseOut[i] = pi; return; }

  let si = shape[i];
  let va = worldVerts(pi, si);
  let ri = props[i].radius;
  let wi = props[i].invMass;
  let invIi = props[i].invInertia;
  let sizeI = minSide(si);
  let base = su.gridDim.x * su.gridDim.y + 1u;
  let cap = arrayLength(&cellData) - base;
  // Soft overlap: dense regions (piles) allow more penetration, so bodies ride over one another and stack.
  let slopK = min(tSlopMax(), tSlopBase() + tSlopDensity() * max(0.0, occAt(pi.pos) - 1.0));
  let rngI = unpackRange(cellRange[i]);

  var corr = vec2f(0.0);
  var dAng = 0.0;
  var sumMag = 0.0;
  var n = 0.0;
  var thinnest = sizeI;
  for (var cy = rngI.y; cy <= rngI.w; cy++) {
    for (var cx = rngI.x; cx <= rngI.z; cx++) {
      let c = cy * su.gridDim.x + cx;
      let start = min(cellData[c], cap);
      let end = min(cellData[c + 1u], cap);
      for (var k = start; k < end; k++) {
        let j = cellData[base + k];
        if (j == i) { continue; }
        // Dedup: handle the pair only in the first cell (top-left) of the two cell ranges' overlap.
        let rngJ = unpackRange(cellRange[j]);
        if (max(rngI.x, rngJ.x) != cx || max(rngI.y, rngJ.y) != cy) { continue; }
        let pj = poseIn[j];
        let d = pi.pos - pj.pos;
        let rr = ri + props[j].radius;
        if (dot(d, d) >= rr * rr) { continue; }
        let sj = shape[j];
        let ct = sat(va, worldVerts(pj, sj));
        if (!ct.hit) { continue; }
        let slop = slopK * min(sizeI, minSide(sj));
        if (ct.depth <= slop) { continue; }
        let asleepJ = (props[j].flags & FLAG_ASLEEP) != 0u;
        let wj = props[j].invMass * select(1.0, 0.25, asleepJ);
        let pen = ct.depth - slop;
        thinnest = min(thinnest, minSide(sj));
        let cc = ct.normal * pen * wi / (wi + wj);
        corr += cc;
        sumMag += length(cc);
        // Angular part uses the generalised inverse mass (rotational terms of both bodies in the denominator),
        // so long lever arms on big objects don't over-rotate them.
        let r = ct.point - pi.pos;
        let rj = ct.point - pj.pos;
        let rnI = r.x * ct.normal.y - r.y * ct.normal.x;
        let rnJ = rj.x * ct.normal.y - rj.y * ct.normal.x;
        let invIj = props[j].invInertia * select(1.0, 0.25, asleepJ);
        let wGen = wi + wj + rnI * rnI * invIi + rnJ * rnJ * invIj;
        dAng += rnI * pen * invIi / wGen * tAngularScale();
        n += 1.0;
        if (asleepJ && pen > tWakeDepth()) { atomicStore(&wake[j], 1u); }
      }
    }
  }

  var out = pi;
  if (n > 0.0) {
    let scale = tRelax() / max(1.0, n * 0.5);
    // Per-iteration cap: contactStep px, and at most contactFrac of the thinnest body in contact, so a deep overlap
    // unwinds over several steps instead of popping apart.
    out.pos = pi.pos + capLen(corr * scale, min(tContactStep(), tContactFrac() * thinnest));
    out.angle = pi.angle + clamp(dAng * scale, -MAX_DANG, MAX_DANG);
    out.pos = clampWalls(out, si);
    props[i].stress += sumMag - length(corr);
  }
  poseOut[i] = out;
}
