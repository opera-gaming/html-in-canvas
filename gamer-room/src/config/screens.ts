// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export interface ScreenDef {
  /** Element pixel size. If omitted, derived from the fitted rectangle's aspect. */
  width?: number;
  height?: number;
  /** Same-origin URL loaded in the screen's iframe. */
  src: string;
  /** Per-host replacement for src, e.g. when hosted on www.opera.com. */
  hostOverrides?: Record<string, string>;
}

/**
 * Pages with a WebGPU canvas to mirror into a 2D canvas (see screens/canvasMirror.ts), by URL path prefix, so a
 * `?content=` override gets the mirror too. Build the dozer into public/replicas/dozer to show it on a screen.
 */
const mirroredCanvases: Record<string, string> = {
  '/replicas/dozer/': 'canvas#view',
};

export function mirrorCanvasFor(src: string): string | undefined {
  const path = new URL(src, 'http://x').pathname;
  for (const [prefix, selector] of Object.entries(mirroredCanvases)) if (path.startsWith(prefix)) return selector;
  return undefined;
}

export const screens: Record<string, ScreenDef> = {
  // A build of ../dozer (see the README). The monitors' pages are not in the repo (third-party content): make local
  // copies with tools/snapshot-site.mjs, or the screens fall back to defaultScreen.
  arcade: { width: 960, height: 540, src: '/replicas/dozer/index.html' },
  monl: { width: 1280, height: 720, src: '/replicas/gxcorner/index.html' },
  monr: {
    width: 1680,
    height: 720,
    src: '/replicas/gx/index.html',
    hostOverrides: { 'www.opera.com': 'https://www.opera.com/gx' },
  },
};

export const defaultScreen: ScreenDef = { src: '/replicas/default/index.html' };

const MESH_RE = /^screen_([a-z0-9]+)(?:\.\d+)?$/i;

export function screenIdFromMeshName(name: string): string | null {
  const m = MESH_RE.exec(name);
  return m && m[1] ? (m[1].replace(/\d{3}$/, '') || m[1]).toLowerCase() : null;
}

export function getScreenDef(id: string): ScreenDef {
  return screens[id] ?? defaultScreen;
}

/**
 * Resolve a screen's iframe URL. A `?content=id:url` query override is only
 * honoured when `allowOverride` is true (dev builds) and the URL is http(s)
 * and same-origin as `origin`; anything else (javascript:, foreign hosts) is
 * ignored so the query string cannot inject arbitrary content.
 */
export function resolveSrc(
  def: ScreenDef,
  host: string,
  search: string,
  id: string,
  allowOverride = true,
  origin = '',
): string {
  if (allowOverride) {
    const params = new URLSearchParams(search);
    for (const v of params.getAll('content')) {
      const i = v.indexOf(':');
      if (i > 0 && v.slice(0, i) === id) {
        const candidate = v.slice(i + 1);
        let url: URL;
        try {
          url = new URL(candidate, origin);
        } catch {
          continue;
        }
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin) return candidate;
      }
    }
  }
  return def.hostOverrides?.[host] ?? def.src;
}

/** Pixel size for a screen of the given aspect: 720 rows for 16:9, min 320x240. */
export function defaultPixelSize(aspect: number): { width: number; height: number } {
  const height = 720; // always above the 240 minimum
  const width = Math.max(320, Math.round(height * aspect));
  return { width, height };
}
