// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// The top of the page: an Opera product page announcing HTML-in-Canvas, with a large "Configure your canvas" form and
// a playground full of real form controls (each one a single pushable body, extract.ts OBJECT_SELECTOR).
import { el, svgEl } from './art';
import { CODE_SAMPLE, FAQ, FEATURES, HERO, NAV_LINKS, QUOTES, RELEASE_NOTES } from './opera';

let uid = 0;
/** Unique ids so <label for> works even when the page is built more than once (capture fallback). */
const nextId = (stem: string): string => `op-${stem}-${uid++}`;

function img(src: string, cls: string, w: number, h: number, alt: string): HTMLImageElement {
  const i = el('img', cls);
  i.src = src;
  i.width = w;
  i.height = h;
  i.alt = alt;
  i.decoding = 'sync';
  return i;
}

function button(text: string, cls = 'op-btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

/** A labelled field: a <label for> caption (plain words) above the control (one body). */
function field(caption: string, control: HTMLElement, cls = 'op-field'): HTMLElement {
  const wrap = el('div', cls);
  const id = nextId('f');
  control.id = id;
  const label = el('label', 'op-label', caption);
  label.htmlFor = id;
  wrap.append(label, control);
  return wrap;
}

function input(type: string, value?: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = el('input', 'op-input');
  i.type = type;
  if (value !== undefined) i.value = value;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  if (type === 'range') i.className = 'op-range';
  if (type === 'color') i.className = 'op-color';
  return i;
}

function select(options: string[], chosen = 0): HTMLSelectElement {
  const s = el('select', 'op-select');
  options.forEach((o, i) => {
    const opt = el('option', '', o);
    if (i === chosen) opt.selected = true;
    s.append(opt);
  });
  return s;
}

/** A radio or checkbox with its text, wrapped in one label (one body). */
function choice(type: 'radio' | 'checkbox', name: string, text: string, checked = false): HTMLLabelElement {
  const l = el('label', `op-choice op-${type}`);
  const i = el('input');
  i.type = type;
  i.name = name;
  i.checked = checked;
  l.append(i, document.createTextNode(` ${text}`));
  return l;
}

/** A toggle switch: a hidden checkbox plus the drawn track, wrapped in one label (one body). */
function toggle(text: string, on: boolean): HTMLLabelElement {
  const l = el('label', 'op-switch');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = on;
  l.append(i, el('span', 'op-track'), document.createTextNode(text));
  return l;
}

function radioGroup(title: string, name: string, options: string[], chosen: number): HTMLElement {
  const g = el('div', 'op-group');
  g.append(el('div', 'op-label', title));
  const row = el('div', 'op-choices');
  options.forEach((o, i) => row.append(choice('radio', name, o, i === chosen)));
  g.append(row);
  return g;
}

function fieldset(legend: string, ...children: HTMLElement[]): HTMLFieldSetElement {
  const f = el('fieldset', 'op-fieldset');
  f.append(el('legend', 'op-legend', legend), ...children);
  return f;
}

function meterRow(caption: string, m: HTMLProgressElement | HTMLMeterElement, readout: string): HTMLElement {
  const row = el('div', 'op-meter-row');
  const id = nextId('m');
  m.id = id;
  const label = el('label', 'op-label', caption);
  label.htmlFor = id;
  row.append(label, m, el('span', 'op-readout', readout));
  return row;
}

function progress(value: number): HTMLProgressElement {
  const p = el('progress', 'op-progress');
  p.max = 100;
  p.value = value;
  return p;
}

function meter(value: number, low: number, high: number, optimum: number): HTMLMeterElement {
  const m = el('meter', 'op-meter');
  Object.assign(m, { min: 0, max: 1, low, high, optimum, value });
  return m;
}

const ICONS: Record<string, string> = {
  live: 'M4 6h16v12H4z M8 10h8 M8 14h5',
  gpu: 'M5 7h14v10H5z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M9 11h6v2H9z',
  a11y: 'M12 4a2 2 0 1 0 0.01 0 M5 9h14 M12 9v5 M9 21l3-7 3 7',
  hand: 'M8 13V6a1.5 1.5 0 0 1 3 0v5 M11 11V4.5a1.5 1.5 0 0 1 3 0V11 M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.4-1.8L8 14',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  lock: 'M6 11h12v10H6z M9 11V8a3 3 0 0 1 6 0v3',
};

function icon(kind: string): SVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: 44, height: 44, class: 'op-icon' });
  svg.append(svgEl('rect', { x: 0, y: 0, width: 24, height: 24, rx: 7, fill: '#ffe3e5' }));
  svg.append(
    svgEl('path', {
      d: ICONS[kind] ?? ICONS.live!,
      fill: 'none',
      stroke: '#ff1b2d',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      transform: 'translate(2.4 2.4) scale(0.8)',
    }),
  );
  return svg;
}

