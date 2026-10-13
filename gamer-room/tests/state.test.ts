// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { cycleScreen, initialState, reduce, type AppState } from '../src/app/state';

describe('state reducer', () => {
  it('tracks hover in overview only', () => {
    const s = reduce(initialState, { type: 'hover', id: 'arcade' });
    expect(s.hovered).toBe('arcade');
    const flying: AppState = { ...initialState, mode: 'flying', flyingTo: 'arcade' };
    expect(reduce(flying, { type: 'hover', id: 'crt' }).hovered).toBeNull();
  });

  it('click in overview starts a flight and clears hover', () => {
    const s = reduce({ ...initialState, hovered: 'arcade' }, { type: 'click', id: 'arcade' });
    expect(s).toEqual({ mode: 'flying', hovered: null, focused: null, flyingTo: 'arcade' });
  });

  it('arrive after click enters focus', () => {
    const s = reduce({ mode: 'flying', hovered: null, focused: null, flyingTo: 'arcade' }, { type: 'arrive' });
    expect(s).toEqual({ mode: 'focus', hovered: null, focused: 'arcade', flyingTo: null });
  });

  it('back from focus flies to overview, arrive returns to overview', () => {
    const f: AppState = { mode: 'focus', hovered: null, focused: 'arcade', flyingTo: null };
    const s = reduce(f, { type: 'back' });
    expect(s).toEqual({ mode: 'flying', hovered: null, focused: 'arcade', flyingTo: null });
    expect(reduce(s, { type: 'arrive' })).toEqual(initialState);
  });

  it('ignores click and back while flying', () => {
    const f: AppState = { mode: 'flying', hovered: null, focused: null, flyingTo: 'arcade' };
    expect(reduce(f, { type: 'click', id: 'crt' })).toBe(f);
    expect(reduce(f, { type: 'back' })).toBe(f);
  });

  it('ignores click and back in overview without focus', () => {
    expect(reduce(initialState, { type: 'back' })).toBe(initialState);
    const f: AppState = { mode: 'focus', hovered: null, focused: 'arcade', flyingTo: null };
    expect(reduce(f, { type: 'click', id: 'crt' })).toBe(f);
  });
});

describe('cycleScreen', () => {
  const ids = ['monl', 'arcade', 'monr'];
  it('starts at the first or last screen with nothing selected', () => {
    expect(cycleScreen(ids, null, 1)).toBe('monl');
    expect(cycleScreen(ids, null, -1)).toBe('monr');
  });
  it('steps and wraps around', () => {
    expect(cycleScreen(ids, 'monl', 1)).toBe('arcade');
    expect(cycleScreen(ids, 'monr', 1)).toBe('monl');
    expect(cycleScreen(ids, 'monl', -1)).toBe('monr');
  });
  it('without wrap, stepping past an end leaves the screens', () => {
    expect(cycleScreen(ids, 'monr', 1, false)).toBeNull();
    expect(cycleScreen(ids, 'monl', -1, false)).toBeNull();
    expect(cycleScreen(ids, 'arcade', -1, false)).toBe('monl');
  });
  it('handles no screens and an unknown current', () => {
    expect(cycleScreen([], null, 1)).toBeNull();
    expect(cycleScreen(ids, 'gone', 1)).toBe('monl');
  });
});
