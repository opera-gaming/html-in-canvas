// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import {
  BREAK_GAIN,
  engineSound,
  followVisibility,
  hostMuteFrom,
  ENGINE_GAIN,
  normalizeBuffer,
  planBreaks,
  scrapeSound,
  SCRAPE_GAIN,
  SCRAPE_FULL,
  soundHint,
} from '../src/audio';

describe('engineSound', () => {
  it('maps load to pitch 1.0 → 1.35 and gain 0.45× → 1× of ENGINE_GAIN, clamped', () => {
    expect(engineSound(0).rate).toBe(1);
    expect(engineSound(1).rate).toBeCloseTo(1.35);
    expect(engineSound(0.5).rate).toBeCloseTo(1.175);
    expect(engineSound(0).gain).toBeCloseTo(0.45 * ENGINE_GAIN);
    expect(engineSound(1).gain).toBeCloseTo(ENGINE_GAIN);
    expect(engineSound(1).gain / engineSound(0).gain).toBeGreaterThan(2);
    expect(engineSound(5)).toEqual(engineSound(1));
    expect(engineSound(Number.NaN)).toEqual(engineSound(0));
  });
  it('asks for a gesture only while waiting', () => {
    expect(soundHint('waiting')).toMatch(/click or press a key/);
    expect(soundHint('running')).toBe('');
    expect(soundHint('unavailable')).toBe('');
  });
});

describe('planBreaks', () => {
  it('plans one hit per new fragment up to the cap, spread over the interval, with varied rate and gain', () => {
    const hits = planBreaks(5, 8, 0.1);
    expect(hits).toHaveLength(5);
    for (const h of hits) {
      expect(h.offset).toBeGreaterThanOrEqual(0);
      expect(h.offset).toBeLessThan(0.1);
      expect(h.rate).toBeGreaterThanOrEqual(0.85);
      expect(h.rate).toBeLessThanOrEqual(1.15);
    }
    expect(new Set(hits.map((h) => h.offset)).size).toBeGreaterThan(1);
  });
  it('caps the hit count and plays louder hits for a big burst instead', () => {
    const mid = () => 0.5; // offset interval/2, rate 1, gain at base × boost
    const small = planBreaks(4, 8, 0.1, mid),
      big = planBreaks(200, 8, 0.1, mid);
    expect(big).toHaveLength(8);
    expect(big[0]!.gain).toBeGreaterThan(small[0]!.gain);
    expect(big[0]!.gain).toBeLessThanOrEqual(small[0]!.gain * 1.4 + 1e-9);
  });
  it('plans nothing for no increase', () => {
    expect(planBreaks(0, 8, 0.1)).toEqual([]);
    expect(planBreaks(-3, 8, 0.1)).toEqual([]);
  });
});

describe('scrapeSound', () => {
  it('is silent at rest and when reversing, and fades in smoothly to full gain by SCRAPE_FULL of top speed', () => {
    expect(scrapeSound(0).gain).toBe(0);
    expect(scrapeSound(-0.8).gain).toBe(0);
    expect(scrapeSound(Number.NaN).gain).toBe(0);
    expect(scrapeSound(SCRAPE_FULL / 2).gain).toBeCloseTo(SCRAPE_GAIN / 2);
    expect(scrapeSound(SCRAPE_FULL).gain).toBeCloseTo(SCRAPE_GAIN);
    expect(scrapeSound(1).gain).toBeCloseTo(SCRAPE_GAIN);
    // Smoothstep: flat at the start, so it does not click in.
    expect(scrapeSound(0.01).gain).toBeLessThan(SCRAPE_GAIN * 0.01);
  });
  it('lifts the pitch slightly with speed', () => {
    expect(scrapeSound(0).rate).toBe(1);
    expect(scrapeSound(1).rate).toBeCloseTo(1.15);
  });
});

