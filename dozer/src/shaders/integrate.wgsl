// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Integrate: wake flagged bodies, save the frame-start pose, damp and apply velocity (in place on pose[cur]).
@group(0) @binding(1) var<storage, read_write> pose: array<Pose>;
@group(0) @binding(2) var<storage, read_write> motion: array<Motion>;
@group(0) @binding(3) var<storage, read_write> props: array<Props>;
@group(0) @binding(4) var<storage, read_write> wake: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 8>;
@group(0) @binding(6) var<storage, read> shape: array<Shape>;

@compute @workgroup_size(WG) fn integrate(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= su.bodyCap || i >= atomicLoad(&counters[0])) { return; }
  var pr = props[i];
  if ((pr.flags & FLAG_ACTIVE) == 0u) { return; }
  var p = pose[i];
  var m = motion[i];
  let dt = su.dt;

  if (atomicExchange(&wake[i], 0u) != 0u) {
    pr.flags &= ~FLAG_ASLEEP;
    pr.sleepTimer = 0.0;
  }
  pr.stress *= exp(-3.0 * dt);

  // Every active body records its frame-start pose; finalize's sleep test uses the real per-step displacement
  // (including a sleeping body woken and moved later this frame).
  m.prevPos = p.pos;
  m.prevAngle = p.angle;
  if ((pr.flags & FLAG_ASLEEP) == 0u) {
    m.vel *= exp(-tLinDamp() * dt);
    // Ground friction: constant deceleration, so slow bodies stop rather than creep.
    let sp = length(m.vel);
    m.vel *= select(0.0, max(sp - tFriction() * dt, 0.0) / sp, sp > 0.0);
    m.angVel *= exp(-tAngDamp() * dt);
    p.pos += m.vel * dt;
    p.angle += m.angVel * dt;
    p.pos = clampWalls(p, shape[i]);
    pose[i] = p;
  }
  motion[i] = m;
  props[i] = pr;
}
