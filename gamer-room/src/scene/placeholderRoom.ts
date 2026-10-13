// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
} from 'three';

function box(w: number, h: number, d: number, color: number, emissive = 0x000000, emissiveIntensity = 0) {
  return new Mesh(
    new BoxGeometry(w, h, d),
    new MeshStandardMaterial({ color, emissive: new Color(emissive), emissiveIntensity, roughness: 0.9 }),
  );
}

const screenMat = () => new MeshStandardMaterial({ color: 0x101018, emissive: 0x202030 });

function flatScreen(name: string, w: number, h: number) {
  const m = new Mesh(new PlaneGeometry(w, h), screenMat());
  m.name = name;
  return m;
}

/** Curved panel: `segments` quads along X bowed toward -Z (away from the viewer) by `sag`. UVs 0..1, v = 1 at top. */
function curvedScreen(name: string, w: number, h: number, sag: number, segments = 16) {
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      x = (t - 0.5) * w,
      z = -sag * (1 - (2 * t - 1) ** 2);
    pos.push(x, -h / 2, z, x, h / 2, z);
    uv.push(t, 0, t, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new Mesh(g, screenMat());
  m.name = name;
  return m;
}

export function placeholderRoom(): Group {
  const g = new Group();
  const H = 3;
  const floor = box(4, 0.02, 4, 0x4a3524);
  floor.position.set(1, -0.01, 1);
  g.add(floor);
  const back = box(4, H, 0.02, 0xb9b3bd);
  back.position.set(1, H / 2, -1);
  g.add(back);

  // LED strips
  const strip = box(0.02, H, 0.02, 0x000000, 0xff2d7a, 4);
  strip.position.set(2.98, H / 2, -0.98);
  g.add(strip);

  // Arcade cabinet against the back wall, screen facing +z and tilted back ~20°
  const cab = box(0.75, 2.0, 0.7, 0x1a1a22);
  cab.position.set(0.3, 1.0, -0.65);
  g.add(cab);
  const arcade = flatScreen('Screen_Arcade', 0.58, 0.32);
  arcade.position.set(0.3, 1.3, -0.29);
  arcade.rotation.x = -0.35;
  g.add(arcade);

  // Desk with two monitors against the back wall
  const desk = box(1.8, 0.04, 0.8, 0x3a3028);
  desk.position.set(1.6, 0.73, -0.55);
  g.add(desk);
  const monl = flatScreen('Screen_MonL', 0.54, 0.31);
  monl.position.set(1.0, 1.05, -0.8);
  monl.rotation.y = 0.25;
  g.add(monl);
  const monr = curvedScreen('Screen_MonR', 0.83, 0.35, 0.08);
  monr.position.set(1.95, 1.05, -0.75);
  monr.rotation.y = -0.12;
  g.add(monr);

  // Poster on the right wall, 16:9
  const right = box(0.02, H, 4, 0xb9b3bd);
  right.position.set(3, H / 2, 1);
  g.add(right);
  const poster = flatScreen('Screen_Poster', 1.05, 0.59);
  poster.position.set(2.98, 2.0, 0.4);
  poster.rotation.y = -Math.PI / 2;
  g.add(poster);

  const lamp = new PointLight(0xffb060, 8, 8, 2);
  lamp.position.set(1.5, 2.5, 1.5);
  g.add(lamp);
  const purple = new PointLight(0xa040ff, 6, 6, 2);
  purple.position.set(0, 1.8, 0);
  g.add(purple);
  return g;
}
