// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Static page renderer: background quad + one textured quad per body.
// heightScale / heightRest = TUNING (sim.ts); shadowAlpha = body drop-shadow alpha. PAGE_SIZE (config.ts) is
// prepended as a const by render.ts.
struct Uniforms { viewMat: mat3x3f, time: f32, heightScale: f32, heightRest: f32, shadowAlpha: f32 };

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> poses: array<Pose>;
@group(0) @binding(2) var<storage, read> shapes: array<Shape>;
@group(0) @binding(3) var<storage, read> props: array<Props>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var contentTex: texture_2d<f32>;
@group(0) @binding(6) var backgroundTex: texture_2d<f32>;
// Which bodies a body/shadow draw covers: 0 = all, 1 = not scooped (under the blade), 2 = scooped (over the blade).
struct BodyLayer { layer: u32, _p0: u32, _p1: u32, _p2: u32 };
@group(0) @binding(7) var<uniform> bl: BodyLayer;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

fn toClip(world: vec2f) -> vec4f {
  return vec4f((u.viewMat * vec3f(world, 1.0)).xy, 0.0, 1.0);
}

// Strip order (0,1,3,2) turns the CCW corner list into two triangles.
const STRIP = array<u32, 4>(0u, 1u, 3u, 2u);

@vertex fn vs_background(@builtin(vertex_index) vi: u32) -> VOut {
  let corners = array<vec2f, 4>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let c = corners[STRIP[vi]];
  var o: VOut;
  o.pos = toClip(c * PAGE_SIZE);
  o.uv = c;
  return o;
}

@fragment fn fs_background(i: VOut) -> @location(0) vec4f {
  return textureSample(backgroundTex, samp, i.uv);
}

// Body quad with fake pile height. e = height above heightRest; at e = 0 (all untouched page text,
// whose height stays 0) the body draws exactly as the page: no scale, no shade, no shadow.
struct BodyOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) shade: f32,   // body: colour multiplier; shadow: alpha
};

fn bodyCorner(bi: u32, vi: u32, shadow: bool) -> BodyOut {
  var o: BodyOut;
  let f = props[bi].flags;
  let scooped = (f & FLAG_SCOOPED) != 0u;
  if ((f & FLAG_ACTIVE) == 0u || (bl.layer == 1u && scooped) || (bl.layer == 2u && !scooped)) {
    o.pos = vec4f(-2.0, -2.0, 0.0, 1.0); // degenerate: every corner at one off-screen point
    return o;
  }
  let k = STRIP[vi];
  let p = poses[bi];
  let s = shapes[bi];
  let h = props[bi].height;
  let e = clamp(h - u.heightRest, 0.0, 4.0);
  let on = smoothstep(0.0, 0.35, e);
  let scale = 1.0 + u.heightScale * e;
  var world = p.pos + rot(p.angle) * (s.v[k] * scale);
  if (shadow) {
    // Offset capped at (4, 6) px: a larger offset than the text height reads as a second layer of illegible text
    // instead of depth. Small bodies (thin text strokes) fade out of the shadow pass, so squeezed bands of tiny
    // words don't cast hair-like grey streaks.
    world += vec2f(2.0, 3.0) * min(1.0 + e, 2.0) * on;
    let thick = min(length(s.v[1] - s.v[0]), length(s.v[2] - s.v[1]));
    o.shade = u.shadowAlpha * on * smoothstep(8.0, 24.0, thick);
  } else {
    // Lower layers of a heap darker, the top lighter.
    o.shade = mix(1.0, mix(0.92, 1.05, saturate(e / 3.0)), on);
  }
  o.pos = toClip(world);
  o.uv = s.uv[k];
  return o;
}

@vertex fn vs_body(@builtin(instance_index) bi: u32, @builtin(vertex_index) vi: u32) -> BodyOut {
  return bodyCorner(bi, vi, false);
}