function buildBar(asset: (f: string) => string): HTMLElement {
  const bar = el('header', 'op-bar');
  bar.append(el('span', 'op-logo', 'Opera'));
  const nav = el('nav', 'op-nav');
  for (const l of NAV_LINKS) nav.append(el('span', 'op-navlink', l));
  const search = input('search', '', { placeholder: 'Search opera.com', 'aria-label': 'Search' });
  search.classList.add('op-search');
  bar.append(
    nav,
    el('div', 'op-spacer'),
    search,
    button('Sign in', 'op-btn op-btn-ghost'),
    button('Download Opera', 'op-btn op-btn-red'),
  );
  return bar;
}

function buildHero(): HTMLElement {
  const hero = el('section', 'op-hero');
  hero.append(el('span', 'op-badge', HERO.badge));
  const h1 = el('h1', 'op-h1');
  h1.append(el('span', '', HERO.title[0]), el('br'), el('span', 'op-red', HERO.title[1]));
  const lede = el('p', 'op-lede', HERO.lede);
  lede.dataset.introLane = ''; // main.ts drives the intro dozer in along this paragraph
  const cta = el('div', 'op-cta');
  cta.append(
    button('Download Opera', 'op-btn op-btn-red op-btn-lg'),
    button('Read the developer guide', 'op-btn op-btn-ghost op-btn-lg'),
    button('Open the playground', 'op-btn op-btn-dark op-btn-lg'),
  );
  const stats = el('div', 'op-stats');
  for (const [n, t] of HERO.stats) {
    const s = el('div', 'op-stat');
    s.append(el('strong', '', n), el('span', '', t));
    stats.append(s);
  }
  const get = el('div', 'op-get');
  get.append(
    el('span', 'op-get-label', 'Get it for'),
    select(['macOS', 'Windows', 'Linux', 'Android'], 0),
    select(['Stable', 'Beta', 'Developer'], 0),
    choice('radio', 'op-arch', 'ARM64', true),
    choice('radio', 'op-arch', 'x64'),
    choice('checkbox', 'op-notes', 'Email me release notes', true),
  );
  hero.append(h1, lede, cta, get, stats);
  return hero;
}

function buildQuotes(): HTMLElement {
  const quotes = el('section', 'op-quotes');
  for (const q of QUOTES) {
    const b = el('blockquote', 'op-quote');
    const who = el('cite', '');
    who.append(el('b', '', q.name), el('br'), document.createTextNode(q.role));
    b.append(el('p', '', `“${q.text}”`), who);
    quotes.append(b);
  }
  return quotes;
}

function buildShowcase(asset: (f: string) => string): HTMLElement {
  const fig = el('figure', 'op-figure');
  fig.append(
    img(
      asset('opera-30-years.jpg'),
      'op-studio',
      1000,
      563,
      'A glowing screen reading 30, Thirty Years of Opera, with a pixel-art slice of cake among rows of pixel icons',
    ),
  );
  fig.append(el('figcaption', '', 'Thirty years of Opera, and the browser is still learning new tricks.'));
  return fig;
}

function buildNotes(): HTMLElement {
  const notes = el('section', 'op-panel op-notes');
  notes.append(el('h3', 'op-h3', 'What’s new in this release'));
  const ul = el('ul', 'op-list');
  for (const n of RELEASE_NOTES) ul.append(el('li', '', n));
  notes.append(ul);
  return notes;
}

