#!/usr/bin/env node
// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/**
 * Save a static, same-origin copy of a live page for a room screen (HTML-in-Canvas does not paint
 * cross-origin content). Scripts are stripped, so the copy is a still frame that never repaints.
 *
 * Usage: node tools/snapshot-site.mjs [--gx] <url> <outDir> [width] [height]
 *   --gx  stub Opera GX's browser APIs (gx-browser-stub.js) and apply GX's dark palette; for GX Corner.
 * Replaces <outDir> with index.html + assets/.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const gx = args.includes('--gx');
const [url, outDir, width = '1280', height = '720'] = args.filter((a) => !a.startsWith('--'));
if (!url || !outDir) {
  console.error('usage: snapshot-site.mjs <url> <outDir> [width] [height]');
  process.exit(1);
}
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: +width, height: +height },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' +
    (gx ? ' OPR/120.0.0.0' : ''),
  locale: 'en-US',
  colorScheme: 'dark',
});
if (gx)
  await context.addInitScript(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'gx-browser-stub.js'), 'utf8'),
  );
const page = await context.newPage();

// Keep every response body; most assets are then saved without a second download.
const bodies = new Map();
page.on('response', async (res) => {
  if (res.status() !== 200) return;
  try {
    bodies.set(res.url(), { body: await res.body(), type: res.headers()['content-type'] ?? '' });
  } catch {
    /* redirects, aborted */
  }
});

await page
  .goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  .catch(() => console.warn('[snapshot] network never went idle; continuing'));

// Accept or remove cookie banners so they are not baked into the copy.
for (const sel of [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
]) {
  const b = await page.$(sel);
  if (b && (await b.isVisible())) {
    await b.click().catch(() => {});
    await page.waitForTimeout(500);
    break;
  }
}

// Note where scrolled containers (carousels) sit, before the scroll pass below disturbs them.
await page.evaluate(() => {
  for (const el of document.body.querySelectorAll('*')) {
    if (el.scrollLeft || el.scrollTop) el.setAttribute('data-snap-scroll', `${el.scrollLeft},${el.scrollTop}`);
  }
});

// Scroll through the page so lazy images and scroll-triggered reveals load, then back to the top.
await page.evaluate(async () => {
  const step = innerHeight * 0.8;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 250));
  }
  scrollTo(0, 0);
  for (const el of document.querySelectorAll('[data-snap-scroll]')) {
    const [x, y] = el.dataset.snapScroll.split(',');
    el.scrollTo({ left: +x, top: +y, behavior: 'instant' });
  }
});
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

// GX injects its theme palette as --color-* variables; the page ships a dark default as
// --color-*-mock. Map those across and give the page GX's background.
if (gx)
  await page.evaluate(() => {
    const vars = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of rules)
        if (r.selectorText === ':root')
          for (const p of r.style) if (p.endsWith('-mock')) vars.push(`${p.slice(0, -5)}:var(${p});`);
    }
    const s = document.createElement('style');
    s.textContent = `:root{${vars.join('')}}html{background:var(--color-secondary-08-mock,#120f19)}`;
    document.head.appendChild(s);
  });

// Freeze the live DOM into static markup with absolute URLs.
const html = await page.evaluate(() => {
  const abs = (u) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return u;
    }
  };
  const cssText = (sheet) => {
    try {
      return [...sheet.cssRules].map((r) => r.cssText).join('\n');
    } catch {
      return null;
    }
  };

  // CSS-in-JS libraries insert rules through the CSSOM, which outerHTML does not show.
  for (const s of document.querySelectorAll('style')) {
    const t = s.sheet && cssText(s.sheet);
    if (t !== null && t !== undefined && t.length > s.textContent.length) s.textContent = t;
  }
  if (document.adoptedStyleSheets?.length) {
    const s = document.createElement('style');
    s.textContent = document.adoptedStyleSheets.map(cssText).filter(Boolean).join('\n');
    document.head.appendChild(s);
  }
  // Pin each image to the source the browser actually chose, and load it eagerly.
  for (const img of document.querySelectorAll('img')) {
    if (img.currentSrc) img.setAttribute('src', img.currentSrc);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('loading');
  }
  for (const s of document.querySelectorAll('picture source')) s.remove();
  for (const v of document.querySelectorAll('video')) {
    const src = v.currentSrc;
    for (const s of v.querySelectorAll('source')) s.remove();
    if (src && !src.startsWith('blob:')) v.setAttribute('src', src);
    else v.removeAttribute('src');
    v.setAttribute('autoplay', '');
    v.setAttribute('muted', '');
    v.setAttribute('loop', '');
    v.setAttribute('playsinline', '');
  }
  document
    .querySelectorAll(
      'script, noscript, iframe, object, embed, link[rel=preload], link[rel=modulepreload], link[rel=prefetch], link[rel=preconnect], link[rel=dns-prefetch], link[rel=manifest], meta[http-equiv]',
    )
    .forEach((e) => e.remove());
  for (const el of document.querySelectorAll('[src]')) el.setAttribute('src', abs(el.getAttribute('src')));
  for (const el of document.querySelectorAll('[poster]')) el.setAttribute('poster', abs(el.getAttribute('poster')));
  for (const el of document.querySelectorAll('link[href]')) el.setAttribute('href', abs(el.getAttribute('href')));
  for (const el of document.querySelectorAll('a[href]')) el.setAttribute('href', abs(el.getAttribute('href')));
  for (const el of document.querySelectorAll('[style]')) {
    // Unquoted, so the serialised attribute has no &quot; for the asset rewriter to trip over.
    el.setAttribute(
      'style',
      el
        .getAttribute('style')
        .replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => (u.startsWith('data:') ? m : `url(${abs(u)})`)),
    );
  }
  for (const s of document.querySelectorAll('style')) {
    s.textContent = s.textContent.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) =>
      u.startsWith('data:') ? m : `url(${q}${abs(u)}${q})`,
    );
  }
  // Scroll offsets are not part of the markup; record them for the restore script below.
  for (const el of document.body.querySelectorAll('*')) {
    if (el.scrollLeft || el.scrollTop) el.setAttribute('data-snap-scroll', `${el.scrollLeft},${el.scrollTop}`);
  }
  // Inline event handlers would reference the removed scripts.
  for (const el of document.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (a.name.startsWith('on')) el.removeAttribute(a.name);
  }
  return '<!doctype html>\n' + document.documentElement.outerHTML;
});
await browser.close();