@fragment fn fs_body(i: BodyOut) -> @location(0) vec4f {
  let t = textureSample(contentTex, samp, i.uv); // premultiplied alpha
  return vec4f(min(t.rgb * i.shade, vec3f(t.a)), t.a);
}

@vertex fn vs_shadow(@builtin(instance_index) bi: u32, @builtin(vertex_index) vi: u32) -> BodyOut {
  var o = bodyCorner(bi, vi, true);
  if (o.shade <= 0.0) { o.pos = vec4f(-2.0, -2.0, 0.0, 1.0); } // resting bodies cast no shadow: skip raster
  return o;
}

// Stencil (render.ts): drawn only where no shadow is yet, so at most one shadow layer per pixel. Near-transparent
// texels are discarded so they don't claim the stencil.
@fragment fn fs_shadow(i: BodyOut) -> @location(0) vec4f {
  let a = textureSample(contentTex, samp, i.uv).a;
  if (a < 0.1) { discard; }
  return vec4f(0.0, 0.0, 0.0, a * i.shade);
}

// Bulldozer layers (group 1): one draw per art layer (render.ts drawLayers).
// quad = (minX, maxX, minY, maxY) in dozer-local space (x forward, blade at +x, +y = the driver's right); the texture
// maps onto it with u along x and v along y. uShift scrolls a tread texture along u (repeat sampler). cutSide splits
// dozer.png along the line cut.xy → cut.zw (texture uv): +1 keeps the body side (cross >= 0), −1 the blade side,
// 0 all; both layers interpolate the same uv, so every pixel lands in exactly one of them. shadow = 1 draws the
// layer's soft drop shadow (alpha × shadow alpha, 5 taps blur.xy apart in uv) offset by `offset` world px.
struct Layer {
  pos: vec2f, angle: f32, alpha: f32,
  quad: vec4f,
  offset: vec2f, uShift: f32, shadow: f32,
  cut: vec4f,
  cutSide: f32, _p: f32, blur: vec2f,
};
@group(1) @binding(0) var<uniform> ly: Layer;
@group(1) @binding(1) var layerTex: texture_2d<f32>;
@group(1) @binding(2) var layerSamp: sampler;

struct LayerOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs_layer(@builtin(vertex_index) vi: u32) -> LayerOut {
  let corners = array<vec2f, 4>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let c = corners[STRIP[vi]];
  let local = vec2f(mix(ly.quad.x, ly.quad.y, c.x), mix(ly.quad.z, ly.quad.w, c.y));
  var o: LayerOut;
  o.pos = toClip(ly.pos + rot(ly.angle) * local + ly.offset);
  o.uv = c;
  return o;
}

@fragment fn fs_layer(i: LayerOut) -> @location(0) vec4f {
  if (ly.cutSide != 0.0) {
    let e = ly.cut.zw - ly.cut.xy;
    let r = i.uv - ly.cut.xy;
    let k = e.x * r.y - e.y * r.x;
    if ((ly.cutSide > 0.0 && k < 0.0) || (ly.cutSide < 0.0 && k >= 0.0)) { discard; }
  }
  let uv = vec2f(i.uv.x - ly.uShift, i.uv.y);
  if (ly.shadow > 0.0) {
    let b = ly.blur;
    let b2 = vec2f(b.x, -b.y);
    let a = 0.4 * textureSample(layerTex, layerSamp, uv).a
      + 0.15 * (textureSample(layerTex, layerSamp, uv + b).a + textureSample(layerTex, layerSamp, uv - b).a
              + textureSample(layerTex, layerSamp, uv + b2).a + textureSample(layerTex, layerSamp, uv - b2).a);
    if (a < 0.02) { discard; } // keep transparent texels from claiming the stencil
    return vec4f(0.0, 0.0, 0.0, a * ly.alpha);
  }
  return textureSample(layerTex, layerSamp, uv) * ly.alpha; // premultiplied alpha
}

