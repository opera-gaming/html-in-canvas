// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { focusDistance, focusPose, overviewPose } from '../src/camera/focusPose';

const rect = {
  center: new Vector3(0, 1, -2),
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  normal: new Vector3(0, 0, 1),
  width: 1.6,
  height: 0.9,
  curved: false,
};

describe('focusDistance', () => {
  it('fits the height when the screen is wider than the viewport is tall-limited', () => {
    // fov 90 → tan(45°)=1 → visible height at d = 2d. fill 1 → d = h/2.
    expect(focusDistance({ width: 1, height: 1 }, 90, 16 / 9, 1)).toBeCloseTo(0.5);
  });
  it('fits the width when the viewport is narrower than the screen', () => {
    // portrait viewport aspect 0.5: visible width at d = 2d*0.5 = d. width 2 → d = 2.
    expect(focusDistance({ width: 2, height: 1 }, 90, 0.5, 1)).toBeCloseTo(2);
  });
  it('scales by fill', () => {
    expect(focusDistance({ width: 1, height: 1 }, 90, 16 / 9, 0.5)).toBeCloseTo(1);
  });
});

describe('focusPose', () => {
  it('sits in front of the screen along its normal and looks at it', () => {
    const p = focusPose(rect, 50, 16 / 9, 0.8);
    expect(p.position.x).toBeCloseTo(0);
    expect(p.position.y).toBeCloseTo(1);
    expect(p.position.z).toBeGreaterThan(-2);
    const forward = new Vector3(0, 0, -1).applyQuaternion(p.quaternion);
    expect(forward.z).toBeCloseTo(-1);
  });
});

describe('overviewPose', () => {
  it('looks from position toward lookAt', () => {
    const p = overviewPose([0, 0, 5], [0, 0, 0]);
    const forward = new Vector3(0, 0, -1).applyQuaternion(p.quaternion);
    expect(forward.z).toBeCloseTo(-1);
  });
});
