// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export interface MaterialOverride {
  emissiveIntensity?: number;
  color?: number;
  roughness?: number;
  metalness?: number;
}

/** Per-material tweaks by glTF material name; Blender emission strengths come out far hotter under ACES. */
export const materialOverrides: Record<string, MaterialOverride> = {
  // Their emission maps read as uniform in three.js, so the whole mesh glows.
  MAT_PC_With_Window: { emissiveIntensity: 0 },
  MAT_Speaker_Mesh: { emissiveIntensity: 0 },
};
