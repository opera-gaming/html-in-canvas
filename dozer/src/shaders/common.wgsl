// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Shared body layout (bodies.ts). Prepended to every shader module.
struct Pose   { pos: vec2f, angle: f32, _pad: f32 };
struct Motion { vel: vec2f, angVel: f32, prevAngle: f32, prevPos: vec2f, _pad: vec2f };
struct Shape  { v: array<vec2f, 4>, uv: array<vec2f, 4> };
struct Props  { invMass: f32, invInertia: f32, radius: f32, flags: u32,
                sleepTimer: f32, stress: f32, height: f32, cooldown: f32 };

const FLAG_ACTIVE: u32 = 1u;
const FLAG_ASLEEP: u32 = 2u;
const FLAG_WORD: u32 = 4u;
// Riding on the blade: set by the dozer pass for a body in the scoop zone (or pushed) while the blade pushes, kept
// while it still overlaps the blade's sprite region, cleared once it doesn't. Scooped bodies draw above the blade
// layer and get the scoop height; all others draw under it (so a reversing dozer's blade covers the words it runs over).
const FLAG_SCOOPED: u32 = 8u;

fn rot(angle: f32) -> mat2x2f {
  let c = cos(angle);
  let s = sin(angle);
  return mat2x2f(c, s, -s, c);
}

fn worldVerts(p: Pose, s: Shape) -> array<vec2f, 4> {
  let m = rot(p.angle);
  return array<vec2f, 4>(p.pos + m * s.v[0], p.pos + m * s.v[1], p.pos + m * s.v[2], p.pos + m * s.v[3]);
}

// Simulation uniforms (sim.ts writes these; tuning layout in simcommon.wgsl).
struct SimU {
  dt: f32, frame: u32, bodyCap: u32, iter: u32,
  gridDim: vec2u, cellSize: f32, pageSize: f32,
  dozerPos: vec2f, dozerVel: vec2f,
  blade: array<vec4f, 2>,     // push quad behind the push line's main run (4 verts packed xy,xy)
  wing: array<vec4f, 2>,      // push quad behind the push line's lower run
  edge: array<vec4f, 2>,      // steel cutting edge: e0.xy, e1.xy | e2.xy, -
  region: array<vec4f, 4>,    // blade sprite region: two quads (main run, lower run), 4 verts each packed xy,xy
  tuning: array<vec4f, 8>,
  dozerMisc: vec4f,           // (angVel rad/s, heading cos, heading sin, -)
};

// SAT for two convex quads (signedArea > 0). Line-for-line port of satQuads() in geom.ts.
struct Contact { hit: bool, depth: f32, normal: vec2f, point: vec2f };

const SAT_INSIDE_EPS: f32 = 1e-4;

// (min, max) of dot(v, n) over the quad.
fn satProject(v: array<vec2f, 4>, n: vec2f) -> vec2f {
  var lo = 3.4e38;
  var hi = -3.4e38;
  for (var i = 0u; i < 4u; i++) {
    let d = dot(v[i], n);
    lo = min(lo, d);
    hi = max(hi, d);
  }
  return vec2f(lo, hi);
}

// p inside (or on) q: cross(edge, p - v_i) >= 0 for every edge.
fn satInside(q: array<vec2f, 4>, p: vec2f) -> bool {
  var ok = true;
  for (var i = 0u; i < 4u; i++) {
    let a = q[i];
    let b = q[(i + 1u) % 4u];
    let cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    ok = ok && cr >= -SAT_INSIDE_EPS;
  }
  return ok;
}

// normal points from b to a: moving a by normal * depth separates them.
fn sat(a: array<vec2f, 4>, b: array<vec2f, 4>) -> Contact {
  var res = Contact(false, 3.4e38, vec2f(0.0), vec2f(0.0));
  for (var k = 0u; k < 8u; k++) {
    var q = a;
    if (k >= 4u) { q = b; }
    let i = k % 4u;
    let p0 = q[i];
    let p1 = q[(i + 1u) % 4u];
    let e = p1 - p0;
    let len = length(e);
    if (len < 1e-9) { continue; }
    let ax = vec2f(e.y, -e.x) / len;
    let pa = satProject(a, ax);
    let pb = satProject(b, ax);
    // Moving a by +axis*dPos or -axis*dNeg separates the pair; the smaller one is this axis' overlap.
    let dPos = pb.y - pa.x;
    let dNeg = pa.y - pb.x;
    let overlap = min(dPos, dNeg);
    if (overlap <= 0.0) { return Contact(false, 0.0, vec2f(0.0), vec2f(0.0)); }
    let sgn = select(-1.0, 1.0, dPos <= dNeg);
    if (overlap < res.depth) { res.depth = overlap; res.normal = ax * sgn; }
  }
  var ca = vec2f(0.0);
  var cb = vec2f(0.0);
  for (var i = 0u; i < 4u; i++) { ca += a[i] / 4.0; cb += b[i] / 4.0; }
  var sum = vec2f(0.0);
  var n = 0.0;
  for (var i = 0u; i < 4u; i++) {
    if (satInside(b, a[i])) { sum += a[i]; n += 1.0; }
    if (satInside(a, b[i])) { sum += b[i]; n += 1.0; }
  }
  res.point = select((ca + cb) * 0.5, sum / max(n, 1.0), n > 0.0);
  res.hit = true;
  return res;
}
