// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { applyMaterialOverrides } from '../src/scene/materialOverrides';

const overrides = {
  MAT_PC_With_Window: { emissiveIntensity: 0.25 },
  MAT_Speaker_Mesh: { emissiveIntensity: 0.6, color: 0x808080 },
};

function mat(name: string, emissiveIntensity = 3) {
  const m = new MeshStandardMaterial({ emissiveIntensity });
  m.name = name;
  return m;
}

describe('applyMaterialOverrides', () => {
  it('overrides matching materials and leaves others untouched', () => {
    const root = new Group();
    const pc = mat('MAT_PC_With_Window');
    const other = mat('MAT_Desk', 2);
    root.add(new Mesh(new BoxGeometry(), pc), new Mesh(new BoxGeometry(), other));
    expect(applyMaterialOverrides(root, overrides)).toEqual(['MAT_PC_With_Window']);
    expect(pc.emissiveIntensity).toBe(0.25);
    expect(other.emissiveIntensity).toBe(2);
    expect(other.version).toBe(0);
  });
  it('handles material arrays', () => {
    const root = new Group();
    const speaker = mat('MAT_Speaker_Mesh', 2);
    const plain = mat('MAT_Plain', 1);
    root.add(new Mesh(new BoxGeometry(), [plain, speaker]));
    expect(applyMaterialOverrides(root, overrides)).toEqual(['MAT_Speaker_Mesh']);
    expect(speaker.emissiveIntensity).toBe(0.6);
    expect(speaker.color.getHex()).toBe(0x808080);
    expect(plain.emissiveIntensity).toBe(1);
  });
  it('lists a shared material once', () => {
    const root = new Group();
    const pc = mat('MAT_PC_With_Window');
    root.add(new Mesh(new BoxGeometry(), pc), new Mesh(new BoxGeometry(), pc));
    expect(applyMaterialOverrides(root, overrides)).toEqual(['MAT_PC_With_Window']);
    expect(pc.version).toBe(1);
  });
});
