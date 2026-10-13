// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Kinematic dozer vs bodies (in place on the current pose buffer). Only the blade collides (its push quads: the main
// run and the lower run behind the moldboard's yellow ridge); the dozer runs over everything else, and words pass
// under the body, which is drawn over the text. A body overlapping a push quad is pushed out only while the blade
// surface at the contact moves into it: velocity along the face's outward normal > PUSH_EPS. Forward and sideways
// motion pushes; backing up never does (the back face never pushes, and bodies behind it are run over).
// Push-out is capped per step (dozerBudgetAt in dozerPre: about what the blade moved this step; just pushMargin in
// dozerPost, after the contact iterations), so a body left overlapping the blade while it was not pushing comes out
// over a few steps when pushing resumes, never in a jump.
//
// Velocity model: the dozer is the only source of body velocity. Push-out itself is position-only; a body the blade
// pushes gets velocity = the pushing part of the blade surface velocity at the contact, along the push normal:
// vel = max(dot(vDozer(point), n), 0) · n. Contacts and spreading never create velocity.
@group(0) @binding(1) var<storage, read_write> pose: array<Pose>;
@group(0) @binding(2) var<storage, read> shape: array<Shape>;
@group(0) @binding(3) var<storage, read_write> props: array<Props>;
@group(0) @binding(4) var<storage, read_write> wake: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 8>;
@group(0) @binding(6) var<storage, read_write> motion: array<Motion>;

// Distance a must move along unit direction d to stop overlapping convex quad b (both signedArea > 0): the smallest
// per-axis separation over the edge normals of both quads that d makes progress on (exact for convex polygons). A
// plain "front face − rearmost vertex" depth overshoots when a corner of a big body pokes past the end of the blade.
fn dirDepth(a: array<vec2f, 4>, b: array<vec2f, 4>, d: vec2f) -> f32 {
  var t = 3.4e38;
  for (var k = 0u; k < 8u; k++) {
    var q = a;
    if (k >= 4u) { q = b; }
    let e = q[(k + 1u) % 4u] - q[k % 4u];
    let len = length(e);
    if (len < 1e-9) { continue; }
    let ax = vec2f(e.y, -e.x) / len;
    let c = dot(ax, d);
    if (abs(c) < 1e-3) { continue; }
    let pa = satProject(a, ax);
    let pb = satProject(b, ax);
    t = min(t, max(select((pa.y - pb.x) / -c, (pb.y - pa.x) / c, c > 0.0), 0.0));
  }
  return t;
}

// Pushing part of the dozer surface velocity at `point` along the outward normal n.
fn pushVel(point: vec2f, n: vec2f) -> vec2f {
  return max(dot(dozerVelAt(point), n), 0.0) * n;
}

// Blade surface speed (px/s) into a body, along the push normal, below which the blade does not push it.
const PUSH_EPS: f32 = 1.0;
// The blade never pushes while its surface moves more than 60° backward relative to the dozer's heading (cos 120° =
// −0.5): the angled blade's left end face points partly backward and would otherwise shove words when reversing.
const BACKWARD_COS: f32 = -0.5;

// The blade surface velocity v counts as pushing along n: into the body, and not backing up.
fn pushes(v: vec2f, n: vec2f) -> bool {
  return dot(v, n) > PUSH_EPS && dot(v, su.dozerMisc.yz) >= BACKWARD_COS * length(v);
}

struct PushRes { hit: bool, depth: f32, vel: vec2f };