// Track decals (group 1): faint tread prints from a FIFO ring (decals.ts, render.ts), drawn over the page background
// and under the text. decal[i] = (x, y, angle, seq) | (side, -, -, -). seq = stamp number; a print `age` stamps old
// has alpha alphaNew · (1 − age / cap) (decals.ts decalAlpha); prints older than minSeq (R reset) are hidden.
const DECAL_EDGE: f32 = 0.35;
struct DecalU { seqNow: f32, minSeq: f32, cap: f32, alphaNew: f32, half: vec2f, uSpan: f32, _p: f32 };
struct Decal { a: vec4f, b: vec4f };
@group(1) @binding(0) var<uniform> du: DecalU;
@group(1) @binding(1) var<storage, read> decals: array<Decal>;
@group(1) @binding(2) var treadL: texture_2d<f32>;
@group(1) @binding(3) var treadR: texture_2d<f32>;
@group(1) @binding(4) var decalSamp: sampler;

struct DecalOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) look: vec2f,   // alpha, side
};

@vertex fn vs_decal(@builtin(instance_index) ii: u32, @builtin(vertex_index) vi: u32) -> DecalOut {
  var o: DecalOut;
  let d = decals[ii];
  let age = du.seqNow - d.a.w;
  if (d.a.w < du.minSeq || age < 0.0 || age >= du.cap) {
    o.pos = vec4f(-2.0, -2.0, 0.0, 1.0);
    return o;
  }
  let corners = array<vec2f, 4>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let c = corners[STRIP[vi]];
  let local = (c * 2.0 - 1.0) * du.half;
  o.pos = toClip(d.a.xy + rot(d.a.z) * local);
  o.uv = vec2f(c.x * du.uSpan, c.y);
  o.look = vec2f(du.alphaNew * (1.0 - age / du.cap), d.b.x);
  return o;
}

@fragment fn fs_decal(i: DecalOut) -> @location(0) vec4f {
  let l = textureSample(treadL, decalSamp, i.uv);
  let r = textureSample(treadR, decalSamp, i.uv);
  let t = select(l, r, i.look.y > 0.5); // premultiplied
  // The dark rubber lugs print, the lighter links between them hardly at all ((1 − lum)³ contrast), so a print reads
  // as a row of lug marks rather than a grey band; tinted earth-dark.
  let lum = saturate(dot(t.rgb, vec3f(0.299, 0.587, 0.114)) / max(t.a, 1e-3));
  let dark = 1.0 - lum;
  // Soft sides: fade out across the tread width (uv.y) over DECAL_EDGE of each side, so the trail has no hard edge.
  let edge = smoothstep(0.0, DECAL_EDGE, min(i.uv.y, 1.0 - i.uv.y));
  let a = i.look.x * t.a * dark * dark * dark * edge;
  return vec4f(vec3f(0.12, 0.10, 0.08) * a, a);
}

// Exhaust smoke: one instanced soft round sprite per particle (smoke.ts), drawn above everything.
// inst = (x, y, radius, alpha) | (grey, seed, -, -); premultiplied output = grey · a.
struct SmokeOut {
  @builtin(position) pos: vec4f,
  @location(0) c: vec2f,
  @location(1) @interpolate(flat) look: vec4f,   // alpha, grey, seed, -
};

@vertex fn vs_smoke(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> SmokeOut {
  let corners = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[STRIP[vi]];
  var o: SmokeOut;
  o.pos = toClip(a.xy + c * a.z);
  o.c = c;
  o.look = vec4f(a.w, b.x, b.y, 0.0);
  return o;
}

@fragment fn fs_smoke(i: SmokeOut) -> @location(0) vec4f {
  let r = length(i.c);
  // Soft disc with a little lumpy variation (per-particle phase), so overlapping puffs don't read as clean circles.
  let ang = atan2(i.c.y, i.c.x);
  let lump = 0.85 + 0.15 * sin(ang * 3.0 + i.look.z) * sin(ang * 5.0 - i.look.z * 1.7);
  let a = i.look.x * smoothstep(1.0, 0.15, r / lump);
  if (a < 0.003) { discard; }
  return vec4f(vec3f(i.look.y * a), a);
}
