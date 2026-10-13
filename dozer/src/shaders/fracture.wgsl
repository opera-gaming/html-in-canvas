// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Fracture, run after finalize on the final pose buffer:
//   fractureSnapshot (1 thread: counters[5] = counters[0]) → fracture (over the snapshot) → writeIndirect (1 thread).
// A body squeezed past its stress threshold splits into two convex quads; the larger half stays in its slot, the
// other goes into a slot allocated with atomicAdd on counters[0] (rejected at bodyCap). The snapshot keeps new
// slots from being processed (or read half-written) in the same pass. counters layout: buffers.ts (COUNTERS_U32);
// [5] is this internal snapshot.
// chooseCut / cutQuad / centroid / inertiaPerMass are line-for-line ports of geom.ts (constants mirrored, tested).
@group(0) @binding(1) var<storage, read_write> pose: array<Pose>;
@group(0) @binding(2) var<storage, read_write> motion: array<Motion>;
@group(0) @binding(3) var<storage, read_write> shape: array<Shape>;
@group(0) @binding(4) var<storage, read_write> props: array<Props>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 8>;
@group(0) @binding(6) var<storage, read_write> indirect: array<u32, 4>;

const BREAK_MIN_LONG_SIDE = 28.0;
const FRAG_MIN_ALONG = 10.0;
const FRAG_MIN_AREA = 80.0;
const LONG_WORD_ASPECT = 3.0;
const SQUARE_RATIO = 1.3;
// Separating speed (px/s) given to each half along the line between the two half centroids.
const SEPARATE_SPEED = 15.0;

// Shoelace area: sum(x_i*y_{i+1} - x_{i+1}*y_i) / 2.
fn signedArea4(v: array<vec2f, 4>) -> f32 {
  var s = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let a = v[i];
    let b = v[(i + 1u) % 4u];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2.0;
}

fn centroid4(v: array<vec2f, 4>) -> vec2f {
  var cx = 0.0;
  var cy = 0.0;
  var s = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let a = v[i];
    let b = v[(i + 1u) % 4u];
    let c = a.x * b.y - b.x * a.y;
    s += c;
    cx += (a.x + b.x) * c;
    cy += (a.y + b.y) * c;
  }
  let k = 1.0 / (3.0 * s); // = 1 / (6 * area)
  return vec2f(cx * k, cy * k);
}

// Polar second moment about `about`, divided by area (per unit mass).
fn inertiaPerMass4(v: array<vec2f, 4>, about: vec2f) -> f32 {
  var num = 0.0;
  var s = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let a = v[i] - about;
    let b = v[(i + 1u) % 4u] - about;
    let c = a.x * b.y - b.x * a.y;
    s += c;
    num += c * (a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y);
  }
  return num / (6.0 * s);
}

// Edge i = v[i] -> v[(i+1)%4].
fn edgeLengths(q: Shape) -> vec4f {
  return vec4f(length(q.v[1] - q.v[0]), length(q.v[2] - q.v[1]), length(q.v[3] - q.v[2]), length(q.v[0] - q.v[3]));
}

// Cut from P on edge `edge` (tA) to R on edge `edge+2` (tB). A = [P, v[e+1], v[e+2], R], B = [R, v[e+3], v[e], P].
fn cutQuad(q: Shape, edge: u32, tA: f32, tB: f32) -> array<Shape, 2> {
  let e = edge;
  let v0 = q.v[e % 4u];
  let v1 = q.v[(e + 1u) % 4u];
  let v2 = q.v[(e + 2u) % 4u];
  let v3 = q.v[(e + 3u) % 4u];
  let u0 = q.uv[e % 4u];
  let u1 = q.uv[(e + 1u) % 4u];
  let u2 = q.uv[(e + 2u) % 4u];
  let u3 = q.uv[(e + 3u) % 4u];
  let p = mix(v0, v1, tA);
  let pu = mix(u0, u1, tA);
  let r = mix(v2, v3, tB);
  let ru = mix(u2, u3, tB);
  return array<Shape, 2>(
    Shape(array<vec2f, 4>(p, v1, v2, r), array<vec2f, 4>(pu, u1, u2, ru)),
    Shape(array<vec2f, 4>(r, v3, v0, p), array<vec2f, 4>(ru, u3, u0, pu)),
  );
}