describe('normalizeBuffer', () => {
  const sine = (amp: number, n = 48000) =>
    Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / 48000));
  const rmsDb = (x: Float32Array) => 20 * Math.log10(Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length));
  const peakDb = (x: Float32Array) => 20 * Math.log10(x.reduce((a, v) => Math.max(a, Math.abs(v)), 0));
  it('brings a sine at a known level to the target RMS', () => {
    const src = sine(0.05); // RMS 0.05/√2 ≈ −29 dBFS, peak −26 dBFS
    const {
      channels: [out],
      info,
    } = normalizeBuffer([src], -20, -1);
    // The −50 dBFS gate drops the samples near each zero crossing, so the gated RMS reads ~0.2 dB above the plain one.
    expect(info.rmsDb).toBeCloseTo(20 * Math.log10(0.05 / Math.SQRT2), 0);
    expect(info.peakLimited).toBe(false);
    expect(rmsDb(out!)).toBeCloseTo(-20, 0);
    expect(src[100]).toBeCloseTo(0.05 * Math.sin((2 * Math.PI * 440 * 100) / 48000), 6); // input untouched
  });
  it('limits a loud transient by the peak ceiling', () => {
    const src = sine(0.01);
    src[1000] = 0.9; // one spike: by RMS alone the scale would push it far past full scale
    const {
      channels: [out],
      info,
    } = normalizeBuffer([src], -20, -1);
    expect(info.peakLimited).toBe(true);
    expect(peakDb(out!)).toBeCloseTo(-1, 3);
    expect(rmsDb(out!)).toBeLessThan(-20);
  });
  it('ignores silence below the gate when measuring RMS', () => {
    const hit = sine(0.1, 4800);
    const padded = new Float32Array(48000);
    padded.set(hit, 20000); // 0.1 s of sound in 1 s of silence
    const a = normalizeBuffer([hit], -20, -1).info.scale,
      b = normalizeBuffer([padded], -20, -1).info.scale;
    expect(b).toBeCloseTo(a, 2);
  });
  it('leaves silence alone and keeps the mix gains below 1', () => {
    expect(normalizeBuffer([new Float32Array(10)], -20, -1).info.scale).toBe(1);
    for (const g of [ENGINE_GAIN, SCRAPE_GAIN, BREAK_GAIN * 1.4 * 1.15]) expect(g).toBeLessThan(1);
  });
});

describe('hostMuteFrom', () => {
  const own = 'https://example.test';
  it('reads a same-origin dozer-mute message', () => {
    expect(hostMuteFrom({ type: 'dozer-mute', muted: true }, own, own)).toBe(true);
    expect(hostMuteFrom({ type: 'dozer-mute', muted: false }, own, own)).toBe(false);
  });
  it('ignores other origins, other messages and malformed ones', () => {
    expect(hostMuteFrom({ type: 'dozer-mute', muted: true }, 'https://evil.test', own)).toBeNull();
    expect(hostMuteFrom({ type: 'other', muted: true }, own, own)).toBeNull();
    expect(hostMuteFrom({ type: 'dozer-mute', muted: 'yes' }, own, own)).toBeNull();
    expect(hostMuteFrom(null, own, own)).toBeNull();
    expect(hostMuteFrom('dozer-mute', own, own)).toBeNull();
  });
});

describe('followVisibility', () => {
  /** A fake context and a document whose `hidden` the test sets. */
  const setup = (state: AudioContextState, resumeOnShow = false) => {
    const c = {
      state,
      suspend: vi.fn(async () => {
        c.state = 'suspended';
      }),
      resume: vi.fn(async () => {
        c.state = 'running';
      }),
    };
    const doc = new EventTarget() as EventTarget & { hidden: boolean };
    doc.hidden = false;
    const stop = followVisibility(c, doc as unknown as Document, resumeOnShow);
    const show = async (visible: boolean): Promise<void> => {
      doc.hidden = !visible;
      doc.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    };
    return { c, show, stop };
  };
  it('suspends a running context while hidden and resumes it when shown', async () => {
    const { c, show } = setup('running');
    await show(false);
    expect(c.suspend).toHaveBeenCalledTimes(1);
    expect(c.state).toBe('suspended');
    await show(true);
    expect(c.resume).toHaveBeenCalledTimes(1);
    expect(c.state).toBe('running');
  });
  it('leaves a context that is still waiting for a gesture suspended', async () => {
    const { c, show } = setup('suspended');
    await show(false);
    await show(true);
    expect(c.suspend).not.toHaveBeenCalled();
    expect(c.resume).not.toHaveBeenCalled();
  });
  it('starts a context created while hidden once shown', async () => {
    const { c, show } = setup('suspended', true);
    await show(true);
    expect(c.resume).toHaveBeenCalledTimes(1);
  });
  it('stops following when disposed', async () => {
    const { c, show, stop } = setup('running');
    stop();
    await show(false);
    expect(c.suspend).not.toHaveBeenCalled();
  });
});
