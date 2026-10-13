// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import './page.css';
import { PAGE_SIZE } from '../config';
import { ARTICLES, type Article } from './content';
import { PHOTO_STORIES, type PhotoStory } from './opera';
import { el, makeArt, type ArtKind } from './art';
import { buildOperaTop } from './top';

export type CaptureMode = 'normal' | 'content' | 'background';

const SECTION_COLOURS: Record<string, string> = {
  'Home & Garden': '#2f9e44',
  Sport: '#e8590c',
  Science: '#7048e8',
  Travel: '#0c8599',
  Technology: '#1c7ed6',
  Culture: '#c2255c',
  Weather: '#1098ad',
  Food: '#e03131',
  'Opera at 30': '#ff1b2d',
  Transport: '#0c8599',
  Campus: '#1971c2',
  Pets: '#f08c00',
};

interface CardSpec {
  /** Headline size in px. */
  h: number;
  art?: { kind: ArtKind; height: number };
  /** Paragraphs of the lead article to show (1–2). */
  paras?: number;
}

/**
 * Five filler columns under the photo stories. Each column holds these cards and is then topped up with briefs
 * until it would overflow (fillWithBriefs), so there are no empty areas.
 */
const COLUMNS: CardSpec[][] = [
  [
    { h: 26, art: { kind: 'plant', height: 110 } },
    { h: 20, paras: 1 },
  ],
  [
    { h: 22, paras: 1 },
    { h: 24, art: { kind: 'pigeon', height: 100 } },
  ],
  [
    { h: 26, art: { kind: 'bridge', height: 110 } },
    { h: 20, paras: 1 },
  ],
  [
    { h: 22, paras: 1 },
    { h: 24, art: { kind: 'city', height: 100 } },
  ],
  [
    { h: 26, art: { kind: 'sky', height: 100 } },
    { h: 20, paras: 1 },
  ],
];

const NAV = ['Home', 'World', 'Science', 'Sport', 'Food', 'Travel', 'Culture', 'Weather', 'Campus', 'Technology'];

const FOOTER: Record<string, string[]> = {
  Browsers: ['Opera', 'Opera GX', 'Opera Air', 'Mobile', 'Beta', 'Developer'],
  Developers: ['HTML in Canvas', 'Docs', 'Playground', 'Extensions', 'Release notes', 'Bug reports'],
  'The Scroll': ['World', 'Local', 'Campus', 'Food', 'Travel', 'Weather'],
  Help: ['Support', 'Accessibility', 'Privacy', 'Security', 'Feedback', 'Site map'],
};

function sectionColour(section: string): string {
  return SECTION_COLOURS[section] ?? '#495057';
}

/** Cycles through the article list so cards and sidebars never run dry. */
class ArticleCursor {
  private i: number;
  constructor(start: number) {
    this.i = start;
  }
  next(): Article {
    const a = ARTICLES[this.i % ARTICLES.length]!;
    this.i++;
    return a;
  }
}

/** A compact story: run-in bold headline followed by the full article text. */
function buildBrief(a: Article): HTMLElement {
  const p = el('p', 'dz-subbody');
  p.append(el('b', 'dz-subhead', a.title), document.createTextNode(` ${a.paragraphs.join(' ')}`));
  return p;
}

function buildMeta(section: string, byline: string): HTMLElement {
  const meta = el('div', 'dz-meta');
  meta.append(el('span', 'dz-kicker', section), el('span', 'dz-byline', byline));
  return meta;
}

function buildCard(spec: CardSpec, lead: Article): HTMLElement {
  const card = el('article', 'dz-card');
  card.style.setProperty('--accent', sectionColour(lead.section));
  const head = el(spec.h >= 24 ? 'h2' : 'h3', 'dz-headline', lead.title);
  head.style.fontSize = `${spec.h}px`;
  card.append(buildMeta(lead.section, `${lead.byline} · ${2 + (lead.title.length % 9)} min read`), head);
  if (spec.art) card.append(makeArt(spec.art.kind, 400, spec.art.height));
  for (const p of lead.paragraphs.slice(0, spec.paras ?? 2)) card.append(el('p', 'dz-body', p));
  card.append(el('div', 'dz-more'));
  return card;
}

/** A feature story, usually built around a photo (opera.ts PHOTO_STORIES). */
function buildPhotoCard(s: PhotoStory, asset: (f: string) => string): HTMLElement {
  const card = el('article', `dz-card dz-photo dz-photo-${s.key}`);
  card.style.setProperty('--accent', sectionColour(s.section));
  const head = el('h2', 'dz-headline dz-photo-head', s.title);
  card.append(buildMeta(s.section, s.byline), head);
  if (s.img) {
    const fig = el('figure', 'dz-figure');
    const image = el('img', 'dz-photo-img');
    image.src = asset(s.img.src);
    image.alt = s.img.alt;
    image.decoding = 'sync';
    fig.append(image);
    if (s.caption) fig.append(el('figcaption', 'dz-caption', s.caption));
    card.append(fig);
  }
  const text = el('div', 'dz-photo-text');
  for (const p of s.paragraphs) text.append(el('p', 'dz-body', p));
  card.append(text, el('div', 'dz-more'));
  return card;
}