struct Cut { ok: bool, edge: u32, tA: f32, tB: f32 };

// Cut joins the longer opposite-edge pair (tie → edge 0), so it runs across the long axis; t = 0.5 + jitter * 0.3.
// Objects that are nearly square (pair sums within SQUARE_RATIO) take either pair at random (jitterEdge > 0 flips),
// so repeated breaks give roughly square shards instead of always slicing the same way; the halves then stay below
// aspect ~2.6, never slivers. Rejected if the longest side < BREAK_MIN_LONG_SIDE, any sub-length along the cut edges
// < FRAG_MIN_ALONG, or either half's area < FRAG_MIN_AREA.
fn chooseCut(q: Shape, word: bool, jitterA: f32, jitterB: f32, jitterEdge: f32) -> Cut {
  let no = Cut(false, 0u, 0.0, 0.0);
  let l = edgeLengths(q);
  if (max(max(l.x, l.y), max(l.z, l.w)) < BREAK_MIN_LONG_SIDE) { return no; }
  let sum0 = l.x + l.z;
  let sum1 = l.y + l.w;
  var edge = select(1u, 0u, sum0 >= sum1);
  if (!word && jitterEdge > 0.0 && max(sum0, sum1) < SQUARE_RATIO * min(sum0, sum1)) { edge = 1u - edge; }
  let la = select(l.y, l.x, edge == 0u);
  let lb = select(l.w, l.z, edge == 0u);
  let tA = 0.5 + jitterA * 0.3;
  let tB = 0.5 + jitterB * 0.3;
  let minAlong = min(min(tA * la, (1.0 - tA) * la), min(tB * lb, (1.0 - tB) * lb));
  if (minAlong < FRAG_MIN_ALONG) { return no; }
  let h = cutQuad(q, edge, tA, tB);
  if (abs(signedArea4(h[0].v)) < FRAG_MIN_AREA || abs(signedArea4(h[1].v)) < FRAG_MIN_AREA) { return no; }
  return Cut(true, edge, tA, tB);
}

// Stress needed to break: words get stressWord, lowered for long (aspect ≥ 3) and long-sided words; objects get
// stressObject × min(1, stressObjectSize / longest side)^stressObjectSizeExp (big parts break far more readily).
fn breakThreshold(q: Shape, word: bool) -> f32 {
  let l = edgeLengths(q);
  if (!word) {
    let k = min(1.0, tStressObjectSize() / max(max(max(l.x, l.y), max(l.z, l.w)), 1e-3));
    return tStressObject() * pow(k, tStressObjectSizeExp());
  }
  let a = (l.x + l.z) * 0.5;
  let b = (l.y + l.w) * 0.5;
  let longSide = max(a, b);
  let aspect = longSide / max(min(a, b), 1e-3);
  return tStressWord() / max(1.0, aspect / LONG_WORD_ASPECT) / max(1.0, longSide / 60.0);
}

// Uniform hash in [-1, 1].
fn jitter(x: u32) -> f32 { return f32(hashU(x) & 0xffffu) / 32767.5 - 1.0; }

struct Half { s: Shape, c: vec2f, area: f32, ipm: f32, radius: f32 };

// Recentre a half (still in the parent's local frame) on its own centroid.
fn makeHalf(h: Shape) -> Half {
  let c = centroid4(h.v);
  var s = h;
  var r = 0.0;
  for (var k = 0u; k < 4u; k++) {
    s.v[k] = h.v[k] - c;
    r = max(r, length(s.v[k]));
  }
  return Half(s, c, abs(signedArea4(s.v)), inertiaPerMass4(s.v, vec2f(0.0)), r);
}

