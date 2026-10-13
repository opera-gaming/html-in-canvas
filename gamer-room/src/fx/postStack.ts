// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { HalfFloatType, NoToneMapping, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { postConfig } from '../config/post';
import type { JumpFloodOutline } from './JumpFloodOutline';
import { MsaaHdrExpandEffect } from './msaaHdr';

export interface PostStack {
  setFocusDistance(d: number): void;
  setSize(w: number, h: number): void;
  render(dtSec: number): void;
}

export function createPostStack(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  outline: JumpFloodOutline,
): PostStack {
  // Tone mapping is done in the composer, so the renderer must not apply it twice.
  renderer.toneMapping = NoToneMapping;

  const composer = new EffectComposer(renderer, { multisampling: 4, frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  // Undo compressForMsaa right after the MSAA resolve, before anything reads colour (own pass:
  // DoF samples its input at offsets, so it must see expanded colour).
  composer.addPass(new EffectPass(camera, new MsaaHdrExpandEffect()));

  if (postConfig.ao) {
    const ao = new N8AOPostPass(scene, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    ao.configuration.aoRadius = 0.6;
    ao.configuration.intensity = 2.0;
    ao.configuration.halfRes = true;
    composer.addPass(ao);
  }

  const dof = new DepthOfFieldEffect(camera, {
    focusDistance: 2.5,
    focusRange: 2.5 * postConfig.dof.focusRangeRatio,
    bokehScale: postConfig.dof.bokehScale,
  });
  const bloom = new BloomEffect({
    luminanceThreshold: postConfig.bloom.threshold,
    mipmapBlur: true,
    intensity: postConfig.bloom.intensity,
    radius: postConfig.bloom.radius,
  });
  const vignette = new VignetteEffect({ offset: postConfig.vignette.offset, darkness: postConfig.vignette.darkness });
  const aberration = new ChromaticAberrationEffect({
    offset: new Vector2(postConfig.aberration, postConfig.aberration),
    radialModulation: true,
    modulationOffset: 0.3,
  });
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

  // Only ChromaticAberration and SMAA carry EffectAttribute.CONVOLUTION, so they
  // each need their own pass; everything else can be merged. SMAA runs last on
  // the tone-mapped (display-referred) image, which is what it is tuned for.
  composer.addPass(new EffectPass(camera, dof));
  composer.addPass(new EffectPass(camera, bloom, outline));
  composer.addPass(new EffectPass(camera, aberration));
  composer.addPass(new EffectPass(camera, vignette, tone));
  composer.addPass(new EffectPass(camera, smaa));

  return {
    setFocusDistance(d) {
      dof.cocMaterial.focusDistance = d;
      dof.cocMaterial.focusRange = d * postConfig.dof.focusRangeRatio;
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
    render(dtSec) {
      composer.render(dtSec);
    },
  };
}
