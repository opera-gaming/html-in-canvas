// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// DOM helpers and the geometric SVG illustrations that stand in for news photos.

const SVG_NS = 'http://www.w3.org/2000/svg';

export type ArtKind = 'plant' | 'pigeon' | 'soup' | 'bridge' | 'sky' | 'city' | 'abstract';

let artCounter = 0;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A geometric illustration with gradients, standing in for a news photo. */
export function makeArt(kind: ArtKind, w: number, h: number): SVGSVGElement {
  const id = `dzg${artCounter++}`;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'dz-art' }) as SVGSVGElement;
  svg.setAttribute('role', 'img');
  const defs = svgEl('defs', {});
  const grad = (gid: string, a: string, b: string, vertical = true): void => {
    const g = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 });
    g.append(svgEl('stop', { offset: 0, 'stop-color': a }), svgEl('stop', { offset: 1, 'stop-color': b }));
    defs.append(g);
  };
  const add = (tag: string, attrs: Record<string, string | number>): void => {
    svg.append(svgEl(tag, attrs));
  };
  svg.append(defs);
  const cx = w / 2;

  switch (kind) {
    case 'plant': {
      grad(`${id}a`, '#d3f9d8', '#fff3bf');
      grad(`${id}b`, '#e8590c', '#a63e00');
      grad(`${id}c`, '#40c057', '#2b8a3e');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      add('rect', {
        x: w * 0.62,
        y: h * 0.08,
        width: w * 0.3,
        height: h * 0.5,
        fill: '#a5d8ff',
        stroke: '#fff',
        'stroke-width': 6,
      });
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.42;
        const lx = cx - w * 0.12 + Math.cos(a) * h * 0.32;
        const ly = h * 0.6 + Math.sin(a) * h * 0.42;
        add('ellipse', {
          cx: lx,
          cy: ly,
          rx: h * 0.08,
          ry: h * 0.2,
          fill: `url(#${id}c)`,
          transform: `rotate(${(a * 180) / Math.PI + 90} ${lx} ${ly})`,
        });
      }
      add('path', {
        d: `M${cx - w * 0.22} ${h * 0.62} h${w * 0.2} l-${w * 0.03} ${h * 0.36} h-${w * 0.14} z`,
        fill: `url(#${id}b)`,
      });
      break;
    }
    case 'pigeon': {
      grad(`${id}a`, '#74c0fc', '#e7f5ff');
      grad(`${id}b`, '#868e96', '#495057');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      add('circle', { cx: w * 0.85, cy: h * 0.2, r: h * 0.12, fill: '#ffd43b' });
      add('rect', { y: h * 0.82, width: w, height: h * 0.18, fill: '#f08c00' });
      add('line', { x1: w * 0.7, y1: h * 0.82, x2: w * 0.7, y2: h * 0.35, stroke: '#fff', 'stroke-width': 4 });
      add('rect', { x: w * 0.66, y: h * 0.3, width: w * 0.18, height: h * 0.1, fill: '#fa5252' });
      add('ellipse', { cx: w * 0.35, cy: h * 0.55, rx: w * 0.16, ry: h * 0.2, fill: `url(#${id}b)` });
      add('path', {
        d: `M${w * 0.3} ${h * 0.5} q${w * 0.15} -${h * 0.35} ${w * 0.3} -${h * 0.05} q-${w * 0.12} ${h * 0.02} -${w * 0.3} ${h * 0.15}z`,
        fill: '#adb5bd',
      });
      add('circle', { cx: w * 0.2, cy: h * 0.4, r: h * 0.09, fill: '#5c7cfa' });
      add('circle', { cx: w * 0.18, cy: h * 0.38, r: h * 0.018, fill: '#fff' });
      add('path', {
        d: `M${w * 0.15} ${h * 0.42} l-${w * 0.05} ${h * 0.02} l${w * 0.05} ${h * 0.02}z`,
        fill: '#f59f00',
      });
      break;
    }
    case 'soup': {
      grad(`${id}a`, '#fff4e6', '#ffd8a8');
      grad(`${id}b`, '#f76707', '#c92a2a');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      add('rect', { y: h * 0.7, width: w, height: h * 0.3, fill: '#e64980', opacity: 0.25 });
      for (let i = 0; i < 3; i++) {
        add('path', {
          d: `M${cx - 30 + i * 30} ${h * 0.4} q-12 -${h * 0.1} 0 -${h * 0.18} q12 -${h * 0.08} 0 -${h * 0.16}`,
          stroke: '#adb5bd',
          'stroke-width': 5,
          fill: 'none',
          'stroke-linecap': 'round',
        });
      }
      add('path', {
        d: `M${cx - w * 0.28} ${h * 0.5} a${w * 0.28} ${h * 0.4} 0 0 0 ${w * 0.56} 0z`,
        fill: `url(#${id}b)`,
      });
      add('ellipse', { cx, cy: h * 0.5, rx: w * 0.28, ry: h * 0.07, fill: '#ffa94d' });
      add('circle', { cx: cx - 20, cy: h * 0.5, r: 6, fill: '#51cf66' });
      add('circle', { cx: cx + 25, cy: h * 0.49, r: 5, fill: '#fcc419' });
      break;
    }
    case 'bridge': {
      grad(`${id}a`, '#ff8787', '#ffe066');
      grad(`${id}b`, '#1971c2', '#0b7285');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      add('circle', { cx: w * 0.5, cy: h * 0.62, r: h * 0.22, fill: '#fff3bf' });
      add('path', {
        d: `M0 ${h * 0.7} Q${w * 0.25} ${h * 0.55} ${w * 0.4} ${h * 0.72} T${w} ${h * 0.65} V${h} H0z`,
        fill: '#2f9e44',
      });
      add('rect', { y: h * 0.78, width: w, height: h * 0.22, fill: `url(#${id}b)` });
      add('path', {
        d: `M${w * 0.08} ${h * 0.8} Q${cx} ${h * 0.15} ${w * 0.92} ${h * 0.8}`,
        stroke: '#5f3dc4',
        'stroke-width': 14,
        fill: 'none',
      });
      for (let i = 1; i < 10; i++) {
        const x = w * 0.08 + (w * 0.84 * i) / 10;
        add('line', { x1: x, y1: h * 0.52, x2: x, y2: h * 0.8, stroke: '#7950f2', 'stroke-width': 4 });
      }
      add('rect', { x: w * 0.05, y: h * 0.5, width: w * 0.9, height: 10, fill: '#5f3dc4' });
      break;
    }
    case 'sky': {
      grad(`${id}a`, '#4dabf7', '#d0ebff');
      grad(`${id}b`, '#ffffff', '#dee2e6');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      const colours = ['#fa5252', '#fd7e14', '#fcc419', '#51cf66', '#339af0', '#845ef7'];
      colours.forEach((c, i) => {
        add('path', {
          d: `M${w * 0.1 + i * 9} ${h} A${w * 0.4 - i * 9} ${h * 0.8 - i * 9} 0 0 1 ${w * 0.9 - i * 9} ${h}`,
          stroke: c,
          'stroke-width': 9,
          fill: 'none',
          opacity: 0.85,
        });
      });
      add('circle', { cx: w * 0.82, cy: h * 0.22, r: h * 0.13, fill: '#ffd43b' });
      for (const [x, y, s] of [
        [0.22, 0.3, 1],
        [0.6, 0.45, 0.8],
      ] as const) {
        add('ellipse', { cx: w * x, cy: h * y, rx: 50 * s, ry: 20 * s, fill: `url(#${id}b)` });
        add('circle', { cx: w * x - 15 * s, cy: h * y - 14 * s, r: 22 * s, fill: `url(#${id}b)` });
        add('circle', { cx: w * x + 16 * s, cy: h * y - 10 * s, r: 17 * s, fill: `url(#${id}b)` });
      }
      break;
    }
    case 'city': {
      grad(`${id}a`, '#e599f7', '#ffc9c9');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      const palette = ['#5c940d', '#1864ab', '#862e9c', '#d9480f', '#087f5b', '#c2255c'];
      let x = 0;
      for (let i = 0; x < w; i++) {
        const bw = 30 + ((i * 17) % 40);
        const bh = h * (0.35 + ((i * 29) % 50) / 100);
        add('rect', { x, y: h - bh, width: bw - 4, height: bh, fill: palette[i % palette.length]! });
        for (let wy = h - bh + 8; wy < h - 10; wy += 16) {
          add('rect', { x: x + 6, y: wy, width: bw - 16, height: 6, fill: '#fff3bf', opacity: 0.6 });
        }
        x += bw;
      }
      break;
    }
    case 'abstract': {
      grad(`${id}a`, '#ffec99', '#ff8787', false);
      grad(`${id}b`, '#3bc9db', '#5c7cfa');
      add('rect', { width: w, height: h, fill: `url(#${id}a)` });
      add('circle', { cx: w * 0.25, cy: h * 0.5, r: h * 0.38, fill: `url(#${id}b)` });
      add('rect', {
        x: w * 0.45,
        y: h * 0.15,
        width: w * 0.22,
        height: h * 0.7,
        fill: '#e64980',
        transform: `rotate(12 ${w * 0.56} ${h / 2})`,
      });
      add('path', { d: `M${w * 0.7} ${h * 0.85} L${w * 0.85} ${h * 0.15} L${w * 0.98} ${h * 0.85}z`, fill: '#37b24d' });
      break;
    }
  }
  return svg;
}
