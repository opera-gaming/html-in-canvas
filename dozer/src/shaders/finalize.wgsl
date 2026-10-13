// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Finalize (in place on the final pose buffer): NaN guard, speed clamps, pile height, sleep, counters. (The draw
// count is written after fracture, fracture.wgsl writeIndirect.)
// Velocity is NOT derived from the pose delta: contact and push-out corrections are position-only, and the velocity
// is what integrate (damping, friction) and the dozer (blade push) left. The real per-step displacement only feeds
// the sleep test, so a body that contacts are still shoving around counts as moving.
@group(0) @binding(1) var<storage, read_write> pose: array<Pose>;
@group(0) @binding(2) var<storage, read_write> motion: array<Motion>;
@group(0) @binding(3) var<storage, read_write> props: array<Props>;
@group(0) @binding(4) var<storage, read_write> counters: array<atomic<u32>, 8>;
@group(0) @binding(5) var<storage, read> occF: array<f32>;

fn occAt(p: vec2f) -> f32 {
  let b = bilin(p);
  return dot(b.w, vec4f(occF[b.i.x], occF[b.i.y], occF[b.i.z], occF[b.i.w]));
}

fn finite1(x: f32) -> bool { return finiteF(x); }
fn finite2(v: vec2f) -> bool { return finite1(v.x) && finite1(v.y); }

@compute @workgroup_size(WG) fn finalize(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  let count = atomicLoad(&counters[0]);
  if (i >= su.bodyCap || i >= count) { return; }
  var pr = props[i];
  if ((pr.flags & FLAG_ACTIVE) == 0u) { return; }
  if ((pr.flags & FLAG_ASLEEP) != 0u) { atomicAdd(&counters[3], 1u); return; }

  var m = motion[i];
  var p = pose[i];
  // NaN guard: a non-finite pose or velocity snaps back to the frame-start pose, at rest.
  if (!finite2(p.pos) || !finite1(p.angle) || !finite2(m.vel) || !finite1(m.angVel)) {
    p.pos = select(vec2f(su.pageSize * 0.5), m.prevPos, finite2(m.prevPos));
    p.angle = select(0.0, m.prevAngle, finite1(m.prevAngle));
    pose[i] = p;
    m.prevPos = p.pos;
    m.prevAngle = p.angle;
    m.vel = vec2f(0.0);
    m.angVel = 0.0;
  }
  m.vel = capLen(m.vel, tMaxSpeed());
  m.angVel = clamp(m.angVel, -tMaxAngVel(), tMaxAngVel());
  var moveSpeed = length(m.vel);
  var turnSpeed = abs(m.angVel);
  if (su.dt > 0.0) {
    moveSpeed = max(moveSpeed, length(p.pos - m.prevPos) / su.dt);
    turnSpeed = max(turnSpeed, abs(p.angle - m.prevAngle) / su.dt);
  }
  // Fake pile height: smoothed sample of the occupancy field (awake bodies only; sleeping ones keep theirs, so
  // untouched page text stays at height 0 and renders exactly like the page).
  // Scoop: a scooped body riding on the blade between the push line and the cutting edge rises toward
  // max(occupancy, scoopHeight) at scoopRate; once it leaves the zone the occupancy smoothing relaxes it.
  let occ = occAt(p.pos);
  if (finite1(occ) && finite1(pr.height)) {
    if (inScoop(p.pos) && (pr.flags & FLAG_SCOOPED) != 0u) {
      pr.height += (max(occ, tScoopHeight()) - pr.height) * (1.0 - exp(-tScoopRate() * su.dt));
    } else {
      pr.height += (occ - pr.height) * (1.0 - exp(-tHeightSmooth() * su.dt));
    }
  } else {
    pr.height = 0.0;
  }
  // sleepTimer counts seconds (not steps), so sleeping does not depend on the step size.
  if (moveSpeed < tSleepSpeed() && turnSpeed < 0.2) { pr.sleepTimer += su.dt; } else { pr.sleepTimer = 0.0; }
  if (pr.sleepTimer > tSleepTime()) {
    pr.flags |= FLAG_ASLEEP;
    m.vel = vec2f(0.0);
    m.angVel = 0.0;
    atomicAdd(&counters[3], 1u);
  } else {
    atomicAdd(&counters[2], 1u);
  }
  motion[i] = m;
  props[i] = pr;
}
