// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { averageColor } from '../src/scene/averageColor';

describe('averageColor', () => {
  it('averages RGB and ignores alpha', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]);
    expect(averageColor(px)).toEqual([0.5, 0, 0.5]);
  });
  it('returns black for empty input', () => {
    expect(averageColor(new Uint8Array())).toEqual([0, 0, 0]);
  });
});
