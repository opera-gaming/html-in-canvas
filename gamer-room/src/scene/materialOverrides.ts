// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Material, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { MaterialOverride } from '../config/materials';

/**
 * Apply per-material overrides by material name. glTF materials are shared by reference, so
 * each material object is patched once. Returns the names of the materials touched, each once.
 */
export function applyMaterialOverrides(root: Object3D, overrides: Record<string, MaterialOverride>): string[] {
  const done = new Set<Material>();
  const names = new Set<string>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || done.has(m)) continue;
      const ov = overrides[m.name];
      if (!ov) continue;
      done.add(m);
      const mat = m as MeshStandardMaterial;
      if (ov.emissiveIntensity !== undefined && 'emissiveIntensity' in mat)
        mat.emissiveIntensity = ov.emissiveIntensity;
      if (ov.color !== undefined && mat.color) mat.color.setHex(ov.color);
      if (ov.roughness !== undefined && 'roughness' in mat) mat.roughness = ov.roughness;
      if (ov.metalness !== undefined && 'metalness' in mat) mat.metalness = ov.metalness;
      mat.needsUpdate = true;
      names.add(m.name);
    }
  });
  return [...names];
}