/**
 * Appends briefs round-robin to `lists` until `box` would overflow, then removes the one that overflowed. Needs `box`
 * to be laid out (in the document); does nothing otherwise (e.g. jsdom).
 */
function fillWithBriefs(box: HTMLElement, lists: HTMLElement[], more: ArticleCursor): void {
  const overflows = (): boolean => box.scrollHeight > box.clientHeight + 0.5;
  if (lists.length === 0 || box.clientHeight === 0 || overflows()) return;
  for (let k = 0; k < 500; k++) {
    const brief = buildBrief(more.next());
    lists[k % lists.length]!.append(brief);
    if (overflows()) {
      brief.remove();
      return;
    }
  }
}

function buildMasthead(): HTMLElement {
  const header = el('header', 'dz-masthead');
  const brand = el('div', 'dz-brand');
  const left = el('div', 'dz-brand-side');
  left.append(
    el('span', 'dz-caps', 'Saturday, 10 October 2026'),
    el('strong', '', 'All the news that fits in a canvas'),
    el('span', '', 'Weekend Edition · Vol. CXLII No. 283'),
  );
  const right = el('div', 'dz-brand-side dz-right');
  right.append(
    el('span', 'dz-caps', "Today's Paper · Puzzles · Sign In"),
    el('strong', '', '14° Crisp and mostly sunny'),
    el('span', '', 'Rendered live with HTML in Canvas'),
  );
  brand.append(left, el('h1', 'dz-title', 'The Daily Scroll'), right);
  const nav = el('nav', 'dz-nav');
  NAV.forEach((label, i) => {
    const b = el('button', 'dz-navbtn', label);
    b.type = 'button';
    b.style.setProperty('--hue', String((i * 37 + 200) % 360));
    nav.append(b);
  });
  const ticker = el('div', 'dz-ticker');
  ticker.append(el('span', 'dz-breaking', 'Breaking'));
  const headlines = [PHOTO_STORIES[0]!.title, ...ARTICLES.slice(0, 4).map((a) => a.title)];
  ticker.append(el('span', 'dz-ticker-text', headlines.join('  •  ')));
  header.append(brand, nav, ticker);
  return header;
}

function buildSidebar(more: ArticleCursor): HTMLElement {
  const side = el('aside', 'dz-sidebar');

  const most = el('section', 'dz-widget dz-mostread');
  most.append(el('h3', 'dz-widget-title', 'Most read'));
  const ol = el('ol', 'dz-ranked');
  const titles = [
    PHOTO_STORIES[2]!.title,
    PHOTO_STORIES[1]!.title,
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => ARTICLES[(i * 7 + 41) % ARTICLES.length]!.title),
  ];
  titles.forEach((t, i) => {
    const li = el('li');
    li.append(el('span', 'dz-rank', String(i + 1)), el('span', '', t));
    ol.append(li);
  });
  most.append(ol);

  const weather = el('section', 'dz-widget dz-weather');
  weather.append(el('h3', 'dz-widget-title', 'Weather · Little Splashing'));
  const now = el('div', 'dz-weather-now');
  now.append(makeArt('sky', 140, 96), el('div', 'dz-temp', '14°'));
  const desc = el('div', 'dz-weather-desc');
  desc.append(
    el('div', '', 'Crisp and mostly sunny'),
    el('div', '', 'Wind 9 km/h W'),
    el('div', '', 'Humidity 58%'),
    el('div', '', 'Teapot risk: low'),
  );
  now.append(desc);
  const days = el('div', 'dz-forecast');
  const forecast = [
    ['Sun', '13°'],
    ['Mon', '11°'],
    ['Tue', '12°'],
    ['Wed', '15°'],
    ['Thu', '10°'],
    ['Fri', '9°'],
  ];
  for (const [d, t] of forecast) {
    const day = el('div', 'dz-day');
    day.append(el('b', '', d!), el('span', '', t!));
    days.append(day);
  }
  weather.append(now, days);

  const poll = el('section', 'dz-widget dz-poll');
  poll.append(el('h3', 'dz-widget-title', 'Reader poll'));
  poll.append(el('p', 'dz-poll-q', 'What would you draw into a canvas first?'));
  ['My whole homepage', 'A form on a spinning cube', 'A video wall', 'A newspaper, then bulldoze it'].forEach(
    (label, i) => {
      const row = el('label', 'dz-option');
      const input = el('input');
      input.type = 'radio';
      input.name = 'dz-poll';
      if (i === 3) input.checked = true;
      row.append(input, document.createTextNode(` ${label}`));
      poll.append(row);
    },
  );
  const vote = el('button', 'dz-btn', 'Vote');
  vote.type = 'button';
  poll.append(vote, el('span', 'dz-poll-note', '30,128 votes so far'));

  const news = el('section', 'dz-widget dz-newsletter');
  news.append(el('h3', 'dz-widget-title', 'The Morning Scroll'));
  news.append(
    el(
      'p',
      'dz-small',
      'Our free daily newsletter: the best stories about plants, pigeons, ducks and soup, delivered before your toast lands.',
    ),
  );
  const form = el('div', 'dz-form');
  const email = el('input', 'dz-input');
  email.type = 'email';
  email.placeholder = 'you@example.com';
  const sign = el('button', 'dz-btn', 'Sign up');
  sign.type = 'button';
  form.append(email, sign);
  news.append(form);

  const ad = el('section', 'dz-widget dz-ad');
  ad.append(el('div', 'dz-ad-label', 'Advertisement'));
  ad.append(makeArt('soup', 380, 110));
  ad.append(el('div', 'dz-ad-text', 'Soup of the Month Club — twelve legendary broths delivered warm.'));

  const brief = el('section', 'dz-widget dz-brief');
  brief.append(el('h3', 'dz-widget-title', 'In brief'));
  for (let i = 0; i < 4; i++) brief.append(buildBrief(more.next()));

  side.append(most, weather, poll, news, ad, brief);
  return side;
}

