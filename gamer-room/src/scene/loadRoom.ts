// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { AnimationClip, DoubleSide, Group, Mesh, Object3D, type Material, type MeshPhysicalMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { screenIdFromMeshName } from '../config/screens';
import { placeholderRoom } from './placeholderRoom';
import { applyLightmaps, loadLightmaps } from './lightmaps';
import { applyMaterialOverrides } from './materialOverrides';
import { materialOverrides } from '../config/materials';

export interface DiscoveredScreen {
  id: string;
  mesh: Mesh;
}
/** `lightmapped` is true when the lightmap manifest had at least one entry (static lighting is baked). */
export interface Room {
  scene: Group;
  screens: DiscoveredScreen[];
  animations: AnimationClip[];
  fromGltf: boolean;
  lightmapped: boolean;
}

/**
 * Swap KHR_materials_transmission for plain alpha blending. Any transmissive material makes
 * three.js render the whole opaque scene a second time each frame (the transmission pre-pass),
 * which is a high price for refraction through the PC's side window. Returns the materials changed.
 */
export function replaceTransmission(root: Object3D): string[] {
  const done = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as MeshPhysicalMaterial;
      if (done.has(mat) || !mat.isMeshPhysicalMaterial || mat.transmission <= 0) continue;
      done.add(mat);
      mat.opacity = Math.min(mat.opacity, 1 - 0.75 * mat.transmission);
      mat.transmission = 0;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.needsUpdate = true;
    }
  });
  return [...done].map((m) => m.name);
}

/**
 * three draws a transparent double-sided material in two passes (back, then front), flipping `side` with
 * `needsUpdate` each time, so its program is re-validated twice a frame. Blender exports every material
 * without backface culling as double-sided; draw them in one pass. Returns the number of materials changed.
 */
export function singlePassTransparency(root: Object3D): number {
  const done = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!mat || done.has(mat) || !mat.transparent || mat.side !== DoubleSide) continue;
      mat.forceSinglePass = true;
      done.add(mat);
    }
  });
  return done.size;
}

export function discoverScreens(root: Object3D): DiscoveredScreen[] {
  const out: DiscoveredScreen[] = [];
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const id = screenIdFromMeshName(o.name);
    if (id) out.push({ id, mesh: o as Mesh });
  });
  return out;
}

export async function loadRoom(url: string): Promise<Room> {
  let scene: Group;
  let animations: AnimationClip[] = [];
  let fromGltf = true;
  let lightmapped = false;
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    scene = gltf.scene;
    animations = gltf.animations;
  } catch (err) {
    console.warn(`[room] could not load ${url}, using placeholder room`, err);
    scene = placeholderRoom();
    fromGltf = false;
  }
  if (fromGltf) {
    // Before lightmaps: their per-mesh material clones then inherit the overrides.
    const glass = replaceTransmission(scene);
    if (glass.length) console.info('[room] transmission → alpha blend:', glass.join(', '));
    const overridden = applyMaterialOverrides(scene, materialOverrides);
    if (overridden.length) console.info('[room] material overrides:', overridden.join(', '));
    try {
      const lm = await loadLightmaps(`${import.meta.env.BASE_URL}lightmaps`);
      lightmapped = Object.keys(lm.manifest).length > 0;
      const applied = applyLightmaps(scene, lm.manifest, lm.textures);
      if (applied.length) console.info('[room] lightmaps:', applied.join(', '));
    } catch (err) {
      console.warn('[room] could not load lightmaps', err);
    }
  }
  console.info(`[room] single-pass transparency on ${singlePassTransparency(scene)} materials`);
  scene.updateMatrixWorld(true);
  const screens = discoverScreens(scene);
  if (screens.length === 0) console.warn('[room] no Screen_* meshes found');
  else console.info('[room] screens:', screens.map((s) => s.id).join(', '));
  return { scene, screens, animations, fromGltf, lightmapped };
}
