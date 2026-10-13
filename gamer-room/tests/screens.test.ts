// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import {
  screenIdFromMeshName,
  getScreenDef,
  resolveSrc,
  defaultPixelSize,
  defaultScreen,
  mirrorCanvasFor,
} from '../src/config/screens';

describe('screenIdFromMeshName', () => {
  it('extracts and lowercases the id', () => {
    expect(screenIdFromMeshName('Screen_Arcade')).toBe('arcade');
    expect(screenIdFromMeshName('screen_MonL')).toBe('monl');
  });
  it('strips Blender duplicate suffixes', () => {
    expect(screenIdFromMeshName('Screen_Arcade.001')).toBe('arcade');
    expect(screenIdFromMeshName('Screen_Arcade001')).toBe('arcade'); // GLTFLoader strips the dot
  });
  it('returns null for non-screen meshes', () => {
    expect(screenIdFromMeshName('Desk')).toBeNull();
    expect(screenIdFromMeshName('Screenshot')).toBeNull();
  });
});

describe('getScreenDef', () => {
  it('falls back to defaultScreen for unknown ids', () => {
    expect(getScreenDef('nope')).toBe(defaultScreen);
  });
  it('returns configured screens', () => {
    expect(getScreenDef('arcade').src).toBe('/replicas/dozer/index.html');
  });
});

describe('resolveSrc', () => {
  const def = { src: '/replicas/opera/index.html', hostOverrides: { 'www.opera.com': 'https://www.opera.com/' } };
  it('uses src by default', () => {
    expect(resolveSrc(def, 'localhost:5173', '', 'monl')).toBe('/replicas/opera/index.html');
  });
  it('uses the host override when the host matches', () => {
    expect(resolveSrc(def, 'www.opera.com', '', 'monl')).toBe('https://www.opera.com/');
  });
  const origin = 'http://localhost:5173';
  it('lets a same-origin ?content=id:url override everything', () => {
    expect(resolveSrc(def, 'www.opera.com', '?content=monl:/x/&content=monr:/y/', 'monl', true, origin)).toBe('/x/');
    expect(resolveSrc(def, 'www.opera.com', '?content=monr:/y/', 'monl', true, origin)).toBe('https://www.opera.com/');
    expect(resolveSrc(def, 'localhost:5173', '?content=monl:http://localhost:5173/z/', 'monl', true, origin)).toBe(
      'http://localhost:5173/z/',
    );
  });
  it('ignores javascript: overrides', () => {
    expect(resolveSrc(def, 'localhost:5173', '?content=monl:javascript:alert(1)', 'monl', true, origin)).toBe(
      '/replicas/opera/index.html',
    );
  });
  it('ignores cross-origin overrides', () => {
    expect(resolveSrc(def, 'localhost:5173', '?content=monl:https://evil.example/', 'monl', true, origin)).toBe(
      '/replicas/opera/index.html',
    );
  });
  it('ignores overrides when allowOverride is false', () => {
    expect(resolveSrc(def, 'localhost:5173', '?content=monl:/x/', 'monl', false, origin)).toBe(
      '/replicas/opera/index.html',
    );
  });
});

it('keeps screen, fallback and music URLs under the production base', async () => {
  vi.stubEnv('BASE_URL', '/html-in-canvas/');
  vi.resetModules();
  try {
    const { screens, defaultScreen, mirrorCanvasFor, resolveSrc } = await import('../src/config/screens');
    const { musicSrc } = await import('../src/config/audio');
    for (const def of [...Object.values(screens), defaultScreen]) {
      expect(def.src).toMatch(/^\/html-in-canvas\/replicas\//);
    }
    const arcade = resolveSrc(screens.arcade!, 'localhost', '', 'arcade');
    expect(arcade).toBe('/html-in-canvas/replicas/dozer/index.html');
    expect(mirrorCanvasFor(arcade)).toBe('canvas#view');
    expect(mirrorCanvasFor(`https://example.com${arcade}?x=1`)).toBe('canvas#view');
    expect(mirrorCanvasFor('/html-in-canvas/replicas/dozerish/index.html')).toBeUndefined();
    expect(musicSrc).toBe('/html-in-canvas/audio/1000 Handz - Statik.mp3');
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

describe('defaultPixelSize', () => {
  it('derives 16:9 as 1280x720', () => {
    expect(defaultPixelSize(16 / 9)).toEqual({ width: 1280, height: 720 });
  });
  it('clamps tiny screens to at least 320x240-ish', () => {
    const s = defaultPixelSize(4 / 3);
    expect(s.width).toBeGreaterThanOrEqual(320);
    expect(s.height).toBeGreaterThanOrEqual(240);
  });
});

describe('mirrorCanvasFor', () => {
  it('mirrors the dozer canvas, by path prefix', () => {
    expect(mirrorCanvasFor('/replicas/dozer/index.html')).toBe('canvas#view');
    expect(mirrorCanvasFor('http://localhost:5174/replicas/dozer/index.html?x=1')).toBe('canvas#view');
  });
  it('leaves other pages alone', () => {
    expect(mirrorCanvasFor('/replicas/gxcorner/index.html')).toBeUndefined();
    expect(mirrorCanvasFor('/replicas/dozerish/index.html')).toBeUndefined();
  });
});
