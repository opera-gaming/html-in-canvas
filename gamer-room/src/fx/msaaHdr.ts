// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Material, Mesh, Object3D } from 'three';
import { BlendFunction, Effect } from 'postprocessing';

/**
 * HDR-aware MSAA. MSAA averages samples before tone mapping, so a thin LED at 5x white that
 * covers a quarter of a pixel still averages above 1 and tone-maps to full white: its edges stay
 * hard and crawl as the camera drifts. Compressing each fragment to [0, 1) with c / (1 + max(c))
 * before the resolve lets coverage blend; MsaaHdrExpandEffect undoes it right after the resolve.
 */
const COMPRESS = /* glsl */ `
  gl_FragColor.rgb /= 1.0 + max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));`;

/** Patch every material under `root` (each shared material once). Returns how many were patched. */
export function compressForMsaa(root: Object3D): number {
  const done = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!mat || done.has(mat)) continue;
      done.add(mat);
      const prevCompile = mat.onBeforeCompile.bind(mat);
      const prevKey = mat.customProgramCacheKey.bind(mat);
      mat.onBeforeCompile = (shader, renderer) => {
        prevCompile(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>${COMPRESS}`,
        );
      };
      mat.customProgramCacheKey = () => `${prevKey()}|msaa-hdr`;
      mat.needsUpdate = true;
    }
  });
  return done.size;
}

/** Inverse of the compression, c / (1 - max(c)), capped at 64x so a saturated sample stays finite. */
export class MsaaHdrExpandEffect extends Effect {
  constructor() {
    super(
      'MsaaHdrExpandEffect',
      /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float m = max(inputColor.r, max(inputColor.g, inputColor.b));
        outputColor = vec4(inputColor.rgb / max(1.0 - m, 1.0 / 64.0), inputColor.a);
      }`,
      { blendFunction: BlendFunction.SRC },
    );
  }
}
