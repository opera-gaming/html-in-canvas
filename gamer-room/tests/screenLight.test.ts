// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { RectAreaLight, Texture, Vector3, type WebGLRenderer } from 'three';
import { ScreenLight } from '../src/scene/ScreenLight';
import type { ScreenSurface } from '../src/screens/ScreenSurface';

function fakeRenderer() {
  return {
    getRenderTarget: vi.fn(() => null),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn(async () => undefined),
  } as unknown as WebGLRenderer & { render: ReturnType<typeof vi.fn> };
}
const surface = {
  rect: { center: new Vector3(1, 2, 3), normal: new Vector3(0, 0, 1), width: 0.6, height: 0.35 },
  texture: new Texture(),
} as unknown as ScreenSurface;

describe('ScreenLight', () => {
  it('staggers the first sample by offsetMs relative to the first update', () => {
    const r = fakeRenderer();
    const l = new ScreenLight(surface, r, 100);
    l.update(5000);
    expect(r.render).not.toHaveBeenCalled();
    l.update(5099);
    expect(r.render).not.toHaveBeenCalled();
    l.update(5100);
    expect(r.render).toHaveBeenCalledTimes(1);
  });
  it('samples on the first update when offsetMs is 0', () => {
    const r = fakeRenderer();
    new ScreenLight(surface, r, 0).update(5000);
    expect(r.render).toHaveBeenCalledTimes(1);
  });
  it('does not start a new sample while a readback is in flight', () => {
    const r = fakeRenderer();
    (r.readRenderTargetPixelsAsync as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
    const l = new ScreenLight(surface, r, 0);
    l.update(5000);
    l.update(5300);
    l.update(6000);
    expect(r.render).toHaveBeenCalledTimes(1);
  });
  it('has one screen-sized area light facing along the normal, no shadow caster', () => {
    const l = new ScreenLight(surface, fakeRenderer(), 0);
    expect(l.lights).toHaveLength(1);
    const area = l.lights[0] as RectAreaLight;
    expect(area.isRectAreaLight).toBe(true);
    expect(area.width).toBeCloseTo(0.6);
    expect(area.height).toBeCloseTo(0.35);
    expect(area.position.toArray()).toEqual([1, 2, 3.02].map((v) => expect.closeTo(v, 6)));
    // RectAreaLight emits along its local -Z.
    const forward = new Vector3(0, 0, -1).applyQuaternion(area.quaternion);
    expect(forward.dot(surface.rect.normal)).toBeCloseTo(1, 6);
  });
  it('tints both lights towards the sampled colour', async () => {
    const r = fakeRenderer();
    (r.readRenderTargetPixelsAsync as ReturnType<typeof vi.fn>).mockImplementation(
      async (_rt, _x, _y, _w, _h, px: Uint8Array) => {
        for (let i = 0; i < px.length; i += 4) {
          px[i] = 255;
          px[i + 1] = 0;
          px[i + 2] = 0;
          px[i + 3] = 255;
        } // pure red
      },
    );
    const l = new ScreenLight(surface, r, 0);
    l.update(5000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 1; i < 60; i++) l.update(5000 + i);
    for (const light of l.lights) {
      expect(light.color.r).toBeGreaterThan(0.9);
      expect(light.color.g).toBeLessThan(0.1);
    }
  });
});
