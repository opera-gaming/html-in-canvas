// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { installShim, markDrawable } from '../src/compat/htmlInCanvas';

function fakeGl() {
  const calls: unknown[][] = [];
  const gl = {
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    UNSIGNED_BYTE: 0x1401,
    texImage2D: (...a: unknown[]) => calls.push(['texImage2D', ...a]),
    texElementSubImage2D: (...a: unknown[]) => calls.push(['texElementSubImage2D', ...a]),
  } as unknown as WebGL2RenderingContext & Record<string, unknown>;
  return { gl, calls };
}

describe('installShim', () => {
  it('does nothing when texElementImage2D already exists', () => {
    const native = vi.fn();
    const gl = { texElementImage2D: native } as unknown as WebGL2RenderingContext & Record<string, unknown>;
    installShim(gl, 'texElementImage2D');
    expect(gl.texElementImage2D).toBe(native);
  });

  it('defines a 3-arg texElementImage2D on top of texElementSubImage2D', () => {
    const { gl, calls } = fakeGl();
    installShim(gl, 'texElementSubImage2D');
    const fn = gl.texElementImage2D as (...a: unknown[]) => void;
    expect(fn.length).toBe(3);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 640 });
    Object.defineProperty(el, 'offsetHeight', { value: 480 });
    fn.call(gl, gl.TEXTURE_2D, gl.RGBA8, el);
    expect(calls[0]).toEqual(['texImage2D', gl.TEXTURE_2D, 0, gl.RGBA8, 640, 480, 0, gl.RGBA, gl.UNSIGNED_BYTE, null]);
    expect(calls[1]).toEqual(['texElementSubImage2D', gl.TEXTURE_2D, 0, 0, 0, el]);
  });
});

describe('markDrawable', () => {
  it('sets both generations of attributes', () => {
    const canvas = document.createElement('canvas');
    const el = document.createElement('div');
    markDrawable(canvas, el);
    expect(canvas.getAttribute('layoutsubtree')).toBe('true');
    expect(canvas.getAttribute('content')).toBe('drawable');
    expect(el.hasAttribute('drawable')).toBe(true);
  });
});
