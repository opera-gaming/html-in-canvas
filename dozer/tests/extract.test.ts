// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import { splitWords, rectsToBodies } from '../src/extract';

it('splits on whitespace runs, keeps punctuation and emoji tokens', () => {
  expect(splitWords('  Hello,  world! 🚜 —  ok')).toEqual([
    { start: 2, end: 8 },
    { start: 10, end: 16 },
    { start: 17, end: 19 },
    { start: 20, end: 21 },
    { start: 23, end: 25 },
  ]);
  expect(splitWords('   ')).toEqual([]);
});
it('converts rects to bodies with normalised UVs, sorted by area', () => {
  const b = rectsToBodies(
    [
      { x: 0, y: 0, w: 10, h: 10, kind: 'word' },
      { x: 1024, y: 512, w: 100, h: 50, kind: 'object' },
      { x: 5, y: 5, w: 0, h: 10, kind: 'word' },
    ],
    2048,
  );
  expect(b).toHaveLength(2);
  expect(b[0]).toEqual({
    cx: 1074,
    cy: 537,
    w: 100,
    h: 50,
    u0: 0.5,
    v0: 0.25,
    u1: 1124 / 2048,
    v1: 562 / 2048,
    word: false,
  });
  expect(b[1]!.word).toBe(true);
});
it('clips rects to the page and drops fully outside ones', () => {
  const b = rectsToBodies(
    [
      { x: 2040, y: 10, w: 20, h: 10, kind: 'word' },
      { x: 3000, y: 10, w: 20, h: 10, kind: 'word' },
    ],
    2048,
  );
  expect(b).toHaveLength(1);
  expect(b[0]!.w).toBe(8);
});
