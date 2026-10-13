// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import {
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RectAreaLight,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
  type Light,
} from 'three';
import type { ScreenSurface } from '../screens/ScreenSurface';
import { averageColor } from './averageColor';

/**
 * Light cast by a screen, tinted by the average colour of its content: a screen-sized area light
 * facing along the screen normal, so it lights the desk in front, not the wall behind. No shadow (too
 * costly). Add `lights` to the scene.
 */
export class ScreenLight {
  readonly lights: Light[];
  private rt = new WebGLRenderTarget(8, 8);
  private pixels = new Uint8Array(8 * 8 * 4);
  /** null until the first update, which schedules the first sample at now + offsetMs. */
  private nextSample: number | null = null;
  private tint = new Color(0.4, 0.4, 0.5);
  /** True while an async readback is in flight; no new sample starts until it lands. */
  private reading = false;
  // copyTextureToTexture cannot read an HTMLTexture (its image is a DOM element), so the screen is
  // sampled by drawing it on a fullscreen quad into the tiny render target and reading that back.
  private sampleScene = new Scene();
  private sampleCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadGeometry = new PlaneGeometry(2, 2);
  private quadMaterial: MeshBasicMaterial;

  /** `offsetMs` staggers the first sample so several screens' synchronous readbacks do not share a frame. */
  constructor(
    surface: ScreenSurface,
    private renderer: WebGLRenderer,
    private offsetMs = 0,
  ) {
    const { center, normal, width, height } = surface.rect;

    const area = new RectAreaLight(0xffffff, 2.0, width, height);
    area.position.copy(center).addScaledVector(normal, 0.02);
    area.lookAt(center.clone().add(normal)); // RectAreaLight emits along its local -Z, which lookAt aims at the target

    this.lights = [area];
    this.quadMaterial = new MeshBasicMaterial({ map: surface.texture });
    this.sampleScene.add(new Mesh(this.quadGeometry, this.quadMaterial));
  }

  /** Call only once the paint gate is open, so the screen texture has been uploaded. */
  update(nowMs: number): void {
    if (this.nextSample === null) this.nextSample = nowMs + this.offsetMs;
    if (nowMs >= this.nextSample && !this.reading) {
      this.nextSample = nowMs + 250;
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.rt);
      this.renderer.render(this.sampleScene, this.sampleCamera);
      this.renderer.setRenderTarget(prev);
      // Async readback (PBO + fence): a synchronous readPixels stalls until the GPU drains.
      this.reading = true;
      this.renderer
        .readRenderTargetPixelsAsync(this.rt, 0, 0, 8, 8, this.pixels)
        .then(() => {
          const [r, g, b] = averageColor(this.pixels);
          this.tint.setRGB(r, g, b);
        })
        .catch(() => {}) // context loss mid-read: keep the previous tint
        .finally(() => {
          this.reading = false;
        });
    }
    for (const l of this.lights) l.color.lerp(this.tint, 0.1);
  }
}