fn writeHalf(slot: u32, h: Half, parent: Pose, m: Motion, pr: Props, sepDir: vec2f) {
  let r = rot(parent.angle) * h.c;
  let pos = parent.pos + r;
  pose[slot] = Pose(pos, parent.angle, 0.0);
  let vel = m.vel + m.angVel * vec2f(-r.y, r.x) + sepDir * SEPARATE_SPEED;
  motion[slot] = Motion(vel, m.angVel, parent.angle, pos, vec2f(0.0));
  shape[slot] = h.s;
  let invMass = 100.0 / h.area;
  // Objects cascade: each half keeps part of the parent's stress and may break again after a short cooldown; a half
  // longer than crackSize gets twice its own threshold (stress decays ×exp(−3·cooldown) before it may break again),
  // so it cracks again regardless.
  let word = (pr.flags & FLAG_WORD) != 0u;
  let l = edgeLengths(h.s);
  let crack = select(0.0, breakThreshold(h.s, false) * 2.0, max(max(l.x, l.y), max(l.z, l.w)) > tCrackSize());
  let stress = select(max(pr.stress * tStressInherit(), crack), 0.0, word);
  let cooldown = select(tFractureCooldownObject(), tFractureCooldown(), word);
  props[slot] = Props(invMass, invMass / h.ipm, h.radius, pr.flags & (FLAG_ACTIVE | FLAG_WORD | FLAG_SCOOPED),
                      0.0, stress, pr.height, cooldown);
}

@compute @workgroup_size(1) fn fractureSnapshot() {
  atomicStore(&counters[5], min(atomicLoad(&counters[0]), su.bodyCap));
}

@compute @workgroup_size(1) fn writeIndirect() {
  indirect[1] = min(atomicLoad(&counters[0]), su.bodyCap);
}

@compute @workgroup_size(WG) fn fracture(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= su.bodyCap || i >= atomicLoad(&counters[5])) { return; }
  var pr = props[i];
  if ((pr.flags & FLAG_ACTIVE) == 0u) { return; }
  if (pr.cooldown > 0.0) {
    props[i].cooldown = max(0.0, pr.cooldown - su.dt);
    return;
  }
  if ((pr.flags & FLAG_ASLEEP) != 0u) { return; }
  let s = shape[i];
  let word = (pr.flags & FLAG_WORD) != 0u;
  let thr = breakThreshold(s, word);
  if (!(pr.stress >= thr)) { return; } // NaN stress never breaks
  let seed = hashU((i * 2654435761u) ^ hashU(su.frame));
  let cut = chooseCut(s, word, jitter(seed), jitter(seed ^ 0x9e3779b9u), jitter(seed ^ 0x85ebca6bu));
  if (!cut.ok) {
    // Clamp like a failed allocation so an uncuttable body doesn't retry every frame — but only when even the
    // centred cut (the most permissive jitter) fails; a jitter-dependent miss retries next frame with new jitter.
    if (!chooseCut(s, word, 0.0, 0.0, 0.0).ok) { props[i].stress = min(pr.stress, thr * 0.5); }
    return;
  }

  let slot = atomicAdd(&counters[0], 1u);
  if (slot >= su.bodyCap) {
    atomicSub(&counters[0], 1u);
    props[i].stress = min(pr.stress, thr * 0.5); // don't retry every frame
    return;
  }

  let halves = cutQuad(s, cut.edge, cut.tA, cut.tB);
  var keep = makeHalf(halves[0]);
  var other = makeHalf(halves[1]);
  if (other.area > keep.area) {
    let t = keep;
    keep = other;
    other = t;
  }
  let p = pose[i];
  let m = motion[i];
  let d = rot(p.angle) * (keep.c - other.c);
  let dl = length(d);
  let sep = select(vec2f(0.0), d / dl, dl > 1e-6);
  writeHalf(i, keep, p, m, pr, sep);
  writeHalf(slot, other, p, m, pr, -sep);
  atomicAdd(&counters[4], 1u);
}
