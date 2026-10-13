// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';
import { buildPage, setCaptureMode } from '../src/page/page';
import { ARTICLES } from '../src/page/content';
import pageCss from '../src/page/page.css?raw';
import { PAGE_SIZE } from '../src/config';
import { OBJECT_SELECTOR } from '../src/extract';

afterEach(() => {
  document.body.replaceChildren();
});

it('builds a PAGE_SIZE page root with enough text', () => {
  const root = buildPage(document.body);
  expect(root.classList.contains('dz-page')).toBe(true);
  expect(root.hasAttribute('drawable')).toBe(true);
  // jsdom has no layout, so the briefs that top up the columns are not added here.
  const words = (root.textContent ?? '').split(/\s+/).filter(Boolean).length;
  expect(words).toBeGreaterThan(2500);
  expect(root.querySelectorAll('svg').length).toBeGreaterThanOrEqual(8);
  expect(root.querySelector('button')).not.toBeNull();
});

it('toggles capture classes exclusively', () => {
  const root = buildPage(document.body);
  setCaptureMode(root, 'content');
  expect(root.className).toContain('capture-content');
  setCaptureMode(root, 'background');
  expect(root.className).not.toContain('capture-content');
  expect(root.className).toContain('capture-background');
  setCaptureMode(root, 'normal');
  expect(root.className).toBe('dz-page');
});

it('has the required page structure', () => {
  const root = buildPage(document.body);
  expect(root.style.width).toBe(`${PAGE_SIZE}px`);
  expect(root.style.height).toBe(`${PAGE_SIZE}px`);
  // Opera product page on top: logo, hero, the intro's lane, the 30-years image.
  expect(root.querySelector('.op-bar .op-logo')?.textContent).toBe('Opera');
  expect(root.querySelector('.op-bar img')).toBeNull();
  expect(root.querySelector('.op-h1')?.textContent).toContain('HTML in Canvas');
  expect(root.querySelectorAll('[data-intro-lane]')).toHaveLength(1);
  expect(root.querySelector('img.op-studio')?.getAttribute('src')).toMatch(/page\/opera-30-years\.jpg$/);
  expect(root.querySelectorAll('.op-feature')).toHaveLength(6);
  expect(root.querySelectorAll('.op-quote')).toHaveLength(3);
  expect(root.querySelectorAll('.op-faq-list dt').length).toBeGreaterThanOrEqual(4);
  // Plenty of real form controls.
  expect(root.querySelectorAll('select').length).toBeGreaterThanOrEqual(10);
  expect(root.querySelectorAll('input[type="radio"]').length).toBeGreaterThanOrEqual(8);
  expect(root.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(10);
  for (const t of ['text', 'email', 'search', 'number', 'date', 'color', 'range']) {
    expect(root.querySelector(`input[type="${t}"]`), t).not.toBeNull();
  }
  expect(root.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(4);
  expect(root.querySelector('textarea')).not.toBeNull();
  expect(root.querySelectorAll('progress').length).toBeGreaterThanOrEqual(2);
  expect(root.querySelectorAll('meter').length).toBeGreaterThanOrEqual(2);
  expect(root.querySelectorAll('fieldset > legend').length).toBeGreaterThanOrEqual(3);
  expect(root.querySelectorAll('.op-switch').length).toBeGreaterThanOrEqual(6);
  expect(root.querySelectorAll('button').length).toBeGreaterThanOrEqual(20);
  // News section: the five photo stories, each with its image and a caption.
  const photos = root.querySelectorAll('.dz-photo');
  expect(photos).toHaveLength(5);
  expect([...photos].map((c) => c.className.match(/dz-photo-(\w+)/)?.[1])).toEqual([
    'opera30',
    'tram',
    'duck',
    'buns',
    'steven',
  ]);
  for (const card of photos) {
    expect(card.querySelector('h2')?.textContent).toBeTruthy();
    // The Opera at 30 story is text only; its photo is up in the product page.
    if (card.classList.contains('dz-photo-opera30')) {
      expect(card.querySelector('img')).toBeNull();
      continue;
    }
    expect(card.querySelector('img')?.getAttribute('src')).toMatch(/page\/[\w-]+\.jpg$/);
    expect(card.querySelector('.dz-caption')?.textContent).toBeTruthy();
  }
  expect(root.querySelector('.dz-photo-steven img')?.getAttribute('src')).toMatch(/page\/steven\.jpg$/);
  expect(root.querySelector('.dz-photo-steven .dz-caption')?.textContent).toMatch(/Steven/);
  expect(root.querySelectorAll('.dz-nav > button').length).toBeGreaterThanOrEqual(8);
  expect(root.querySelectorAll('.dz-col .dz-card')).toHaveLength(10);
  for (const card of root.querySelectorAll('.dz-col .dz-card')) {
    expect(card.querySelector('h2, h3')?.textContent).toBeTruthy();
    expect(card.querySelector('.dz-byline')).not.toBeNull();
    expect(card.querySelector('p')).not.toBeNull();
  }
  expect(root.querySelectorAll('.dz-poll input[type="radio"]').length).toBeGreaterThanOrEqual(3);
  expect(root.querySelector('.dz-poll button')).not.toBeNull();
  expect(root.querySelector('.dz-newsletter input')).not.toBeNull();
  expect(root.querySelector('.dz-weather svg')).not.toBeNull();
  expect(root.querySelectorAll('.dz-mostread li').length).toBeGreaterThanOrEqual(5);
  expect(root.querySelectorAll('.dz-footer ul').length).toBeGreaterThanOrEqual(4);
  expect(root.querySelector('.dz-copy')?.textContent).toBe('Stories on this page are made up for a tech demo.');
});

it('names no real people in the stories', () => {
  const root = buildPage(document.body);
  const text = root.textContent ?? '';
  expect(text).not.toMatch(/Möller|Wium Lie|Boilesen|Song Lin/);
});

it('makes every form control a single object body', () => {
  const root = buildPage(document.body);
  // Each control matches OBJECT_SELECTOR itself or sits inside a label that does (radio/checkbox/switch + text).
  for (const c of root.querySelectorAll('input, select, textarea, progress, meter, button')) {
    expect(c.matches(OBJECT_SELECTOR) || c.closest('label')?.matches(OBJECT_SELECTOR), c.outerHTML.slice(0, 60)).toBe(
      true,
    );
  }
  for (const l of root.querySelectorAll('.op-choice, .op-switch')) expect(l.matches(OBJECT_SELECTOR)).toBe(true);
  // Plain <label for> captions are words, not objects.
  expect(root.querySelector('label.op-label')!.matches(OBJECT_SELECTOR)).toBe(false);
});

/** Selector lists of the page.css rules that declare `prop: value !important`. */
function selectorsFor(prop: string, value: string): string[] {
  const decl = new RegExp(`(?<![-\\w])${prop}\\s*:\\s*${value}\\s*!important`);
  const css = pageCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (decl.test(m[2]!)) out.push(m[1]!.trim());
  }
  return out;
}

it('content pass strips boxes but keeps objects (buttons, inputs, hr, tagged)', () => {
  const sel = selectorsFor('background', 'transparent');
  expect(sel).toHaveLength(1);
  const rule = sel[0]!;
  expect(rule).toMatch(/capture-content\s*\*:not\([^)]*button[^)]*\)/);
  expect(rule).toMatch(/:not\([^)]*input/);

  const root = buildPage(document.body);
  const tagged = document.createElement('div');
  tagged.setAttribute('data-dozer-object', '');
  const taggedChild = tagged.appendChild(document.createElement('span'));
  root.append(tagged);
  setCaptureMode(root, 'content');
  const strips = (e: Element): boolean => e.matches(rule);
  expect(strips(root)).toBe(true);
  expect(strips(root.querySelector('.dz-card')!)).toBe(true);
  expect(strips(root.querySelector('.dz-widget')!)).toBe(true);
  for (const e of root.querySelectorAll('button, input, select, textarea, progress, meter, .op-switch, .op-choice'))
    expect(strips(e)).toBe(false);
  expect(strips(tagged)).toBe(false);
  expect(strips(taggedChild)).toBe(false);
  setCaptureMode(root, 'normal');
  expect(strips(root.querySelector('.dz-card')!)).toBe(false);
});

