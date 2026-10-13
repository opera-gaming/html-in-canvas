// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import { readConfig } from '../src/config';
it('defaults', () =>
  expect(readConfig('')).toEqual({
    maxBodies: 32768,
    maxAuto: null,
    iterations: 2,
    debug: false,
    prof: null,
    tune: {},
  }));
it('parses auto+N', () => expect(readConfig('?max=auto%2B50').maxAuto).toBe(50));
it('clamps values', () => {
  const c = readConfig('?max=5&iter=99&debug');
  expect(c).toEqual({ maxBodies: 1024, maxAuto: null, iterations: 16, debug: true, prof: null, tune: {} });
});
it('parses prof', () => {
  expect(readConfig('?prof').prof).toBe('stages');
  expect(readConfig('?prof=coarse').prof).toBe('coarse');
});
it('ignores garbage', () => expect(readConfig('?max=abc').maxBodies).toBe(32768));
it('parses tune overrides, ignoring malformed entries', () => {
  expect(readConfig('?tune=relax:0.3,friction:1500').tune).toEqual({ relax: 0.3, friction: 1500 });
  expect(readConfig('?tune=relax:abc,:1,x,maxSpeed:-2').tune).toEqual({ maxSpeed: -2 });
});
