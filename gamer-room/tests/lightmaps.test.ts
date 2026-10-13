// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from 'three';
import { applyLightmaps } from '../src/scene/lightmaps';

describe('applyLightmaps', () => {
  afterEach(() => vi.restoreAllMocks());
  it('assigns lightMap and intensity by mesh name and reports what it touched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = new Group();
    const desk = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    desk.name = 'Desk';
    const wall = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    wall.name = 'Wall';
    root.add(desk, wall);
    const tex = new Texture();
    const applied = applyLightmaps(
      root,
      { Desk: { file: 'desk.png', intensity: 1.5 }, Missing: { file: 'x.png' } },
      new Map([['desk.png', tex]]),
    );
    expect(applied).toEqual(['Desk']);
    expect((desk.material as MeshStandardMaterial).lightMap).toBe(tex);
    expect((desk.material as MeshStandardMaterial).lightMapIntensity).toBeCloseTo(1.5 * Math.PI);
    expect((wall.material as MeshStandardMaterial).lightMap).toBeNull();
  });
  it('clones a shared material so each mesh keeps its own lightmap', () => {
    const root = new Group();
    const shared = new MeshStandardMaterial();
    const a = new Mesh(new BoxGeometry(), shared);
    a.name = 'A';
    const b = new Mesh(new BoxGeometry(), shared);
    b.name = 'B';
    const c = new Mesh(new BoxGeometry(), shared);
    c.name = 'C';
    root.add(a, b, c);
    const ta = new Texture();
    const tb = new Texture();
    const applied = applyLightmaps(
      root,
      { A: { file: 'a.png' }, B: { file: 'b.png' } },
      new Map([
        ['a.png', ta],
        ['b.png', tb],
      ]),
    );
    expect(applied).toEqual(['A', 'B']);
    expect(a.material).not.toBe(b.material);
    expect((a.material as MeshStandardMaterial).lightMap).toBe(ta);
    expect((b.material as MeshStandardMaterial).lightMap).toBe(tb);
    expect(c.material).toBe(shared);
    expect(shared.lightMap).toBeNull();
  });
  it('matches manifest keys against GLTFLoader-sanitised mesh names', () => {
    const root = new Group();
    const desk = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    desk.name = 'Desk001';
    root.add(desk);
    const tex = new Texture();
    expect(applyLightmaps(root, { 'Desk.001': { file: 'd.png' } }, new Map([['d.png', tex]]))).toEqual(['Desk001']);
    expect((desk.material as MeshStandardMaterial).lightMap).toBe(tex);
  });
  it('matches the mesh children of a multi-material Group by the group name', () => {
    const root = new Group();
    const shelf = new Group();
    shelf.name = 'Shelf';
    const p0 = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    p0.name = 'Shelf_1';
    const p1 = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    p1.name = 'Shelf_2';
    shelf.add(p0, p1);
    root.add(shelf);
    const tex = new Texture();
    expect(applyLightmaps(root, { Shelf: { file: 's.png' } }, new Map([['s.png', tex]]))).toEqual([
      'Shelf_1',
      'Shelf_2',
    ]);
    expect((p0.material as MeshStandardMaterial).lightMap).toBe(tex);
    expect((p1.material as MeshStandardMaterial).lightMap).toBe(tex);
  });
  it('warns once listing manifest keys that matched nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = new Group();
    const desk = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    desk.name = 'Desk';
    root.add(desk);
    applyLightmaps(
      root,
      { Desk: { file: 'd.png' }, Ghost: { file: 'g.png' }, 'Lamp.002': { file: 'l.png' } },
      new Map([['d.png', new Texture()]]),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Ghost, Lamp.002');
    expect(String(warn.mock.calls[0]![0])).not.toContain('Desk,');
  });
});