// One push-out of the body (pose *p, shape s) from push quad q (blade or wing; dozer.ts pushQuad: v0 = back-left,
// v1 = front-left, v2 = front-right, v3 = back-right, front face = the push line), spending at most *left px of the
// step's budget. A body whose centre is ahead of the quad's back face (within its length) always goes out through the
// front face along the quad's normal: thin words would otherwise tunnel through the 6 px thick quad along a sideways
// or backward SAT axis. Otherwise the SAT axis is used, except the back face, which never pushes. No push unless the
// blade surface at the contact moves into the body along that normal (backing up runs words over).
fn pushFromQuad(q: array<vec2f, 4>, p: ptr<function, Pose>, s: Shape, left: ptr<function, f32>) -> PushRes {
  let none = PushRes(false, 0.0, vec2f(0.0));
  let v = worldVerts(*p, s);
  let c = sat(v, q);
  if (!c.hit) { return none; }
  let bn = normalize(q[1] - q[0]);           // front normal
  let bu = normalize(q[0] - q[3]);           // along the push line, right end → left end
  let mid = (q[0] + q[1] + q[2] + q[3]) * 0.25;
  let frontD = dot(q[1] - mid, bn);          // = half the quad's depth
  let halfLen = length(q[0] - q[3]) * 0.5;
  var n = c.normal;
  var d = c.depth;
  let rc = (*p).pos - mid;
  if (dot(rc, bn) >= -frontD && abs(dot(rc, bu)) <= halfLen) {
    n = bn;
    d = dirDepth(v, q, bn);
  }
  if (dot(n, bn) < -0.5) { return none; }
  if (!pushes(dozerVelAt(c.point), n)) { return none; }
  let dd = min(d, *left);
  (*p).pos += n * dd;
  *left -= dd;
  return PushRes(true, d, pushVel(c.point, n));
}

// True when c lies in the scoop zone of the blade's main run (or lower run) and that part of the blade moves into it
// along its front normal faster than PUSH_EPS: the blade is scooping it up, not reversing over it.
fn scoopedNow(blade: array<vec2f, 4>, wing: array<vec2f, 4>, c: vec2f) -> bool {
  let v = dozerVelAt(c);
  let onMain = inScoopOf(blade, su.edge[0].xy, su.edge[0].zw, c) && pushes(v, normalize(blade[1] - blade[0]));
  let onLow = inScoopOf(wing, su.edge[0].zw, su.edge[1].xy, c) && pushes(v, normalize(wing[1] - wing[0]));
  return onMain || onLow;
}

