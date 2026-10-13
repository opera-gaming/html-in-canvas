// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Shared by every simulation compute module (prepended after common.wgsl). Binding 0 = SimU.
@group(0) @binding(0) var<uniform> su: SimU;

// TUNING (sim.ts) packed as
//   tuning[0] = (linDamp, angDamp, relax, slopBase)
//   tuning[1] = (sleepSpeed, sleepTime, wakeDepth, pushBudgetK)
//   tuning[2] = (pushMargin, maxSpeed, angularScale, maxAngVel)
//   tuning[3] = (slopDensity, slopMax, pileLimit, spreadK)
//   tuning[4] = (heightSmooth, stressWord, stressObject, fractureCooldown)
//   tuning[5] = (friction, contactStep, contactFrac, stressObjectSize)
//   tuning[6] = (scoopHeight, scoopRate, bladeStressObject, stressInherit)
//   tuning[7] = (fractureCooldownObject, stressObjectSizeExp, crackSize, -)
// su.dozerMisc = (dozer angular velocity rad/s, heading cos, heading sin, -).
fn tLinDamp() -> f32 { return su.tuning[0].x; }
fn tAngDamp() -> f32 { return su.tuning[0].y; }
fn tRelax() -> f32 { return su.tuning[0].z; }
fn tSlopBase() -> f32 { return su.tuning[0].w; }
fn tSleepSpeed() -> f32 { return su.tuning[1].x; }
fn tSleepTime() -> f32 { return su.tuning[1].y; }
fn tWakeDepth() -> f32 { return su.tuning[1].z; }
fn tPushBudgetK() -> f32 { return su.tuning[1].w; }
fn tPushMargin() -> f32 { return su.tuning[2].x; }
fn tMaxSpeed() -> f32 { return su.tuning[2].y; }
fn tAngularScale() -> f32 { return su.tuning[2].z; }
fn tMaxAngVel() -> f32 { return su.tuning[2].w; }
fn tSlopDensity() -> f32 { return su.tuning[3].x; }
fn tSlopMax() -> f32 { return su.tuning[3].y; }
fn tPileLimit() -> f32 { return su.tuning[3].z; }
fn tSpreadK() -> f32 { return su.tuning[3].w; }
fn tHeightSmooth() -> f32 { return su.tuning[4].x; }
fn tStressWord() -> f32 { return su.tuning[4].y; }
fn tStressObject() -> f32 { return su.tuning[4].z; }
fn tFractureCooldown() -> f32 { return su.tuning[4].w; }
fn tFriction() -> f32 { return su.tuning[5].x; }
fn tContactStep() -> f32 { return su.tuning[5].y; }
fn tContactFrac() -> f32 { return su.tuning[5].z; }
fn tStressObjectSize() -> f32 { return su.tuning[5].w; }
fn tScoopHeight() -> f32 { return su.tuning[6].x; }
fn tScoopRate() -> f32 { return su.tuning[6].y; }
fn tBladeStressObject() -> f32 { return su.tuning[6].z; }
fn tStressInherit() -> f32 { return su.tuning[6].w; }
fn tFractureCooldownObject() -> f32 { return su.tuning[7].x; }
fn tStressObjectSizeExp() -> f32 { return su.tuning[7].y; }
fn tCrackSize() -> f32 { return su.tuning[7].z; }

fn quadOf(p: array<vec4f, 2>) -> array<vec2f, 4> {
  return array<vec2f, 4>(p[0].xy, p[0].zw, p[1].xy, p[1].zw);
}

// Push quad q (dozer.ts pushQuad: back-left, front-left, front-right, back-right; its front face is the push line):
// true when point c lies in front of the push line, within the quad's length, and behind the cutting-edge segment
// e0 → e1 (both run from the blade's left end to its right end, so their normals (e.y, −e.x) point forward).
fn inScoopOf(q: array<vec2f, 4>, e0: vec2f, e1: vec2f, c: vec2f) -> bool {
  let e = q[2] - q[1];
  let len = length(e);
  let u = e / len;
  let r = c - q[1];
  let a = dot(r, u);
  let ee = e1 - e0;
  let behindEdge = dot(c - e0, vec2f(ee.y, -ee.x)) <= 0.0;
  return dot(r, vec2f(u.y, -u.x)) >= 0.0 && a >= 0.0 && a <= len && behindEdge;
}

