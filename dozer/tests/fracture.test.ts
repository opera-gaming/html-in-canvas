// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import src from '../src/shaders/fracture.wgsl?raw';
import { BREAK_MIN_LONG_SIDE, FRAG_MIN_ALONG, FRAG_MIN_AREA, LONG_WORD_ASPECT, SQUARE_RATIO } from '../src/geom';
it('WGSL fracture constants mirror geom.ts', () => {
  expect(src).toMatch(new RegExp(`BREAK_MIN_LONG_SIDE\\s*=\\s*${BREAK_MIN_LONG_SIDE}\\.?0?`));
  expect(src).toMatch(new RegExp(`FRAG_MIN_ALONG\\s*=\\s*${FRAG_MIN_ALONG}\\.?0?`));
  expect(src).toMatch(new RegExp(`FRAG_MIN_AREA\\s*=\\s*${FRAG_MIN_AREA}\\.?0?`));
  expect(src).toMatch(new RegExp(`LONG_WORD_ASPECT\\s*=\\s*${LONG_WORD_ASPECT}\\.?0?`));
  expect(src).toMatch(new RegExp(`SQUARE_RATIO\\s*=\\s*${SQUARE_RATIO}`));
});