// Push quads (dozer.ts dozerArtPolygons): blade = behind the push line's main run, wing = behind its lower run. Bodies
// between the push line and the steel cutting edge in front of it (the scoop zone, simcommon.wgsl inScoop) are not
// pushed: they ride on the blade.
fn pushBody(i: u32, post: bool) {
  if (i >= su.bodyCap || i >= atomicLoad(&counters[0])) { return; }
  var pr = props[i];
  if ((pr.flags & FLAG_ACTIVE) == 0u) { return; }
  let blade = quadOf(su.blade);
  let wing = quadOf(su.wing);
  var p = pose[i];

  var dozR = 0.0;
  for (var k = 0u; k < 4u; k++) {
    dozR = max(dozR, max(length(blade[k] - su.dozerPos), length(wing[k] - su.dozerPos)));
  }
  dozR = max(dozR, length(su.edge[0].xy - su.dozerPos));
  dozR = max(dozR, max(length(su.edge[0].zw - su.dozerPos), length(su.edge[1].xy - su.dozerPos)));
  let reach = dozR + pr.radius;
  let rel0 = p.pos - su.dozerPos;
  if (dot(rel0, rel0) >= reach * reach) {
    // Out of reach: it cannot overlap the blade any more, so it no longer rides it.
    if ((pr.flags & FLAG_SCOOPED) != 0u) {
      pr.flags &= ~FLAG_SCOOPED;
      props[i] = pr;
    }
    return;
  }

  let s = shape[i];
  let budget = select(dozerBudgetAt(p.pos), tPushMargin(), post);

  var touched = false;
  var depthSum = 0.0;
  var bladeVel = vec2f(0.0);
  // Blade, then wing (the budget is shared, so a body at the bend cannot be pushed twice its share).
  var left = budget;
  let rb = pushFromQuad(blade, &p, s, &left);
  if (rb.hit) { touched = true; depthSum += rb.depth; bladeVel = rb.vel; }
  let rw = pushFromQuad(wing, &p, s, &left);
  if (rw.hit) {
    // Both hit (at the bend): keep the faster push.
    if (!touched || dot(rw.vel, rw.vel) > dot(bladeVel, bladeVel)) { bladeVel = rw.vel; }
    touched = true;
    depthSum += rw.depth;
  }
  // FLAG_SCOOPED: set for a body pushed by the blade, or in the scoop zone while the blade there moves into it (the
  // push condition); kept while the body still overlaps the blade sprite region (so words on the blade ride it even
  // when the dozer then reverses); cleared once it doesn't. A body the reversing blade runs over is never set.
  let wasScooped = (pr.flags & FLAG_SCOOPED) != 0u;
  var scooped = touched || scoopedNow(blade, wing, p.pos);
  if (!scooped && wasScooped) {
    let vr = worldVerts(p, s);
    scooped = sat(vr, quadOf(array<vec4f, 2>(su.region[0], su.region[1]))).hit
           || sat(vr, quadOf(array<vec4f, 2>(su.region[2], su.region[3]))).hit;
  }
  pr.flags = select(pr.flags & ~FLAG_SCOOPED, pr.flags | FLAG_SCOOPED, scooped);
  if (!touched) {
    // Riding in the scoop zone: kept awake so finalize can raise its render height (it is not pushed).
    let ride = post && scooped && inScoop(p.pos);
    if (ride) {
      pr.flags &= ~FLAG_ASLEEP;
      pr.sleepTimer = 0.0;
    }
    if (ride || scooped != wasScooped) { props[i] = pr; }
    return;
  }

  var m = motion[i];
  m.vel = bladeVel;
  // Blade pressure builds stress (not on a dt = 0 step). Objects get extra, so one-sided blade pressure alone breaks
  // them (bladeStressObject).
  let word = (pr.flags & FLAG_WORD) != 0u;
  if (post && su.dt > 0.0) { pr.stress += depthSum * (4.0 + select(tBladeStressObject(), 0.0, word)); }

  // Against a wall the blade cannot push the body out (the wall wins): squeeze it out sideways along the blade by at
  // most the per-step budget, so material spills gradually around a blade pressed into a wall. It goes toward the
  // end that opens away from the wall (for the angled blade against a wall ahead: the trailing left end), or the
  // nearer end when the blade meets the wall square on.
  let walled = clampWalls(p, s);
  let wallPush = walled - p.pos;
  let atWall = any(abs(wallPush) > vec2f(1e-3));
  p.pos = walled;
  if (atWall) {
    let vw = worldVerts(p, s);
    // Squeeze along the quad the body is caught in (the blade, else the wing: the wing runs nearly parallel to a wall
    // ahead, and sliding a body caught there along the main blade would only push it deeper in).
    var q = blade;
    var caught = sat(vw, blade).hit;
    if (!caught) {
      q = wing;
      caught = sat(vw, wing).hit;
    }
    if (caught) {
      let qu = normalize(q[0] - q[3]);                 // along the quad, right end → left end
      let qMid = (q[0] + q[1] + q[2] + q[3]) * 0.25;
      let qHalf = length(q[0] - q[3]) * 0.5;
      var lo = 3.4e38;
      var hi = -3.4e38;
      for (var k = 0u; k < 4u; k++) {
        let du = dot(vw[k] - qMid, qu);
        lo = min(lo, du);
        hi = max(hi, du);
      }
      let away = dot(normalize(wallPush), qu);
      let toLeft = select(dot(p.pos - qMid, qu) >= 0.0, away > 0.0, abs(away) > 0.1);
      var sq = vec2f(0.0);
      if (toLeft) { sq = qu * min(max(qHalf - lo, 0.0), budget); }
      else { sq = -qu * min(max(qHalf + hi, 0.0), budget); }
      p.pos = clampWalls(Pose(p.pos + sq, p.angle, 0.0), s);
      m.vel = vec2f(0.0); // pinned against the wall: no velocity into it
    }
  }
  pr.flags &= ~FLAG_ASLEEP;
  pr.sleepTimer = 0.0;
  atomicStore(&wake[i], 1u);
  pose[i] = p;
  props[i] = pr;
  motion[i] = m;
}

@compute @workgroup_size(WG) fn dozerPre(@builtin(global_invocation_id) g: vec3u) { pushBody(g.x, false); }
@compute @workgroup_size(WG) fn dozerPost(@builtin(global_invocation_id) g: vec3u) { pushBody(g.x, true); }
