// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import { formatHud } from '../src/hud';
it('formats stats', () => {
  expect(
    formatHud({ fps: 59.6, bodies: 12345, active: 812, asleep: 11533, fragments: 37, gridOverflow: 0, cap: 32768 }),
  ).toBe('60 fps · 12,345 bodies (812 awake, 11,533 asleep) · 37 fragments · cap 32,768');
  expect(formatHud({ fps: 30, bodies: 1, active: 1, asleep: 0, fragments: 0, gridOverflow: 12, cap: 1024 })).toContain(
    'grid overflow 12',
  );
});