// ---- Localise assets ----
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'assets'), { recursive: true });

const EXT = {
  'text/css': 'css',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};
const saved = new Map(); // absolute url -> local file name (or null when it could not be fetched)
let total = 0;

async function fetchAsset(u) {
  if (bodies.has(u)) return bodies.get(u);
  const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/152' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
}

/** Download `u` into assets/ and return its file name, or null to leave the reference as is. */
async function localise(u) {
  if (!/^https?:/.test(u)) return null;
  if (saved.has(u)) return saved.get(u);
  saved.set(u, null); // breaks @import cycles
  let asset;
  try {
    asset = await fetchAsset(u);
  } catch (e) {
    console.warn(`[snapshot] skip ${u}: ${e.message}`);
    return null;
  }
  if (asset.body.length > MAX_ASSET_BYTES) {
    console.warn(`[snapshot] skip ${u}: ${(asset.body.length / 1e6).toFixed(1)} MB`);
    return null;
  }
  const mime = asset.type.split(';')[0].trim();
  const ext = EXT[mime] ?? new URL(u).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'bin';
  const name = createHash('sha1').update(u).digest('hex').slice(0, 16) + '.' + ext;
  saved.set(u, name);
  let body = asset.body;
  if (ext === 'css') body = Buffer.from(await rewriteCss(body.toString('utf8'), u, ''));
  writeFileSync(join(outDir, 'assets', name), body);
  total += body.length;
  return name;
}

/** Rewrite url() and @import references in CSS, resolved against `base`, to `<prefix><local name>`. */
async function rewriteCss(css, base, prefix) {
  const refs = new Set();
  for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) refs.add(m[2]);
  for (const m of css.matchAll(/@import\s+(['"])([^'"]+)\1/g)) refs.add(m[2]);
  const map = new Map();
  for (const r of refs) {
    if (r.startsWith('data:') || r.startsWith('#')) continue;
    // In HTML (style attributes) '&' is serialised as &amp;.
    let a;
    try {
      a = new URL(r.replaceAll('&amp;', '&'), base).href;
    } catch {
      continue;
    }
    const name = await localise(a);
    if (name) map.set(r, prefix + name);
  }
  return css
    .replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, r) => (map.has(r) ? `url(${q}${map.get(r)}${q})` : m))
    .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, r) => (map.has(r) ? `@import ${q}${map.get(r)}${q}` : m));
}

let out = html;
// Stylesheets, images, video, posters and icons referenced from attributes.
const attrRefs = new Set();
for (const m of out.matchAll(/<link\b[^>]*\brel="(?:stylesheet|icon|shortcut icon|apple-touch-icon)"[^>]*>/g)) {
  const h = m[0].match(/\bhref="([^"]+)"/);
  if (h) attrRefs.add(h[1]);
}
for (const m of out.matchAll(/\b(?:src|poster)="([^"]+)"/g)) attrRefs.add(m[1]);
const attrMap = new Map();
for (const r of attrRefs) {
  const name = await localise(r.replaceAll('&amp;', '&'));
  if (name) attrMap.set(r, 'assets/' + name);
}
out = out.replace(/\b(href|src|poster)="([^"]+)"/g, (m, a, r) => (attrMap.has(r) ? `${a}="${attrMap.get(r)}"` : m));
// url() in <style> blocks and style attributes.
out = await rewriteCss(out, url, 'assets/');
// Remaining <link> tags that point off-site (alternate, canonical...) are harmless; stylesheets that
// failed to download are dropped so the iframe never requests another origin.
out = out.replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="https?:[^"]*"[^>]*>/g, '');
// Links must not navigate the screen's iframe; restore scrolled containers (carousels).
out = out.replace(
  '</body>',
  `<script>addEventListener('click',(e)=>{if(e.target.closest('a,form button,[type=submit]'))e.preventDefault()},true);
for(const el of document.querySelectorAll('[data-snap-scroll]')){const[x,y]=el.dataset.snapScroll.split(',');el.scrollTo({left:+x,top:+y,behavior:'instant'})}</script>\n</body>`,
);
writeFileSync(join(outDir, 'index.html'), out);

const offsite = [...out.matchAll(/\b(?:src|poster)="(https?:[^"]+)"/g)].map((m) => m[1]);
console.log(
  `[snapshot] ${url} -> ${outDir}/index.html, ${[...saved.values()].filter(Boolean).length} assets, ${(total / 1e6).toFixed(1)} MB`,
);
if (offsite.length)
  console.warn(`[snapshot] ${offsite.length} references still off-site (not painted):`, offsite.slice(0, 5));
