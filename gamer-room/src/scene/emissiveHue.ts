// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Color, Material, Mesh, Object3D } from 'three';

type EmissiveMaterial = Material & { emissive: Color };
interface Tracked {
  material: EmissiveMaterial;
  h: number;
  s: number;
  l: number;
  drift: number;
}

/**
 * Rotates the emissive hue of named materials over time (`hueDrift` in cycles per minute).
 * Materials not named in `config` are never touched; a material shared by several meshes is tracked once.
 */
export function createEmissiveHue(
  root: Object3D,
  config: Record<string, { hueDrift: number }>,
): { count: number; update(nowMs: number): void } {
  const tracked: Tracked[] = [];
  const seen = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const cfg = config[m.name];
      const emissive = (m as Partial<EmissiveMaterial>).emissive;
      if (!cfg || !emissive?.isColor) continue;
      const hsl = emissive.getHSL({ h: 0, s: 0, l: 0 });
      tracked.push({ material: m as EmissiveMaterial, ...hsl, drift: cfg.hueDrift });
    }
  });
  return {
    count: tracked.length,
    update(nowMs: number) {
      const minutes = nowMs / 60_000;
      for (const t of tracked) t.material.emissive.setHSL((((t.h + t.drift * minutes) % 1) + 1) % 1, t.s, t.l);
    },
  };
}
