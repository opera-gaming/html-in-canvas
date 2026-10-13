// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Texture, WebGLRenderer } from 'three';
import { createPaintGate } from '../src/app/paintGate';

function surface(id: string) {
  return { id, element: document.createElement('div'), texture: { needsUpdate: false } as unknown as Texture };
}

afterEach(() => vi.restoreAllMocks());

describe('createPaintGate', () => {
  it('opens once every element has been painted', () => {
    const canvas = document.createElement('canvas');
    const renderer = { initTexture: vi.fn() } as unknown as WebGLRenderer;
    const a = surface('monl');
    const gate = createPaintGate(canvas, renderer, [a], 1e9);
    expect(gate.ready()).toBe(false);
    const ev = new Event('paint') as Event & { changedElements: Element[] };
    ev.changedElements = [a.element];
    canvas.dispatchEvent(ev);
    expect(renderer.initTexture).toHaveBeenCalledWith(a.texture);
    expect(gate.ready()).toBe(true);
  });

  it('on timeout flags unseen textures for upload and names them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const canvas = document.createElement('canvas');
    const renderer = { initTexture: vi.fn() } as unknown as WebGLRenderer;
    const a = surface('monl');
    const b = surface('arcade');
    const gate = createPaintGate(canvas, renderer, [a, b], 100);
    const ev = new Event('paint') as Event & { changedElements: Element[] };
    ev.changedElements = [a.element];
    canvas.dispatchEvent(ev);
    a.texture.needsUpdate = false;
    now.mockReturnValue(500);
    expect(gate.ready()).toBe(true);
    expect(b.texture.needsUpdate).toBe(true);
    expect(a.texture.needsUpdate).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('arcade');
    expect(String(warn.mock.calls[0]![0])).not.toContain('monl');
  });

  describe('upload throttling once open', () => {
    function setup() {
      const now = vi.spyOn(performance, 'now').mockReturnValue(0);
      const requestPaint = vi.fn();
      const canvas = Object.assign(document.createElement('canvas'), { requestPaint });
      const renderer = { initTexture: vi.fn() } as unknown as WebGLRenderer & { initTexture: ReturnType<typeof vi.fn> };
      const a = surface('monl');
      const b = surface('monr');
      const gate = createPaintGate(canvas, renderer, [a, b], 1e9, 66);
      const paint = (...els: Element[]) => {
        const ev = new Event('paint') as Event & { changedElements: Element[] };
        ev.changedElements = els;
        canvas.dispatchEvent(ev);
      };
      paint(a.element, b.element); // first upload of each screen is never throttled
      expect(gate.ready()).toBe(true);
      renderer.initTexture.mockClear();
      requestPaint.mockClear();
      return { now, requestPaint, renderer, a, b, gate, paint };
    }

    it('holds background screens back until the interval has passed', () => {
      const { now, renderer, a, paint } = setup();
      now.mockReturnValue(30);
      paint(a.element);
      expect(renderer.initTexture).not.toHaveBeenCalled();
      now.mockReturnValue(70);
      paint();
      expect(renderer.initTexture).toHaveBeenCalledWith(a.texture);
    });

    it('uploads at most one background screen per paint and asks for another paint', () => {
      const { now, requestPaint, renderer, a, b, paint } = setup();
      now.mockReturnValue(100);
      paint(a.element, b.element);
      expect(renderer.initTexture).toHaveBeenCalledTimes(1);
      expect(requestPaint).toHaveBeenCalled();
      paint();
      expect(renderer.initTexture).toHaveBeenCalledTimes(2);
      expect(renderer.initTexture.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([a.texture, b.texture]));
    });

    it('uploads the priority screen on every paint', () => {
      const { now, renderer, a, b, gate, paint } = setup();
      gate.setPriority(b.element);
      for (const t of [10, 20, 30]) {
        now.mockReturnValue(t);
        paint(b.element);
      }
      expect(renderer.initTexture).toHaveBeenCalledTimes(3);
      gate.setPriority(null);
      now.mockReturnValue(40);
      paint(b.element);
      expect(renderer.initTexture).toHaveBeenCalledTimes(3);
    });
  });
});
