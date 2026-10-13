// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export type Mode = 'overview' | 'flying' | 'focus';

export interface AppState {
  mode: Mode;
  hovered: string | null;
  focused: string | null;
  /** Destination while flying: a screen id, or null for the overview. */
  flyingTo: string | null;
}

export type Action =
  { type: 'hover'; id: string | null } | { type: 'click'; id: string } | { type: 'back' } | { type: 'arrive' };

export const initialState: AppState = { mode: 'overview', hovered: null, focused: null, flyingTo: null };

/**
 * The screen after `current` in `ids` (step 1) or before it (step -1); with nothing selected, the first or last.
 * `wrap` cycles around the ends; without it stepping past an end gives null (Tab then leaves the screens).
 */
export function cycleScreen(ids: readonly string[], current: string | null, step: 1 | -1, wrap = true): string | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return step === 1 ? ids[0]! : ids[ids.length - 1]!;
  const j = i + step;
  if (j >= 0 && j < ids.length) return ids[j]!;
  return wrap ? ids[(j + ids.length) % ids.length]! : null;
}

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'hover':
      if (s.mode !== 'overview') return s.hovered === null ? s : { ...s, hovered: null };
      return s.hovered === a.id ? s : { ...s, hovered: a.id };
    case 'click':
      if (s.mode !== 'overview') return s;
      return { mode: 'flying', hovered: null, focused: null, flyingTo: a.id };
    case 'back':
      if (s.mode !== 'focus') return s;
      return { mode: 'flying', hovered: null, focused: s.focused, flyingTo: null };
    case 'arrive':
      if (s.mode !== 'flying') return s;
      return s.flyingTo === null
        ? { mode: 'overview', hovered: null, focused: null, flyingTo: null }
        : { mode: 'focus', hovered: null, focused: s.flyingTo, flyingTo: null };
  }
}
