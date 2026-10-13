// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Pose } from './focusPose';

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Parabolic lift: 0 at t=0 and t=1, `arc` at t=0.5. */
export function arcLift(t: number, arc: number): number {
  return 4 * arc * t * (1 - t);
}

/** Interpolates position (with arc) and orientation (slerp) at eased parameter t. */
export function lerpPose(a: Pose, b: Pose, t: number, arc: number, out: Pose): Pose {
  const e = smoothstep(t);
  out.position.lerpVectors(a.position, b.position, e);
  out.position.y += arcLift(e, arc);
  out.quaternion.slerpQuaternions(a.quaternion, b.quaternion, e);
  return out;
}
