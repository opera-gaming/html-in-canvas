// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { DoubleSide, HTMLTexture, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { ScreenRect } from '../scene/ScreenFitter';
import { markDrawable } from '../compat/htmlInCanvas';
import { mirrorWebGpuCanvas } from './canvasMirror';

const LOAD_TIMEOUT_MS = 8000;
/** Below 1 because a white web page at full emission floods the room. */
const SCREEN_EMISSIVE_INTENSITY = 0.75;

/**
 * three's emissivemap_fragment with an inline sRGB -> linear decode. The HTML element's
 * pixels are sRGB, but three uploads an HTMLTexture as plain RGBA8 (not SRGB8_ALPHA8),
 * so the GPU does not decode it on sampling; without this the screens look washed out.
 */
const EMISSIVE_SRGB_CHUNK = /* glsl */ `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
  vec3 c = emissiveColor.rgb;
  emissiveColor.rgb = mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif
`;

export class ScreenSurface {
  readonly id: string;
  readonly rect: ScreenRect;
  readonly mesh: Mesh;
  readonly proxy: Mesh;
  readonly element: HTMLDivElement;
  /** The screen's HTMLTexture: emissiveMap of the display mesh, and map of the hidden proxy (required by InteractionManager). */
  readonly texture: HTMLTexture;
  private rasterScale = 1;
  /** Pages with a mirrored WebGPU canvas keep scale 1: Opera GX 136 snapshots them unscaled, cropping the page. */
  private readonly fixedRasterScale: boolean;
  private iframe: HTMLIFrameElement;
  private timer: number | undefined;
  /** Sent to the page on every load and by postToPage (e.g. the room's mute state); same-origin pages only. */
  private pageMessages = new Map<string, unknown>();

