// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { captureOrder, readCaptureFaults, runCaptureAttempts, type CaptureStrategy } from '../src/capture';
import { mipLevelsFor } from '../src/gpu/mips';

describe('captureOrder', () => {
  it('keeps the detected order, or moves a forced strategy first', () => {
    expect(captureOrder(['gpu-copy', '2d-draw'], null)).toEqual(['gpu-copy', '2d-draw']);
    expect(captureOrder(['gpu-copy', '2d-draw'], '2d-draw')).toEqual(['2d-draw', 'gpu-copy']);
    expect(captureOrder(['gpu-copy'], '2d-draw')).toEqual(['gpu-copy']);
  });
});

describe('runCaptureAttempts', () => {
  const ok = (v: string) => ({ ok: true as const, value: v });
  const blank = { ok: false as const, blank: true as const };

  it('returns the first success without trying the rest', async () => {
    const tried: CaptureStrategy[] = [];
    const r = await runCaptureAttempts(['gpu-copy', '2d-draw'], async (s) => (tried.push(s), ok(s)));
    expect(r).toEqual({ ok: true, strategy: 'gpu-copy', value: 'gpu-copy', failures: [] });
    expect(tried).toEqual(['gpu-copy']);
  });
  it('falls back to the next strategy when one throws', async () => {
    const r = await runCaptureAttempts(['gpu-copy', '2d-draw'], async (s) => {
      if (s === 'gpu-copy') throw new Error('validation failed');
      return ok(s);
    });
    expect(r.ok && r.strategy).toBe('2d-draw');
    expect(r.failures).toEqual(['gpu-copy: validation failed']);
  });
  it('falls back once when a capture is blank', async () => {
    const r = await runCaptureAttempts(['gpu-copy', '2d-draw'], async (s) => (s === 'gpu-copy' ? blank : ok(s)));
    expect(r.ok && r.strategy).toBe('2d-draw');
    expect(r.failures).toEqual(['gpu-copy: the captured image was empty']);
  });
  it('reports blank when every path fails and at least one was blank', async () => {
    const r = await runCaptureAttempts(['gpu-copy', '2d-draw'], async (s) => {
      if (s === '2d-draw') throw new Error('boom');
      return blank;
    });
    expect(r).toEqual({
      ok: false,
      blank: true,
      failures: ['gpu-copy: the captured image was empty', '2d-draw: boom'],
    });
  });
  it('reports a plain failure when every path throws', async () => {
    const r = await runCaptureAttempts(['gpu-copy'], async () => {
      throw new Error('nope');
    });
    expect(r).toEqual({ ok: false, blank: false, failures: ['gpu-copy: nope'] });
  });
});

describe('readCaptureFaults', () => {
  it('is inert without debug', () => {
    const f = readCaptureFaults('?capfail=gpu-copy&capblank=all');
    expect(f.fail.size + f.blank.size).toBe(0);
  });
  it('parses single strategies and all', () => {
    const f = readCaptureFaults('?debug&capfail=gpu-copy&capblank=all');
    expect([...f.fail]).toEqual(['gpu-copy']);
    expect([...f.blank].sort()).toEqual(['2d-draw', 'gpu-copy']);
    expect(readCaptureFaults('?debug&capfail=bogus').fail.size).toBe(0);
  });
});

it('mipLevelsFor counts levels down to 1×1', () => {
  expect(mipLevelsFor(4096)).toBe(13);
  expect(mipLevelsFor(6144)).toBe(13); // TEX_SIZE: 6144 → 3072 → … → 3 → 1
  expect(mipLevelsFor(3072)).toBe(12); // BG_TEX_SIZE
  expect(mipLevelsFor(1)).toBe(1);
});
