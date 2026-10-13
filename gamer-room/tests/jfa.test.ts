// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { jfaSteps } from '../src/fx/jfa';

describe('jfaSteps', () => {
  it('halves from the largest power of two >= max dimension down to 1', () => {
    expect(jfaSteps(1024, 512)).toEqual([512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
  });
  it('rounds non-power-of-two sizes up', () => {
    expect(jfaSteps(960, 540)).toEqual([512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
  });
  it('handles tiny sizes', () => {
    expect(jfaSteps(2, 2)).toEqual([1]);
    expect(jfaSteps(1, 1)).toEqual([1]);
  });
});
