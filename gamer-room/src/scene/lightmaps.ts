// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { Mesh, MeshStandardMaterial, Object3D, PropertyBinding, SRGBColorSpace, Texture, TextureLoader } from 'three';

export interface LightmapManifest {
  [meshName: string]: { file: string; intensity?: number };
}

/**
 * Assign lightmaps from the manifest. Manifest keys are Blender object names; GLTFLoader
 * sanitises node names (`Cube.080` -> `Cube080`) and turns multi-material objects into a
 * Group named after the node with one mesh child per material, so keys are matched by
 * sanitised name against the mesh itself or, failing that, its non-mesh parent.
 */
export function applyLightmaps(root: Object3D, manifest: LightmapManifest, textures: Map<string, Texture>): string[] {
  const applied: string[] = [];
  const lookup = new Map<string, string>();
  for (const key of Object.keys(manifest)) lookup.set(PropertyBinding.sanitizeNodeName(key), key);
  const matched = new Set<string>();

  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    let key = lookup.get(PropertyBinding.sanitizeNodeName(mesh.name));
    const parent = mesh.parent;
    if (key === undefined && parent && !(parent as Mesh).isMesh)
      key = lookup.get(PropertyBinding.sanitizeNodeName(parent.name));
    if (key === undefined) return;
    matched.add(key);
    const entry = manifest[key]!;
    const tex = textures.get(entry.file);
    if (!tex) return;
    if (!('lightMap' in (mesh.material as MeshStandardMaterial))) return;
    // glTF meshes often share a material; give every lightmapped mesh its own clone so its lightmap never leaks.
    const mat = (mesh.material as MeshStandardMaterial).clone();
    mesh.material = mat;
    mat.lightMap = tex;
    // three treats a lightmap as irradiance and shades it with Lambert (albedo / π), whereas a
    // Cycles diffuse bake without colour is the factor that multiplies albedo directly. Scale by
    // π so the room is as bright as it is in Blender, not a third of that.
    mat.lightMapIntensity = (entry.intensity ?? 1) * Math.PI;
    mat.needsUpdate = true;
    applied.push(mesh.name);
  });

  const unmatched = Object.keys(manifest).filter((k) => !matched.has(k));
  if (unmatched.length) console.warn(`[lightmaps] manifest keys matched no mesh: ${unmatched.join(', ')}`);
  return applied;
}

export async function loadLightmaps(
  baseUrl: string,
): Promise<{ manifest: LightmapManifest; textures: Map<string, Texture> }> {
  const textures = new Map<string, Texture>();
  let manifest: LightmapManifest = {};
  try {
    const res = await fetch(`${baseUrl}/manifest.json`);
    if (res.ok) manifest = (await res.json()) as LightmapManifest;
  } catch {
    /* no lightmaps */
  }
  const loader = new TextureLoader();
  const files = [...new Set(Object.values(manifest).map((e) => e.file))];
  await Promise.all(
    files.map(async (f) => {
      const t = await loader.loadAsync(`${baseUrl}/${f}`);
      t.colorSpace = SRGBColorSpace;
      t.flipY = false; // glTF UV convention
      t.channel = 1; // UV set 2
      textures.set(f, t);
    }),
  );
  return { manifest, textures };
}