// Scoop zone: between the push line (the moldboard's yellow ridge) and the steel cutting edge, for the blade's main
// run and its lower run. Bodies whose centre is here ride up onto the blade (finalize raises their render height toward
// scoopHeight); they are not pushed.
fn inScoop(c: vec2f) -> bool {
  return inScoopOf(quadOf(su.blade), su.edge[0].xy, su.edge[0].zw, c)
      || inScoopOf(quadOf(su.wing), su.edge[0].zw, su.edge[1].xy, c);
}

// Dozer surface velocity at world point q: linear velocity + angular velocity × lever arm (2D cross: ω·perp(r)).
fn dozerVelAt(q: vec2f) -> vec2f {
  let r = q - su.dozerPos;
  return su.dozerVel + su.dozerMisc.x * vec2f(-r.y, r.x);
}

// dozerPre push-out budget (px) at world point q: pushBudgetK × the distance the dozer surface there moves this step,
// plus pushMargin (dozerPost uses pushMargin alone).
fn dozerBudgetAt(q: vec2f) -> f32 {
  return tPushBudgetK() * length(dozerVelAt(q)) * su.dt + tPushMargin();
}

// v scaled down to at most maxLen long.
fn capLen(v: vec2f, maxLen: f32) -> vec2f {
  let l = length(v);
  return select(v, v * (maxLen / l), l > maxLen && l > 0.0);
}

// Bilinear sample setup over per-cell values stored at cell centres: 4 cell indices (00, 10, 01, 11) + weights.
// Shaders that bind occF sample it as dot(b.w, vec4f(occF[b.i.x], occF[b.i.y], occF[b.i.z], occF[b.i.w])).
struct Bilin { i: vec4u, w: vec4f };
fn bilin(pos: vec2f) -> Bilin {
  let g = pos / su.cellSize - 0.5;
  let f0 = floor(g);
  let t = clamp(g - f0, vec2f(0.0), vec2f(1.0));
  let maxC = vec2i(su.gridDim) - 1;
  let c0 = clamp(vec2i(f0), vec2i(0), maxC);
  let c1 = clamp(vec2i(f0) + 1, vec2i(0), maxC);
  let w = i32(su.gridDim.x);
  let idx = vec4i(c0.y * w + c0.x, c0.y * w + c1.x, c1.y * w + c0.x, c1.y * w + c1.x);
  return Bilin(vec4u(idx), vec4f((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y));
}

const WG: u32 = 256u;

// Exponent-bit test: compilers may fold `x == x` away under fast-math assumptions.
fn finiteF(x: f32) -> bool { return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u; }

// Walls: returns p.pos shifted so every rotated vertex lies inside [0, pageSize]² (a bounding-circle clamp would
// teleport large objects away from the edge).
fn clampWalls(p: Pose, s: Shape) -> vec2f {
  let v = worldVerts(p, s);
  var lo = v[0];
  var hi = v[0];
  for (var k = 1u; k < 4u; k++) { lo = min(lo, v[k]); hi = max(hi, v[k]); }
  return p.pos + max(-lo, vec2f(0.0)) - max(hi - vec2f(su.pageSize), vec2f(0.0));
}

// Cell range of the AABB of v, packed x0 | y0<<8 | x1<<16 | y1<<24 (gridDim <= 255).
fn cellRangeOf(v: array<vec2f, 4>) -> u32 {
  var lo = v[0];
  var hi = v[0];
  for (var k = 1u; k < 4u; k++) { lo = min(lo, v[k]); hi = max(hi, v[k]); }
  let maxC = vec2i(su.gridDim) - 1;
  let c0 = clamp(vec2i(floor(lo / su.cellSize)), vec2i(0), maxC);
  let c1 = clamp(vec2i(floor(hi / su.cellSize)), vec2i(0), maxC);
  return u32(c0.x) | (u32(c0.y) << 8u) | (u32(c1.x) << 16u) | (u32(c1.y) << 24u);
}

fn unpackRange(r: u32) -> vec4u {
  return vec4u(r & 0xffu, (r >> 8u) & 0xffu, (r >> 16u) & 0xffu, r >> 24u);
}

// Shortest edge of the shape (the body's thickness).
fn minSide(s: Shape) -> f32 {
  return min(length(s.v[1] - s.v[0]), length(s.v[2] - s.v[1]));
}

fn hashU(x: u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}

fn isAwake(flags: u32) -> bool {
  return (flags & (FLAG_ACTIVE | FLAG_ASLEEP)) == FLAG_ACTIVE;
}