  constructor(
    id: string,
    rect: ScreenRect,
    displayMesh: Mesh,
    src: string,
    private size: { width: number; height: number },
    fallbackSrc: string,
    mirrorCanvas?: string,
  ) {
    this.id = id;
    this.rect = rect;
    this.mesh = displayMesh;
    this.mesh.userData.screenId = id;

    this.element = document.createElement('div');
    this.element.className = 'screen-el';
    this.element.style.width = `${size.width}px`;
    this.element.style.height = `${size.height}px`;
    this.element.style.pointerEvents = 'none';

    this.iframe = document.createElement('iframe');
    this.iframe.src = src;
    this.iframe.width = String(size.width);
    this.iframe.height = String(size.height);
    this.iframe.style.border = '0';
    // Out of the tab order until the screen is focused (see setInteractive).
    this.iframe.tabIndex = -1;
    this.element.appendChild(this.iframe);

    this.iframe.addEventListener('load', () => this.clearTimer(), { once: true });
    // A missing or failing page still fires `load` (with the error page), so ask the server first: same-origin pages
    // that answer with an error status show the fallback at once. A network error leaves it to the load timeout.
    if (new URL(src, location.href).origin === location.origin) {
      fetch(src, { method: 'HEAD' }).then(
        (r) => {
          if (r.ok || this.iframe.src === new URL(fallbackSrc, location.href).href) return;
          this.clearTimer();
          console.warn(`[screen:${id}] ${src} answered HTTP ${r.status}, falling back to ${fallbackSrc}`);
          this.iframe.src = fallbackSrc;
        },
        () => {},
      );
    }
    this.iframe.addEventListener('load', () => {
      for (const m of this.pageMessages.values()) this.post(m);
    });
    // Focused iframes swallow keystrokes; forward Escape to the top window on every load (the fallback swap reloads).
    this.iframe.addEventListener('load', () => {
      try {
        this.iframe.contentWindow?.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
      } catch {
        // Cross-origin page: Escape cannot be forwarded, the Back button still works.
      }
    });
    this.fixedRasterScale = !!mirrorCanvas;
    if (mirrorCanvas) {
      this.iframe.addEventListener('load', () => {
        try {
          const win = this.iframe.contentWindow;
          if (win && mirrorWebGpuCanvas(win, mirrorCanvas))
            console.info(`[screen:${id}] mirroring ${mirrorCanvas} into a 2D canvas`);
        } catch {
          // Cross-origin page: nothing to mirror.
        }
      });
    }
    this.timer = window.setTimeout(() => {
      // `load` waits for every image and font. A same-origin page whose document has arrived is
      // still loading assets, not failing, so leave it be.
      let doc: Document | null = null;
      try {
        doc = this.iframe.contentDocument;
      } catch {
        /* cross-origin */
      }
      if (doc && doc.URL !== 'about:blank' && doc.readyState !== 'loading') return;
      console.warn(`[screen:${id}] ${src} did not load in ${LOAD_TIMEOUT_MS}ms, falling back to ${fallbackSrc}`);
      this.iframe.src = fallbackSrc;
    }, LOAD_TIMEOUT_MS);

    this.texture = new HTMLTexture(this.element);
    // Zoomed out, a whole page lands on ~150 px: without mipmaps it is point-sampled and crawls as
    // the camera drifts. The paint gate restores the mipmapped filter after each upload.
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 8; // three clamps to the device maximum; helps the angled arcade screen

    // Render on the original mesh so curved panels keep their shape.
    // Sample the texture through ONE sampler only (emissiveMap, no map): three uploads a texture once
    // per sampler per frame, and its HTML-texture registration path returns before recording the
    // version, so a second sampler in frame 1 would upload before any paint record exists.
    const material = new MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: this.texture,
      emissiveIntensity: SCREEN_EMISSIVE_INTENSITY,
      roughness: 0.6,
      metalness: 0.0,
      side: DoubleSide,
    });
    // Decode the sRGB element pixels to linear in the shader (see EMISSIVE_SRGB_CHUNK).
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', EMISSIVE_SRGB_CHUNK);
    };
    material.customProgramCacheKey = () => 'screen-srgb-emissive';
    displayMesh.material = material;

    // Hidden flat proxy at the chord rectangle; InteractionManager reads only its transform, bbox and material.map.
    this.proxy = new Mesh(new PlaneGeometry(rect.width, rect.height), new MeshBasicMaterial({ map: this.texture }));
    this.proxy.name = `ScreenProxy_${id}`;
    this.proxy.visible = false;
    const basis = new Matrix4().makeBasis(rect.right, rect.up, rect.normal);
    this.proxy.quaternion.setFromRotationMatrix(basis);
    this.proxy.position.copy(rect.center);
    this.proxy.updateMatrixWorld();
  }

  /**
   * Call once the renderer canvas exists: appends the element to the canvas and sets
   * both attribute generations. Uploads are driven by the app's paint listener
   * (see app/paintGate.ts); three's own registration/onpaint path is bypassed by design.
   */
  attachTo(canvas: HTMLCanvasElement): void {
    if (this.element.parentNode !== canvas) canvas.appendChild(this.element);
    markDrawable(canvas, this.element);
    // three only uploads a texture when version > 0, so this prevents any upload until our paint listener drives one.
    this.texture.version = 0;
  }

  /**
   * The page is rastered at the element's size times devicePixelRatio. Shrinking the element and
   * scaling the iframe inside it by `scale` keeps the page's layout (it still lays out at full
   * width) but rasters fewer pixels: at 1/devicePixelRatio a 1680 px page uploads in ~0.5 ms
   * instead of ~7.5 ms on a 2x display. Use a low scale while the screen is small on the canvas.
   */
  setRasterScale(scale: number): void {
    if (this.fixedRasterScale || scale === this.rasterScale) return;
    this.rasterScale = scale;
    this.element.style.width = `${this.size.width * scale}px`;
    this.element.style.height = `${this.size.height * scale}px`;
    this.iframe.style.transformOrigin = '0 0';
    this.iframe.style.transform = scale === 1 ? '' : `scale(${scale})`;
  }

  setInteractive(on: boolean): void {
    this.element.style.pointerEvents = on ? 'auto' : 'none';
    this.iframe.tabIndex = on ? 0 : -1;
    if (!on) this.iframe.blur();
  }
  focus(): void {
    this.iframe.focus();
  }

  /**
   * Posts `message` to the page now and again after every (re)load, replacing an earlier message with the same
   * `key`. Pages on another origin never receive it.
   */
  postToPage(key: string, message: unknown): void {
    this.pageMessages.set(key, message);
    this.post(message);
  }

  private post(message: unknown): void {
    this.iframe.contentWindow?.postMessage(message, location.origin);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