function buildFooter(): HTMLElement {
  const footer = el('footer', 'dz-footer');
  const cols = el('div', 'dz-footcols');
  const brand = el('div', 'dz-footbrand');
  brand.append(
    el('div', 'dz-footlogo', 'The Daily Scroll'),
    el('p', '', 'Printed on recycled pixels and drawn into a canvas. No ducks were harmed in the making of this page.'),
  );
  cols.append(makeArt('abstract', 120, 64), brand);
  for (const [title, links] of Object.entries(FOOTER)) {
    const col = el('div', 'dz-footcol');
    col.append(el('h5', '', title));
    const ul = el('ul');
    for (const l of links) ul.append(el('li', '', l));
    col.append(ul);
    cols.append(col);
  }
  footer.append(cols, el('div', 'dz-copy', 'Stories on this page are made up for a tech demo.'));
  return footer;
}

/** URL of a page image in public/page/. */
function pageAsset(file: string): string {
  return `${import.meta.env?.BASE_URL ?? '/'}page/${file}`;
}

/**
 * Builds the page and appends its PAGE_SIZE × PAGE_SIZE root to `host`: the Opera HTML-in-Canvas product page on
 * top, then the Daily Scroll news section (photo stories, five filler columns and a sidebar) and the footer. The
 * filler columns, the photo stories and the "In brief" widget are topped up with briefs until they would overflow,
 * which needs `host` to be in the document (laid out); in a detached host the page is built without them.
 */
export function buildPage(host: HTMLElement): HTMLElement {
  const root = el('div', 'dz-page');
  root.setAttribute('drawable', '');
  root.style.width = `${PAGE_SIZE}px`;
  root.style.height = `${PAGE_SIZE}px`;

  const news = el('section', 'dz-news');
  const body = el('div', 'dz-newsbody');
  const mainCol = el('div', 'dz-newsmain');
  const features = el('div', 'dz-features');
  for (const s of PHOTO_STORIES) features.append(buildPhotoCard(s, pageAsset));
  const leads = new ArticleCursor(0);
  const more = new ArticleCursor(29);
  const grid = el('div', 'dz-grid');
  for (const column of COLUMNS) {
    const col = el('div', 'dz-col');
    for (const spec of column) col.append(buildCard(spec, leads.next()));
    grid.append(col);
  }
  mainCol.append(features, grid);
  const sidebar = buildSidebar(more);
  body.append(mainCol, sidebar);
  news.append(buildMasthead(), body);
  root.append(buildOperaTop(pageAsset), news, buildFooter());
  host.append(root);

  for (const card of features.querySelectorAll<HTMLElement>('.dz-photo')) {
    fillWithBriefs(card, [...card.querySelectorAll<HTMLElement>('.dz-more')], more);
  }
  for (const col of grid.querySelectorAll<HTMLElement>('.dz-col')) {
    fillWithBriefs(col, [...col.querySelectorAll<HTMLElement>('.dz-more')], more);
  }
  const brief = sidebar.querySelector<HTMLElement>('.dz-brief');
  if (brief) fillWithBriefs(sidebar, [brief], more);
  return root;
}

/** Switches the page between normal rendering and the two capture passes. */
export function setCaptureMode(root: HTMLElement, mode: CaptureMode): void {
  root.classList.toggle('capture-content', mode === 'content');
  root.classList.toggle('capture-background', mode === 'background');
}
