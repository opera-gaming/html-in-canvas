// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { createEmissiveHue } from '../src/scene/emissiveHue';

function hueOf(m: MeshStandardMaterial) {
  return m.emissive.getHSL({ h: 0, s: 0, l: 0 }).h;
}
function mat(name: string, hex: number) {
  const m = new MeshStandardMaterial({ emissive: hex });
  m.name = name;
  return m;
}

describe('createEmissiveHue', () => {
  it('advances the hue of configured materials and leaves others alone', () => {
    const glow = mat('Glow', 0xff0000); // hue 0
    const other = mat('Other', 0x00ff00);
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), glow), new Mesh(new BoxGeometry(), [other]));
    const fx = createEmissiveHue(root, { Glow: { hueDrift: 1 } }); // one cycle per minute
    fx.update(0);
    expect(hueOf(glow)).toBeCloseTo(0, 3);
    fx.update(15_000); // a quarter cycle
    expect(hueOf(glow)).toBeCloseTo(0.25, 2);
    expect(other.emissive.getHex()).toBe(0x00ff00);
  });
  it('tracks a material shared by several meshes once', () => {
    const glow = mat('Glow', 0xff0000);
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), glow), new Mesh(new BoxGeometry(), [glow]));
    const fx = createEmissiveHue(root, { Glow: { hueDrift: 1 } });
    expect(fx.count).toBe(1);
    fx.update(15_000);
    expect(hueOf(glow)).toBeCloseTo(0.25, 2); // not advanced twice
  });
  it('does nothing when the config is empty', () => {
    const glow = mat('Glow', 0xff0000);
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), glow));
    const fx = createEmissiveHue(root, {});
    fx.update(30_000);
    expect(glow.emissive.getHex()).toBe(0xff0000);
    expect(fx.count).toBe(0);
  });
});
