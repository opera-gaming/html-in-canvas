// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createSplash } from '../src/splash';

describe('splash (loading veil)', () => {
  it('shows "Loading…" until the page is ready, with nothing to click', () => {
    const el = document.createElement('div');
    createSplash(el);
    expect(el.hidden).toBe(false);
    expect(el.querySelector('button')).toBeNull();
    expect(el.textContent).toContain('Loading the page…');
  });
  it('lifts by itself when ready', () => {
    const el = document.createElement('div');
    const splash = createSplash(el);
    splash.ready();
    splash.ready();
    expect(el.hidden).toBe(true);
  });
});