it('background pass hides text and objects', () => {
  const hide = selectorsFor('visibility', 'hidden');
  expect(hide).toHaveLength(1);
  const clear = selectorsFor('color', 'transparent');
  expect(clear).toHaveLength(1);
  expect(clear[0]).toContain('::before');

  const root = buildPage(document.body);
  setCaptureMode(root, 'background');
  const hidden = (e: Element): boolean => e.matches(hide[0]!);
  for (const e of root.querySelectorAll('button, input, svg, img, select, textarea, progress, meter, .op-switch'))
    expect(hidden(e)).toBe(true);
  expect(hidden(root.querySelector('.dz-card')!)).toBe(false);
  expect(root.querySelector('.dz-body')!.matches(clear[0]!)).toBe(true);
  setCaptureMode(root, 'content');
  expect(hidden(root.querySelector('button')!)).toBe(false);
});

it('has 50+ articles of 80–160 words including long words for fracture', () => {
  expect(ARTICLES.length).toBeGreaterThanOrEqual(50);
  for (const a of ARTICLES) {
    const n = a.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
    expect(n).toBeGreaterThanOrEqual(80);
    expect(n).toBeLessThanOrEqual(160);
  }
  const all = ARTICLES.map((a) => a.paragraphs.join(' '))
    .join(' ')
    .toLowerCase();
  for (const w of ['Incomprehensibilities', 'Counterrevolutionaries', 'Supercalifragilistic', 'Photosynthesizing']) {
    expect(all).toContain(w.toLowerCase());
  }
});
