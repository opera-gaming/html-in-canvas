// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { DoubleSide, FrontSide, Group, Mesh, PlaneGeometry, MeshBasicMaterial, MeshPhysicalMaterial } from 'three';
import { discoverScreens, replaceTransmission, singlePassTransparency } from '../src/scene/loadRoom';
import { placeholderRoom } from '../src/scene/placeholderRoom';
import { fitScreen } from '../src/scene/ScreenFitter';

describe('discoverScreens', () => {
  it('finds Screen_* meshes anywhere in the tree', () => {
    const root = new Group();
    const child = new Group();
    const a = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
    a.name = 'Screen_MonR';
    const b = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
    b.name = 'Screen_CRT.001';
    const c = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
    c.name = 'Desk';
    root.add(a, child);
    child.add(b, c);
    expect(
      discoverScreens(root)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['crt', 'monr']);
  });
});

describe('placeholderRoom', () => {
  it('contains the expected discoverable screens', () => {
    const ids = discoverScreens(placeholderRoom())
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['arcade', 'monl', 'monr', 'poster']);
  });
  it('has a curved right monitor and flat others', () => {
    const room = placeholderRoom();
    room.updateMatrixWorld(true);
    const byId = Object.fromEntries(discoverScreens(room).map((s) => [s.id, s.mesh]));
    expect(fitScreen(byId.monr!)!.curved).toBe(true);
    expect(fitScreen(byId.monl!)!.curved).toBe(false);
  });
});

describe('replaceTransmission', () => {
  it('turns transmissive glass into alpha-blended glass, once per shared material', () => {
    const root = new Group();
    const glass = new MeshPhysicalMaterial({ transmission: 1 });
    glass.name = 'Glass';
    root.add(
      new Mesh(new PlaneGeometry(), glass),
      new Mesh(new PlaneGeometry(), glass),
      new Mesh(new PlaneGeometry(), new MeshPhysicalMaterial()),
    );
    expect(replaceTransmission(root)).toEqual(['Glass']);
    expect(glass.transmission).toBe(0);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.25);
  });
});

describe('singlePassTransparency', () => {
  it('draws transparent double-sided materials in one pass and leaves the rest alone', () => {
    const decal = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
    const opaque2 = new MeshBasicMaterial({ side: DoubleSide });
    const front = new MeshBasicMaterial({ transparent: true, side: FrontSide });
    const root = new Group();
    root.add(
      new Mesh(new PlaneGeometry(), decal),
      new Mesh(new PlaneGeometry(), decal),
      new Mesh(new PlaneGeometry(), opaque2),
      new Mesh(new PlaneGeometry(), front),
    );
    expect(singlePassTransparency(root)).toBe(1);
    expect(decal.forceSinglePass).toBe(true);
    expect(opaque2.forceSinglePass).toBe(false);
    expect(front.forceSinglePass).toBe(false);
  });
});