function buildConfigure(): HTMLElement {
  const panel = el('section', 'op-panel op-configure');
  const head = el('div', 'op-panel-head');
  head.append(el('h2', 'op-h2', 'Configure your canvas'), el('span', 'op-pill', 'Live demo'));
  panel.append(
    head,
    el(
      'p',
      'op-panel-sub',
      'Every control below is a real form element, drawn into the canvas you are looking at. Change them, or push them around with the bulldozer.',
    ),
  );

  const canvas = fieldset(
    'Canvas',
    field('Context', select(['2D', 'WebGL 2', 'WebGPU'], 2)),
    field('Pixel ratio', select(['1×', '1.5×', '2×', '3×'], 2)),
    field('Colour space', select(['sRGB', 'Display P3', 'Rec. 2020'])),
    field('Width', input('number', '1920', { min: '1', step: '1' })),
    field('Height', input('number', '1080', { min: '1', step: '1' })),
    field('Alpha', select(['Premultiplied', 'Opaque'])),
    field('Ship date', input('date', '2026-10-10')),
    field('Notify me', input('email', '', { placeholder: 'you@example.com' })),
    radioGroup('Redraw', 'op-redraw', ['On paint event', 'Every frame', 'Manually'], 0),
  );
  const checks = el('div', 'op-checks');
  checks.append(
    choice('checkbox', 'op-c1', 'layoutsubtree', true),
    choice('checkbox', 'op-c2', 'Keep accessible fallback', true),
    choice('checkbox', 'op-c3', 'Forward input events', true),
    choice('checkbox', 'op-c4', 'Generate mipmaps'),
    choice('checkbox', 'op-c5', 'Desynchronized'),
    choice('checkbox', 'op-c6', 'Will read frequently'),
  );
  canvas.append(checks);

  const element = fieldset(
    'Element',
    field('Element selector', input('text', '#hero-card', { spellcheck: 'false' })),
    field('Search the DOM', input('search', '', { placeholder: 'button, .card, h1…' })),
    field('Source element', select(['Card', 'Sign-up form', 'Video player', 'Whole page'], 3)),
    field('Accent colour', input('color', '#ff1b2d')),
    field('Background', input('color', '#1b1f2a')),
    field('Scale', input('range', '70', { min: '0', max: '100' })),
    field('Rotation', input('range', '25', { min: '0', max: '100' })),
    field('Opacity', input('range', '90', { min: '0', max: '100' })),
    field('Blur', input('range', '15', { min: '0', max: '100' })),
  );
  const css = el('textarea', 'op-textarea');
  css.value = '.card {\n  border-radius: 24px;\n  box-shadow: 0 12px 40px #ff1b2d55;\n}';
  css.rows = 4;
  element.append(field('Custom CSS', css, 'op-field op-wide'));

  const effects = fieldset(
    'Effects',
    field('Shader', select(['None', 'Ripple', 'CRT scanlines', 'Bulldozer'], 3)),
    field('Blend mode', select(['Normal', 'Multiply', 'Screen', 'Overlay'])),
    field('Intensity', input('range', '60', { min: '0', max: '100' })),
    field('Frames per second', input('number', '60', { min: '1', max: '240' })),
  );
  const toggles = el('div', 'op-toggles');
  toggles.append(
    toggle('Drop shadow', true),
    toggle('Bloom', false),
    toggle('Wobble', true),
    toggle('Dark mode', false),
    toggle('Pixel snapping', true),
    toggle('Show bounds', false),
  );
  effects.append(toggles);

  const status = el('div', 'op-status');
  status.append(
    meterRow('Rendering', progress(72), '72%'),
    meterRow('GPU budget', meter(0.42, 0.6, 0.85, 0.2), '42%'),
    meterRow('Frame time', meter(0.78, 0.5, 0.75, 0.1), '13 ms'),
    meterRow('Upload', progress(35), '35%'),
  );
  const actions = el('div', 'op-actions');
  actions.append(
    button('Apply', 'op-btn op-btn-red'),
    button('Reset', 'op-btn op-btn-ghost'),
    button('Copy snippet', 'op-btn op-btn-dark'),
    button('Share', 'op-btn op-btn-ghost'),
  );

  const grid = el('div', 'op-config-grid');
  grid.append(canvas, element, effects, status);
  panel.append(grid, actions);
  return panel;
}

function buildFeatures(): HTMLElement {
  const grid = el('section', 'op-features');
  for (const f of FEATURES) {
    const card = el('div', 'op-feature');
    card.append(icon(f.icon), el('h3', 'op-h3', f.title), el('p', '', f.text));
    grid.append(card);
  }
  return grid;
}

function buildPlayground(): HTMLElement {
  const panel = el('section', 'op-panel op-play');
  const head = el('div', 'op-panel-head');
  const tabs = el('div', 'op-tabs');
  tabs.append(button('HTML', 'op-tab'), button('Canvas', 'op-tab'), button('JS', 'op-tab op-tab-on'));
  head.append(el('h2', 'op-h2', 'Playground'), tabs);
  const body = el('div', 'op-play-body');
  const pre = el('pre', 'op-code');
  pre.textContent = CODE_SAMPLE.join('\n');
  const side = el('div', 'op-play-side');
  side.append(
    field('Example', select(['Hello, canvas', 'Form on a cube', 'Video wall', 'Bulldozer'], 3)),
    field('Font', select(['System UI', 'Serif', 'Monospace'])),
    radioGroup('Theme', 'op-theme', ['Light', 'Dark', 'Auto'], 2),
    toggle('Hot reload', true),
    meterRow('Build', progress(100), 'done'),
  );
  const run = el('div', 'op-actions');
  run.append(
    button('Run', 'op-btn op-btn-red'),
    button('Format', 'op-btn op-btn-ghost'),
    button('Save', 'op-btn op-btn-ghost'),
  );
  side.append(run);
  body.append(pre, side);
  panel.append(head, body);
  return panel;
}

function buildFaq(): HTMLElement {
  const sec = el('section', 'op-panel op-faq');
  sec.append(el('h2', 'op-h2', 'Questions, answered'));
  const list = el('dl', 'op-faq-list');
  for (const [q, a] of FAQ) {
    const item = el('div');
    item.append(el('dt', '', q), el('dd', '', a));
    list.append(item);
  }
  sec.append(list);
  return sec;
}

/** The Opera product page that fills the top of the page (about the top 42 % of the page). */
export function buildOperaTop(asset: (file: string) => string): HTMLElement {
  const top = el('div', 'op-top');
  const grid = el('div', 'op-grid');
  grid.append(
    buildHero(),
    buildShowcase(asset),
    buildConfigure(),
    buildFeatures(),
    buildPlayground(),
    buildQuotes(),
    buildNotes(),
    buildFaq(),
  );
  top.append(buildBar(asset), grid);
  return top;
}
