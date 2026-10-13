// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Packs CPU body descriptions into the GPU storage-buffer layout.
import type { BodyInit } from './extract';
import { inertiaPerMass, type V2 } from './geom';

export const POSE_F32 = 4,
  MOTION_F32 = 8,
  SHAPE_F32 = 16,
  PROPS_F32 = 8;
/** props.flags bits. FLAG_SCOOPED: riding on the blade (maintained by dozer.wgsl; drawn above the blade layer). */
export const FLAG_ACTIVE = 1,
  FLAG_ASLEEP = 2,
  FLAG_WORD = 4,
  FLAG_SCOOPED = 8;

export interface PackedBodies {
  count: number;
  pose: Float32Array;
  motion: Float32Array;
  shape: Float32Array;
  props: Float32Array;
}

/** Arrays are sized to maxBodies; slots >= count stay zero (flags 0 = inactive). */
export function packBodies(bodies: BodyInit[], maxBodies: number): PackedBodies {
  if (bodies.length > maxBodies) throw new Error(`packBodies: ${bodies.length} bodies exceed capacity ${maxBodies}`);
  const pose = new Float32Array(maxBodies * POSE_F32);
  const motion = new Float32Array(maxBodies * MOTION_F32);
  const shape = new Float32Array(maxBodies * SHAPE_F32);
  const props = new Float32Array(maxBodies * PROPS_F32);
  const flags = new Uint32Array(props.buffer);

  bodies.forEach((b, i) => {
    // Pose: pos.xy, angle, pad
    pose.set([b.cx, b.cy, 0, 0], i * POSE_F32);
    // Motion: vel.xy, angVel, prevAngle, prevPos.xy, pad, pad — prev* = initial pose
    motion.set([0, 0, 0, 0, b.cx, b.cy, 0, 0], i * MOTION_F32);
    // Shape: 4 local verts (positive winding) then matching UVs
    const hw = b.w / 2,
      hh = b.h / 2;
    const verts: V2[] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    shape.set([...verts.flat(), b.u0, b.v0, b.u1, b.v0, b.u1, b.v1, b.u0, b.v1], i * SHAPE_F32);
    // Props: invMass, invInertia, radius, flags, sleepTimer, stress, height, cooldown
    const invMass = 100 / (b.w * b.h);
    const o = i * PROPS_F32;
    props[o] = invMass;
    props[o + 1] = invMass / inertiaPerMass(verts, [0, 0]);
    props[o + 2] = Math.hypot(b.w, b.h) / 2;
    flags[o + 3] = FLAG_ACTIVE | FLAG_ASLEEP | (b.word ? FLAG_WORD : 0);
  });

  return { count: bodies.length, pose, motion, shape, props };
}
