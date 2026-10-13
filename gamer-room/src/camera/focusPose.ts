// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { ScreenRect } from '../scene/ScreenFitter';

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

/** Distance at which the rect fills `fill` of the viewport along whichever axis binds. */
export function focusDistance(
  rect: { width: number; height: number },
  fovDeg: number,
  aspect: number,
  fill: number,
): number {
  const tanHalf = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const dForHeight = rect.height / (2 * tanHalf * fill);
  const dForWidth = rect.width / (2 * tanHalf * aspect * fill);
  return Math.max(dForHeight, dForWidth);
}

export function focusPose(rect: ScreenRect, fovDeg: number, aspect: number, fill: number): Pose {
  const d = focusDistance(rect, fovDeg, aspect, fill);
  const position = rect.center.clone().addScaledVector(rect.normal, d);
  const m = new Matrix4().lookAt(position, rect.center, rect.up);
  return { position, quaternion: new Quaternion().setFromRotationMatrix(m) };
}

export function overviewPose(position: [number, number, number], lookAt: [number, number, number]): Pose {
  const p = new Vector3().fromArray(position);
  const m = new Matrix4().lookAt(p, new Vector3().fromArray(lookAt), new Vector3(0, 1, 0));
  return { position: p, quaternion: new Quaternion().setFromRotationMatrix(m) };
}
