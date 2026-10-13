// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import {
  Camera,
  Color,
  DoubleSide,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { jfaSteps } from './jfa';

const SEED_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(gl_FragCoord.xy, 1.0, 1.0); }
`;
const SEED_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Each texel keeps the nearest seed found among itself and its 8 neighbours at `step` texels. */
const JFA_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSeed;
  uniform vec2 texel;      // 1 / size
  uniform float jumpStep;
  varying vec2 vUv;
  void main() {
    vec2 here = gl_FragCoord.xy;
    vec4 best = texture2D(tSeed, vUv);
    float bestD = best.z > 0.5 ? distance(here, best.xy) : 1e20;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        if (x == 0 && y == 0) continue;
        vec2 uv = vUv + vec2(float(x), float(y)) * jumpStep * texel;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
        vec4 s = texture2D(tSeed, uv);
        if (s.z < 0.5) continue;
        float d = distance(here, s.xy);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    gl_FragColor = best;
  }
`;

/** postprocessing Effect fragment: outline where distance to the nearest seed is within width. */
const OUTLINE_FRAG = /* glsl */ `
  uniform sampler2D tJfa;
  uniform vec2 jfaScale;      // full-res px per jfa texel (x, y)
  uniform float width;        // full-res px
  uniform float softness;     // full-res px
  uniform vec3 color;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 s = texture2D(tJfa, uv);
    if (s.z < 0.5 || width <= 0.0) { outputColor = inputColor; return; }
    vec2 here = uv * resolution;
    vec2 seed = s.xy * jfaScale;
    float d = distance(here, seed);
    float a = 1.0 - smoothstep(width - softness, width + softness, d);
    // Interior pixels sit within ~0.7 jfa texels of their own seed; start the rim above that quantisation error.
    float rim = smoothstep(0.75 * jfaScale.x, 1.5 * jfaScale.x, d);
    // Composite here so the result is correct under any blend function (NORMAL ignores alpha).
    float k = clamp(a * rim, 0.0, 1.0);
    outputColor = vec4(mix(inputColor.rgb, color, k), inputColor.a);
  }
`;

export class JumpFloodOutline extends Effect {
  width = 0;
  private target: Mesh | null = null;
  private seedMat = new ShaderMaterial({ vertexShader: SEED_VERT, fragmentShader: SEED_FRAG, side: DoubleSide });
  private jfaMat: ShaderMaterial;
  private rtA: WebGLRenderTarget;
  private rtB: WebGLRenderTarget;
  private quad: Mesh;
  private quadScene = new Scene();
  private quadCam: Camera;
  private scale: number;
  private size = new Vector2(1, 1);
  private prevClearColor = new Color();

  constructor(
    _scene: Scene,
    private camera: Camera,
    opts: { color?: Color; softness?: number; scale?: number } = {},
  ) {
    super('JumpFloodOutline', OUTLINE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.NONE,
      uniforms: new Map<string, Uniform>([
        ['tJfa', new Uniform(null)],
        ['jfaScale', new Uniform(new Vector2(2, 2))],
        ['width', new Uniform(0)],
        ['softness', new Uniform(opts.softness ?? 1.5)],
        ['color', new Uniform(opts.color ?? new Color(0xfa1e4e))],
      ]),
    });
    this.scale = opts.scale ?? 0.5;
    const rtOpts = {
      format: RGBAFormat,
      type: FloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtA = new WebGLRenderTarget(1, 1, rtOpts);
    this.rtB = new WebGLRenderTarget(1, 1, rtOpts);
    this.jfaMat = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: JFA_FRAG,
      uniforms: { tSeed: { value: null }, texel: { value: new Vector2() }, jumpStep: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    // Fullscreen quad for the JFA passes
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.jfaMat);
    this.quadScene.add(this.quad);
    this.quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setTarget(mesh: Mesh | null): void {
    this.target = mesh;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width * this.scale));
    const h = Math.max(1, Math.floor(height * this.scale));
    this.size.set(w, h);
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    (this.jfaMat.uniforms.texel!.value as Vector2).set(1 / w, 1 / h);
    (this.uniforms.get('jfaScale')!.value as Vector2).set(width / w, height / h);
  }

  override update(renderer: WebGLRenderer): void {
    this.uniforms.get('width')!.value = this.width;
    if (!this.target || this.width <= 0) {
      this.uniforms.get('tJfa')!.value = null;
      return;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this.prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    // 1. Seed pass: only the target mesh, writing its pixel coordinates.
    renderer.setRenderTarget(this.rtA);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    const material = this.target.material;
    this.target.material = this.seedMat;
    renderer.autoClear = false;
    renderer.render(this.target, this.camera);
    this.target.material = material;

    // 2. Jump flood ping-pong.
    let read = this.rtA,
      write = this.rtB;
    for (const step of jfaSteps(this.size.x, this.size.y)) {
      this.jfaMat.uniforms.tSeed!.value = read.texture;
      this.jfaMat.uniforms.jumpStep!.value = step;
      renderer.setRenderTarget(write);
      renderer.render(this.quadScene, this.quadCam);
      [read, write] = [write, read];
    }
    this.uniforms.get('tJfa')!.value = read.texture;

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this.prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  override dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.seedMat.dispose();
    this.jfaMat.dispose();
    this.quad.geometry.dispose();
    super.dispose();
  }
}
