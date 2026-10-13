// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { OutlineAnimator } from '../src/fx/OutlineAnimator';

describe('OutlineAnimator', () => {
  it('animates from 0 to maxWidth over ms', () => {
    const a = new OutlineAnimator(8, 100);
    a.setTarget(true);
    expect(a.update(50)).toBeCloseTo(4);
    expect(a.update(50)).toBeCloseTo(8);
    expect(a.update(50)).toBeCloseTo(8);
  });
  it('reverses from the current width when the target flips mid-animation', () => {
    const a = new OutlineAnimator(8, 100);
    a.setTarget(true);
    a.update(25); // 2
    a.setTarget(false);
    expect(a.update(12.5)).toBeCloseTo(1);
    expect(a.update(12.5)).toBeCloseTo(0);
  });
});

describe('OutlineAnimator with ms <= 0', () => {
  it('jumps straight to the target', () => {
    const a = new OutlineAnimator(8, 0);
    a.setTarget(true);
    expect(a.update(0)).toBe(8);
    a.setTarget(false);
    expect(a.update(0)).toBe(0);
  });
});
