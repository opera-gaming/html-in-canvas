// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { Music, startUntilPlaying } from '../src/audio/music';

function fakeAudio() {
  return {
    volume: 1,
    muted: false,
    loop: false,
    played: 0,
    play() {
      this.played++;
    },
    pause() {},
  };
}
function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

describe('Music', () => {
  it('starts looping playback at full volume', () => {
    const a = fakeAudio();
    const m = new Music(a, fakeStorage(), 100);
    m.start();
    expect(a.played).toBe(1);
    expect(a.loop).toBe(true);
    expect(a.volume).toBe(1);
  });
  it('fades volume to 0 on mute and persists the choice', () => {
    const a = fakeAudio();
    const st = fakeStorage();
    const m = new Music(a, st, 100);
    m.start();
    expect(m.toggleMute()).toBe(true);
    m.update(50);
    expect(a.volume).toBeCloseTo(0.5);
    m.update(50);
    expect(a.volume).toBeCloseTo(0);
    expect(st.getItem('music-muted')).toBe('1');
  });
  it('restores the muted state from storage', () => {
    const a = fakeAudio();
    const m = new Music(a, fakeStorage({ 'music-muted': '1' }), 100);
    m.start();
    expect(m.muted).toBe(true);
    m.update(1000);
    expect(a.volume).toBe(0);
  });
  it('treats throwing storage as not muted and still toggles', () => {
    const a = fakeAudio();
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const m = new Music(a, throwing, 100);
    expect(m.muted).toBe(false);
    expect(m.toggleMute()).toBe(true);
    expect(m.muted).toBe(true);
  });
});

describe('startUntilPlaying', () => {
  /** An element whose play() stays blocked until `allow` is set; it then fires `playing`. */
  function blockedAudio() {
    const el = Object.assign(new EventTarget(), { paused: true, allow: false });
    const start = vi.fn(() => {
      if (!el.allow) return;
      el.paused = false;
      el.dispatchEvent(new Event('playing'));
    });
    return { el, start };
  }
  it('retries on every gesture until playback starts, then stops listening', () => {
    const { el, start } = blockedAudio();
    const target = new EventTarget();
    startUntilPlaying(el, target, start);
    expect(start).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    expect(start).toHaveBeenCalledTimes(3);
    el.allow = true;
    target.dispatchEvent(new Event('pointerdown'));
    expect(start).toHaveBeenCalledTimes(4);
    expect(el.paused).toBe(false);
    el.paused = true; // paused later by someone else: gestures no longer restart it
    target.dispatchEvent(new Event('keydown'));
    expect(start).toHaveBeenCalledTimes(4);
  });
  it('does not listen at all when playback starts at once', () => {
    const { el, start } = blockedAudio();
    el.allow = true;
    const target = new EventTarget();
    const remove = vi.spyOn(target, 'removeEventListener');
    startUntilPlaying(el, target, start);
    expect(remove).toHaveBeenCalledTimes(2);
    target.dispatchEvent(new Event('keydown'));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
