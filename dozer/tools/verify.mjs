// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Headless end-to-end check: boots the app in Chromium with WebGPU + HTML-in-Canvas, waits for the first rendered
// frame, screenshots it and optionally runs a scripted action.
// Usage: node tools/verify.mjs [query] [action] [--debug]
//   query   e.g. "?max=auto+2000" or "capture=2d" (leading "?" optional)
//   action  a key of ACTIONS below
//   --debug adds `debug` to the query; with debug in the query, window.__dozer.stats() is recorded. Every action
//   except `resize` counts simulation steps and needs debug. Every action except `intro` first waits for the
//   scripted intro to finish, so it starts from the intro's end pose (in the hero text, facing right, stopped).
// Env:
//   VERIFY_PORT=n              serve on port n (default 5180)
//   VERIFY_OUT=dir             screenshot directory (default tools/out/)
//   VERIFY_LOGS=1              add the page's console log to the report
//   VERIFY_NO_REQUEST_PAINT=1  delete HTMLCanvasElement.prototype.requestPaint before the app loads
//   VERIFY_GPU=1               use the real GPU instead of SwiftShader
//   VERIFY_DPR=2               render at 2× device pixels
// `?prof` in the query records the profiler report (src/gpu/prof.ts) over the action as result.prof.
// Prints JSON { bodies, errors, consoleErrors, screenshots[, stats] }; exits 1 on any error or 0 bodies.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** World / page size in CSS px, read from src/config.ts so the checks follow it. */
const PAGE_SIZE = Number(/export const PAGE_SIZE = (\d+)/.exec(readFileSync(`${ROOT}src/config.ts`, 'utf8'))?.[1]);
if (!(PAGE_SIZE > 0)) throw new Error('verify: could not read PAGE_SIZE from src/config.ts');
/** Screenshot directory: tools/out/, or VERIFY_OUT (lets several runs go in parallel). */
const OUT = process.env.VERIFY_OUT
  ? `${process.env.VERIFY_OUT.replace(/\/$/, '')}/`
  : fileURLToPath(new URL('./out/', import.meta.url));
/** VERIFY_PORT lets verify run next to the dev server (which owns 5180). */
const PORT = Number(process.env.VERIFY_PORT) || 5180;
/**
 * VERIFY_GPU=1 runs on the machine's real GPU (Metal on macOS) instead of SwiftShader, with unquantised WebGPU
 * timestamps (developer features) for `?prof`.
 */
const LAUNCH_ARGS = process.env.VERIFY_GPU
  ? [
      '--enable-blink-features=CanvasDrawElement',
      '--enable-unsafe-webgpu',
      '--use-angle=metal',
      '--enable-webgpu-developer-features',
      '--ignore-gpu-blocklist',
    ]
  : [
      '--enable-blink-features=CanvasDrawElement',
      '--enable-unsafe-webgpu',
      '--use-webgpu-adapter=swiftshader',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
    ];

/** Scripted actions, run after frame0: `async (page, ctx) => void`; push extra shots to ctx.screenshots. */
const shot = async (page, ctx, name) => {
  const path = `${OUT}${name}`;
  await page.screenshot({ path });
  ctx.screenshots.push(path);
};
/** Simulation steps per simulated second (src/stepper.ts FIXED_DT = 1/60); action budgets are written in seconds. */
const STEPS_PER_SEC = 60;
const sec = (s) => Math.round(s * STEPS_PER_SEC);
const simFrame = (page) =>
  page.evaluate(() => {
    if (!window.__dozer) throw new Error('window.__dozer missing: frame-based actions need ?debug');
    return window.__dozer.frame();
  });
/**
 * Holds `keys` until the simulation has advanced `frames` fixed steps (SwiftShader renders ~9 fps, so wall-clock
 * holds barely move anything; each rendered frame runs at most 2 steps of 1/60 s). `until(page)` may end the hold
 * early.
 */
const holdKeysForFrames = async (page, keys, frames, until = null, probe = null) => {
  const start = await simFrame(page);
  for (const k of keys) await page.keyboard.down(k);
  const probeAt = [...(probe?.at ?? [])];
  try {
    for (;;) {
      const f = await simFrame(page);
      if (f - start >= frames || (until && (await until(page)))) return f - start;
      // probe = { at: [step offsets], fn }: fn(page) runs (keys still held) once the hold passes each offset.
      if (probeAt.length && f - start >= probeAt[0]) {
        probeAt.shift();
        await probe.fn(page);
        continue;
      }
      await page.waitForTimeout(20);
    }
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
};
const dozerState = (page) => page.evaluate(() => window.__dozer.dozer());
/**
 * True once the dozer is against the top wall: the walls clamp the cutting edge, which reaches up to ~18 px ahead of
 * the push quads, so the quads stop that far short of the wall.
 */
const atTopWall = async (page) => {
  const f = await page.evaluate(() => window.__dozer.footprint());
  return Math.min(...[...f.chassis, ...f.blade, ...f.wing].map((v) => v[1])) <= 22;
};
/**
 * Screenshot crop of `w` × `h` CSS px centred on world point (x, y) (clamped to the viewport), saved as `name`.
 */
const shotAt = async (page, ctx, name, x, y, w, h) => {
  const [sx, sy] = await page.evaluate(([px, py]) => window.__dozer.toScreen(px, py), [x, y]);
  const vp = page.viewportSize();
  const path = `${OUT}${name}`;
  const clip = {
    x: Math.min(vp.width - w, Math.max(0, sx - w / 2)),
    y: Math.min(vp.height - h, Math.max(0, sy - h / 2)),
    width: w,
    height: h,
  };
  await page.screenshot({ path, clip });
  ctx.screenshots.push(path);
  return [Math.round((sx - clip.x) * 10) / 10, Math.round((sy - clip.y) * 10) / 10]; // (x, y) inside the crop
};
/**
 * Tread scroll check: a short throttle burst, then two zoomed shots of the coasting dozer a few steps apart
 * (tracks-a.png, tracks-b.png). Coasting keeps the travel between the shots below half a tread lug (11.5 world px),
 * so the pattern's direction is unambiguous; the tread travel (world px, forward positive) is recorded with each shot.
 */
const tracksPair = async (page, ctx) => {
  await holdKeysForFrames(page, ['KeyW'], 2);
  const snap = async (name) => {
    const d = await dozerState(page);
    const t = await page.evaluate(() => window.__dozer.treads());
    const at = await shotAt(page, ctx, name, d.x, d.y, 360, 360);
    return {
      frame: await simFrame(page),
      at,
      angle: Math.round(d.angle * 1000) / 1000,
      speed: Math.round(d.speed * 10) / 10,
      left: Math.round(t.left * 100) / 100,
      right: Math.round(t.right * 100) / 100,
    };
  };
  const a = await snap('tracks-a.png');
  const f0 = await simFrame(page);
  while ((await simFrame(page)) - f0 < 3) await page.waitForTimeout(10);
  const b = await snap('tracks-b.png');
  ctx.tracks = { a, b };
  if (!(b.left > a.left && b.right > a.right))
    ctx.errors.push(`tracks: treads did not advance while driving forward ${JSON.stringify(ctx.tracks)}`);
};
/**
 * Teleport check: the largest distance any body centre moves in ONE simulation step. A body that moves more than
 * TELEPORT_BUDGET px in a step visibly jumps. 12 px: the blade's own per-step travel is ≤ 4.3 px driving straight
 * (260 px/s at 1/60 s) and ≤ ~9.5 px at the leading blade tip in a full-speed turn (260 + 1.9 rad/s × ~165 px);
 * 12 leaves a little room for one capped contact correction on top.
 */
const TELEPORT_BUDGET = 12;
/** icebreaker: the largest image must end up in more than this many pieces. */
const ICE_MIN_SHARDS = 30;
/** One posePair sample: per-body single-step displacements (moving bodies only) plus the worst offenders. */
const stepDisplacement = (page) =>
  page.evaluate(async () => {
    const [a, b] = await window.__dozer.posePair();
    const moved = [];
    const top = [];
    let fractured = 0;
    for (let i = 0; i < Math.min(a.count, b.count); i++) {
      if (!(a.flags[i] & 1) || !(b.flags[i] & 1)) continue;
      // A body that fractured this step is re-centred on its kept half (not a visible jump): skip it.
      if (b.cooldown[i] > a.cooldown[i]) {
        fractured++;
        continue;
      }
      const m = Math.hypot(b.x[i] - a.x[i], b.y[i] - a.y[i]);
      if (!(m > 0.01) && Number.isFinite(m)) continue;
      moved.push(m);
      top.push({ i, m: Math.round(m * 100) / 100, x: Math.round(b.x[i]), y: Math.round(b.y[i]) });
    }
    top.sort((p, q) => q.m - p.m);
    return { frames: [a.frame, b.frame], moved, fractured, top: top.slice(0, 3) };
  });
/** Collects stepDisplacement samples into ctx.teleport and fails the run if any step exceeds TELEPORT_BUDGET. */
const teleportProbe = (ctx, label) => async (page) => {
  const r = await stepDisplacement(page);
  const t = (ctx.teleport ??= { budgetPx: TELEPORT_BUDGET, samples: [], all: [] });
  const v = [...r.moved].sort((p, q) => p - q);
  const max = v.length ? v[v.length - 1] : 0;
  t.samples.push({
    label,
    frames: r.frames,
    moving: v.length,
    fractured: r.fractured,
    maxPx: Math.round(max * 100) / 100,
    top: r.top,
  });
  t.all.push(...v);
};
const finishTeleport = (ctx) => {
  const t = ctx.teleport;
  if (!t) return;
  const v = t.all.sort((p, q) => p - q);
  delete t.all;
  t.maxPx = v.length ? Math.round(v[v.length - 1] * 100) / 100 : 0;
  t.p99Px = v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(0.99 * v.length))] * 100) / 100 : 0;
  t.p50Px = v.length ? Math.round(v[Math.floor(0.5 * v.length)] * 100) / 100 : 0;
  t.movingSamples = v.length;
  if (!(t.maxPx <= t.budgetPx))
    ctx.errors.push(`teleport: a body moved ${t.maxPx} px in one step (budget ${t.budgetPx} px)`);
};
/** Pose census: bounds/finiteness plus how many body centres lie inside the dozer's collision quads (should be 0). */
const census = (page) =>
  page.evaluate(async (PAGE) => {
    // Read the dozer in the same tick as the pose copy is submitted, so both describe the same frame.
    const d = window.__dozer.dozer();
    const fp = window.__dozer.footprint();
    const p = await window.__dozer.poses();
    const c = Math.cos(d.angle),
      s = Math.sin(d.angle);
    // Point in a convex quad with positive shoelace area (dozer.ts winding): cross(edge, p - v_k) >= 0 for every edge.
    const inQuad = (q, x, y) =>
      q.every((a, k) => {
        const b = q[(k + 1) % 4];
        return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0;
      });
    // Blade surface velocity at (x, y) along quad q's front normal (q[0] → q[1]) > 1 px/s (dozer.wgsl PUSH_EPS).
    const pushingAt = (q, x, y) => {
      const nx = q[1][0] - q[0][0],
        ny = q[1][1] - q[0][1],
        len = Math.hypot(nx, ny);
      const vx = d.vx - d.angVel * (y - d.y),
        vy = d.vy + d.angVel * (x - d.x);
      // dozer.wgsl pushes(): into the body, and not more than 60° backward relative to the heading.
      return (vx * nx + vy * ny) / len > 1 && vx * c + vy * s >= -0.5 * Math.hypot(vx, vy);
    };
    // Blade front face: the edge whose outward normal (e.y, -e.x) points most along the dozer's heading.
    let front = null;
    for (let k = 0; k < 4; k++) {
      const a = fp.blade[k],
        b = fp.blade[(k + 1) % 4];
      const ex = b[0] - a[0],
        ey = b[1] - a[1],
        len = Math.hypot(ex, ey);
      const nx = ey / len,
        ny = -ex / len;
      if (!front || nx * c + ny * s > front.f)
        front = { f: nx * c + ny * s, nx, ny, a, ux: ex / len, uy: ey / len, len };
    }
    let active = 0,
      asleep = 0,
      outOfBounds = 0,
      nonFinite = 0,
      insideDozer = 0,
      ahead = 0,
      aheadFar = 0,
      sides = 0,
      behind = 0;
    // Pile heights (props.height): raised = visibly drawn as a heap: height > heightRest (1.1, sim.ts TUNING) + the
    // 0.35 fade-in margin (render.wgsl smoothstep), i.e. > 1.45.
    let raised = 0,
      raisedAsleep = 0,
      maxHeight = 0;
    const insideSample = [];
    for (let i = 0; i < p.count; i++) {
      if (!(p.flags[i] & 1)) continue;
      active++;
      if (p.flags[i] & 2) asleep++;
      const x = p.x[i],
        y = p.y[i],
        a = p.angle[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(a)) {
        nonFinite++;
        continue;
      }
      const h = p.height[i];
      if (h > 1.45) {
        raised++;
        if (p.flags[i] & 2) raisedAsleep++;
      }
      if (h > maxHeight) maxHeight = h;
      if (x < 0 || x > PAGE || y < 0 || y > PAGE) outOfBounds++;
      const lx = (x - d.x) * c + (y - d.y) * s,
        ly = -(x - d.x) * s + (y - d.y) * c;
      // Push quads only, and only while that quad is pushing at the body (its surface moving into it along the front
      // normal): the dozer runs over words, a non-pushing blade leaves them, and scooped words in front are fine.
      if (
        (inQuad(fp.blade, x, y) && pushingAt(fp.blade, x, y)) ||
        (inQuad(fp.wing, x, y) && pushingAt(fp.wing, x, y))
      ) {
        insideDozer++;
        if (insideSample.length < 5)
          insideSample.push({
            i,
            x: Math.round(x),
            y: Math.round(y),
            lx: Math.round(lx),
            ly: Math.round(ly),
            flags: p.flags[i],
            height: Math.round(h * 100) / 100,
          });
      }
      // Ahead = in front of the blade's front face (distance along its normal), within the blade's length.
      const fd = (x - front.a[0]) * front.nx + (y - front.a[1]) * front.ny;
      const fu = (x - front.a[0]) * front.ux + (y - front.a[1]) * front.uy;
      const alongBlade = fu >= 0 && fu <= front.len;
      if (alongBlade && fd > 0 && fd < 100) ahead++;
      if (alongBlade && fd >= 100 && fd < 300) aheadFar++;
      if (lx >= -86 && lx <= 86 && Math.abs(ly) > 55 && Math.abs(ly) < 155) sides++; // chassis: lx ±86, ly ±48
      if (lx < -86 && lx > -400 && Math.abs(ly) <= 50) behind++;
    }
    return {
      active,
      asleep,
      outOfBounds,
      nonFinite,
      insideDozer,
      ahead100: ahead,
      ahead100to300: aheadFar,
      sides100: sides,
      trailBehind320: behind,
      raised,
      raisedAsleep,
      maxHeight: Math.round(maxHeight * 100) / 100,
      ...(insideSample.length ? { insideSample } : {}),
    };
  }, PAGE_SIZE);
/** Occupancy field summary: max and high percentiles of the blurred per-cell occupancy. */
const occStats = (page) =>
  page.evaluate(async () => {
    const { values } = await window.__dozer.occ();
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    const q = (f) => Math.round(v[Math.min(v.length - 1, Math.floor(f * v.length))] * 100) / 100;
    return {
      p50: q(0.5),
      p90: q(0.9),
      p99: q(0.99),
      p999: q(0.999),
      max: q(1),
      over1: v.filter((x) => x > 1).length,
      over1_6: v.filter((x) => x > 1.6).length,
    };
  });
/**
 * Stress histogram (props.stress) of awake bodies: all awake, those in the ~100 px band ahead of the blade, and
 * words brushing the chassis sides (sideWord).
 * Buckets are powers of two; also high percentiles. Useful for tuning TUNING.stressWord / stressObject.
 */
const stressStats = (page) =>
  page.evaluate(async () => {
    const d = window.__dozer.dozer();
    const p = await window.__dozer.poses();
    const c = Math.cos(d.angle),
      s = Math.sin(d.angle);
    const groups = { awakeWord: [], awakeObject: [], aheadWord: [], aheadObject: [], sideWord: [] };
    for (let i = 0; i < p.count; i++) {
      const f = p.flags[i];
      if ((f & 3) !== 1) continue;
      const word = (f & 4) !== 0;
      const st = p.stress[i];
      (word ? groups.awakeWord : groups.awakeObject).push(st);
      const lx = (p.x[i] - d.x) * c + (p.y[i] - d.y) * s,
        ly = -(p.x[i] - d.x) * s + (p.y[i] - d.y) * c;
      if (lx > 90 && lx < 200 && Math.abs(ly) <= 65) (word ? groups.aheadWord : groups.aheadObject).push(st);
      if (word && lx >= -86 && lx <= 86 && Math.abs(ly) > 48 && Math.abs(ly) < 85) groups.sideWord.push(st);
    }
    const summary = (v) => {
      v.sort((a, b) => a - b);
      const q = (f) => (v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(f * v.length))] * 10) / 10 : null);
      const hist = {};
      for (const x of v) {
        const b = x < 1 ? '<1' : `${2 ** Math.floor(Math.log2(x))}+`;
        hist[b] = (hist[b] ?? 0) + 1;
      }
      return { n: v.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1), hist };
    };
    return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, summary(v)]));
  });
/**
 * Shape sanity for every active body: UVs inside [0,1], convex with signedArea > 0, and unstretched texture: since
 * UV = page px / PAGE_SIZE and local frames are page-aligned, uv[k] − v[k]/PAGE_SIZE must be the same for all 4 corners.
 */
const shapeCheck = (page) =>
  page.evaluate(async (PAGE) => {
    const { count, shape, flags } = await window.__dozer.shapes();
    let active = 0,
      uvOut = 0,
      nonConvex = 0,
      badArea = 0,
      stretched = 0,
      nonFinite = 0,
      maxSkew = 0,
      minArea = Infinity;
    for (let i = 0; i < count; i++) {
      if (!(flags[i] & 1)) continue;
      active++;
      const o = i * 16;
      const v = [0, 1, 2, 3].map((k) => [shape[o + 2 * k], shape[o + 2 * k + 1]]);
      const uv = [0, 1, 2, 3].map((k) => [shape[o + 8 + 2 * k], shape[o + 8 + 2 * k + 1]]);
      if ([...v, ...uv].flat().some((x) => !Number.isFinite(x))) {
        nonFinite++;
        continue;
      }
      if (uv.flat().some((x) => x < -1e-6 || x > 1 + 1e-6)) uvOut++;
      let area = 0,
        pos = false,
        neg = false;
      for (let k = 0; k < 4; k++) {
        const a = v[k],
          b = v[(k + 1) % 4],
          cc = v[(k + 2) % 4];
        area += a[0] * b[1] - b[0] * a[1];
        const cr = (b[0] - a[0]) * (cc[1] - b[1]) - (b[1] - a[1]) * (cc[0] - b[0]);
        if (cr > 1e-6) pos = true;
        else if (cr < -1e-6) neg = true;
      }
      area /= 2;
      if (pos && neg) nonConvex++;
      if (!(area > 0)) badArea++;
      minArea = Math.min(minArea, area);
      let skew = 0;
      for (let k = 1; k < 4; k++) {
        for (let a = 0; a < 2; a++) {
          skew = Math.max(skew, Math.abs(uv[k][a] - v[k][a] / PAGE - (uv[0][a] - v[0][a] / PAGE)) * PAGE); // px
        }
      }
      maxSkew = Math.max(maxSkew, skew);
      if (skew > 0.05) stretched++;
    }
    return {
      count,
      active,
      uvOut,
      nonConvex,
      badArea,
      stretched,
      nonFinite,
      maxSkewPx: Math.round(maxSkew * 1e4) / 1e4,
      minArea: Math.round(minArea * 10) / 10,
    };
  }, PAGE_SIZE);
const assertShapes = (ctx, label, c) => {
  const bad = c.uvOut + c.nonConvex + c.badArea + c.stretched + c.nonFinite;
  if (bad) ctx.errors.push(`${label}: shape check failed ${JSON.stringify(c)}`);
};
const debugStats = (page) => page.evaluate(() => window.__dozer.stats());
const introState = (page) => page.evaluate(() => window.__dozer.intro());
/** Waits (≤ 12 s sim) until the scripted intro is done; returns the steps waited. */
const waitIntro = async (page, ctx) => {
  const start = await simFrame(page);
  for (;;) {
    const s = await introState(page);
    const f = (await simFrame(page)) - start;
    if (s.phase === 'done') return f;
    if (f > sec(12)) {
      ctx.errors.push(`intro: not done after ${f} steps (${JSON.stringify(s)})`);
      return f;
    }
    await page.waitForTimeout(30);
  }
};
/** Turns on the spot (A) until the dozer faces up (angle ≤ −π/2, world y down), ≤ 6 s sim. */
const faceUp = (page) =>
  holdKeysForFrames(page, ['KeyA'], sec(6), async (p) => (await dozerState(p)).angle <= -Math.PI / 2 + 0.02);
/** Body centres now vs the boot poses: how many moved more than 5 / 20 px, and the largest move. */
const bootDisplacement = (page) =>
  page.evaluate(async () => {
    const b = window.__dozer.bootPoses();
    const p = await window.__dozer.poses();
    let maxPx = 0,
      over5px = 0,
      over20px = 0;
    for (let i = 0; i < Math.min(b.count, p.count); i++) {
      const m = Math.hypot(p.x[i] - b.x[i], p.y[i] - b.y[i]);
      if (m > maxPx) maxPx = m;
      if (m > 5) over5px++;
      if (m > 20) over20px++;
    }
    return { maxPx: Math.round(maxPx * 100) / 100, over5px, over20px };
  });
/** World-space extents of the dozer footprint (chassis, blade, wing). */
const footprintBox = (page) =>
  page.evaluate(() => {
    const f = window.__dozer.footprint();
    const pts = [...f.chassis, ...f.blade, ...f.wing];
    const xs = pts.map((v) => v[0]),
      ys = pts.map((v) => v[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
/** Whether the key-hint overlay (#keyhint) is rendered. */
const hintVisible = (page) =>
  page.evaluate(() => {
    const el = document.getElementById('keyhint');
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.offsetWidth > 0;
  });
/**
 * Crush: turn to face up, drive up to the top wall (≤ 13.3 s sim), then keep pushing for 10 s sim while sweeping,
 * alternating A and D every 1.5 s. Records stress histograms on the way, stats, the shape check, and
 * shots crush.png + crush-zoom.png (half-viewport crop centred ahead of the blade).
 */
const crush = async (page, ctx) => {
  ctx.framesToFaceUp = await faceUp(page);
  ctx.framesToWall = await holdKeysForFrames(page, ['KeyW'], sec(400 / 30), atTopWall);
  ctx.stressAtWall = await stressStats(page);
  ctx.statsAtWall = await debugStats(page);
  for (let k = 0; k < 300 / 45; k++) {
    await holdKeysForFrames(page, ['KeyW', k % 2 === 0 ? 'KeyA' : 'KeyD'], sec(1.5));
    if (k === 1) ctx.stressSweep = await stressStats(page);
  }
  ctx.stressEnd = await stressStats(page);
  await shot(page, ctx, 'crush.png');
  ctx.dozer = await dozerState(page);
  const vp = page.viewportSize();
  const w = vp.width / 2,
    h = vp.height / 2;
  const cx = vp.width / 2 + Math.cos(ctx.dozer.angle) * 150,
    cy = vp.height / 2 + Math.sin(ctx.dozer.angle) * 150;
  const zoom = `${OUT}crush-zoom.png`;
  await page.screenshot({
    path: zoom,
    clip: {
      x: Math.min(vp.width - w, Math.max(0, cx - w / 2)),
      y: Math.min(vp.height - h, Math.max(0, cy - h / 2)),
      width: w,
      height: h,
    },
  });
  ctx.screenshots.push(zoom);
  ctx.crushStats = await debugStats(page);
  ctx.census = await census(page);
  ctx.shapes = await shapeCheck(page);
  assertCensus(ctx, 'crush', ctx.census);
  assertShapes(ctx, 'crush', ctx.shapes);
};

/** Fails the run if any body is non-finite, out of the page, or inside the dozer footprint. */
const assertCensus = (ctx, label, c) => {
  if (c.nonFinite || c.outOfBounds || c.insideDozer) {
    ctx.errors.push(
      `${label}: ${c.nonFinite} non-finite, ${c.outOfBounds} out-of-bounds, ${c.insideDozer} inside-dozer bodies`,
    );
  }
};
const ACTIONS = {
  /** Drive forward 1.5 s (sim time), steer right 0.7 s, then screenshot. */
  drive: async (page, ctx) => {
    await holdKeysForFrames(page, ['KeyW'], sec(1.5));
    await holdKeysForFrames(page, ['KeyD'], sec(0.7));
    await shot(page, ctx, 'frame1.png');
  },
  /** Drive forward 3 s (sim time) into the page content; screenshot mid-push and at the end. */
  push: async (page, ctx) => {
    await tracksPair(page, ctx);
    const probe = { at: [sec(0.6), sec(1.0), sec(1.3)], fn: teleportProbe(ctx, 'push') };
    await holdKeysForFrames(page, ['KeyW'], sec(1.5), null, probe);
    await shot(page, ctx, 'push-mid.png');
    {
      // Zoom on the blade (its centre, ~100 px ahead of the dozer origin): scooped words ride up onto it.
      const d = await dozerState(page);
      const fx = Math.cos(d.angle),
        fy = Math.sin(d.angle);
      await shotAt(page, ctx, 'scoop-zoom.png', d.x + fx * 100, d.y + fy * 100, 360, 300);
      ctx.scoop = await page.evaluate(async () => {
        const p = await window.__dozer.poses();
        let scooped = 0;
        for (let i = 0; i < p.count; i++) if ((p.flags[i] & 3) === 1 && p.height[i] > 1.6) scooped++;
        return { raisedAwake: scooped };
      });
    }
    ctx.censusMid = await census(page);
    ctx.statsMid = await debugStats(page);
    ctx.stressMid = await stressStats(page);
    await holdKeysForFrames(page, ['KeyW'], sec(1.5), null, {
      at: [sec(0.3), sec(0.9)],
      fn: teleportProbe(ctx, 'push2'),
    });
    await shot(page, ctx, 'push.png');
    ctx.dozer = await dozerState(page);
    ctx.census = await census(page);
    finishTeleport(ctx);
    // Coast: brake to a stop, then see how far bodies keep moving over the next 1.5 s sim with the dozer parked: with
    // no springy contacts, pushed words stop within a short distance of where the blade left them.
    const posesNow = () =>
      page.evaluate(async () => {
        const p = await window.__dozer.poses();
        return { count: p.count, x: p.x, y: p.y };
      });
    await holdKeysForFrames(page, ['Space'], sec(0.5)); // brake to a standstill (900 px/s² stops 260 px/s in 0.3 s)
    const before = await posesNow();
    await holdKeysForFrames(page, [], sec(1.5));
    const after = await posesNow();
    let coastMax = 0,
      over20 = 0,
      over5 = 0;
    for (let i = 0; i < Math.min(before.count, after.count); i++) {
      const m = Math.hypot(after.x[i] - before.x[i], after.y[i] - before.y[i]);
      if (m > coastMax) coastMax = m;
      if (m > 5) over5++;
      if (m > 20) over20++;
    }
    ctx.coast = { maxPx: Math.round(coastMax * 10) / 10, over5px: over5, over20px: over20 };
    assertCensus(ctx, 'push mid', ctx.censusMid);
    assertCensus(ctx, 'push', ctx.census);
  },
  /**
   * Reverse: push into the page 2 s, back up 2 s over the material (the blade must not push; words pass under the
   * dozer), then drive forward again 2 s. Teleport probes sample the moment pushing resumes on words left overlapping
   * the blade. Shots: reverse-back.png (after backing up), reverse.png.
   */
  reverse: async (page, ctx) => {
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    await holdKeysForFrames(page, ['Space'], sec(0.4));
    await holdKeysForFrames(page, ['KeyS'], sec(2));
    await shot(page, ctx, 'reverse-back.png');
    ctx.censusBack = await census(page);
    await holdKeysForFrames(page, ['Space'], sec(0.4));
    await holdKeysForFrames(page, ['KeyW'], sec(2), null, {
      at: [sec(0.1), sec(0.3), sec(0.5), sec(0.8), sec(1.2)],
      fn: teleportProbe(ctx, 'resume'),
    });
    await shot(page, ctx, 'reverse.png');
    ctx.dozer = await dozerState(page);
    ctx.census = await census(page);
    finishTeleport(ctx);
    assertCensus(ctx, 'reverse back', ctx.censusBack);
    assertCensus(ctx, 'reverse', ctx.census);
  },
  /** Turn to face up, drive up until the dozer is against the top wall, keep pushing 2 s, then check every body's pose. */
  wall: async (page, ctx) => {
    const atWall = atTopWall;
    ctx.framesToFaceUp = await faceUp(page);
    const toWall = await holdKeysForFrames(page, ['KeyW'], sec(400 / 30), atWall);
    if (!(await atWall(page))) ctx.errors.push(`wall: dozer did not reach the wall within ${sec(400 / 30)} steps`);
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    await shot(page, ctx, 'wall.png');
    ctx.dozer = await dozerState(page);
    ctx.wall = await census(page);
    ctx.wall.framesToWall = toWall;
    assertCensus(ctx, 'wall', ctx.wall);
  },
  /**
   * Piling: drive forward 4 s (sim), U-turn (W + D until the heading has turned 180°, ≤ 6.7 s), drive back 2 s. Shots: pile-mid.png (end of the forward push), pile.png, pile-zoom.png (centre crop).
   */
  pile: async (page, ctx) => {
    ctx.occRest = await occStats(page);
    await holdKeysForFrames(page, ['KeyW'], sec(4), null, {
      at: [sec(1.5), sec(3)],
      fn: teleportProbe(ctx, 'pile forward'),
    });
    await shot(page, ctx, 'pile-mid.png');
    ctx.censusMid = await census(page);
    ctx.occMid = await occStats(page);
    const a0 = (await dozerState(page)).angle;
    const turned = async (p) => Math.abs((await dozerState(p)).angle - a0) >= Math.PI;
    ctx.turnFrames = await holdKeysForFrames(page, ['KeyW', 'KeyD'], sec(200 / 30), turned, {
      at: [sec(0.5), sec(1.2)],
      fn: async (p) => {
        await teleportProbe(ctx, 'pile turn')(p);
        if (!ctx.screenshots.some((x) => x.endsWith('pile-turn.png'))) await shot(p, ctx, 'pile-turn.png'); // mid-turn
      },
    });
    if (!(await turned(page))) ctx.errors.push(`pile: U-turn did not reach 180° within ${sec(200 / 30)} steps`);
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    await shot(page, ctx, 'pile.png');
    ctx.dozer = await dozerState(page);
    // Zoomed shot: a half-viewport crop centred ~170 screen px ahead of the blade (the camera follows the dozer,
    // so the dozer is roughly at the viewport centre).
    const vp = page.viewportSize();
    const w = vp.width / 2,
      h = vp.height / 2;
    const cx = vp.width / 2 + Math.cos(ctx.dozer.angle) * 170,
      cy = vp.height / 2 + Math.sin(ctx.dozer.angle) * 170;
    const zoom = `${OUT}pile-zoom.png`;
    await page.screenshot({
      path: zoom,
      clip: {
        x: Math.min(vp.width - w, Math.max(0, cx - w / 2)),
        y: Math.min(vp.height - h, Math.max(0, cy - h / 2)),
        width: w,
        height: h,
      },
    });
    ctx.screenshots.push(zoom);
    ctx.census = await census(page);
    ctx.occ = await occStats(page);
    finishTeleport(ctx);
    assertCensus(ctx, 'pile mid', ctx.censusMid);
    assertCensus(ctx, 'pile', ctx.census);
  },
  /** Fracture: crush material against the top wall; asserts fragments were made and every shape stays sane. */
  crush: async (page, ctx) => {
    await crush(page, ctx);
    if (!(ctx.crushStats.fragments > 0))
      ctx.errors.push(`crush: no fragments made (${JSON.stringify(ctx.crushStats)})`);
  },
  /** Run with `?debug&max=auto%2B50`: crush must fill exactly the 50 spare slots and never over-allocate. */
  cap: async (page, ctx) => {
    await crush(page, ctx);
    const st = ctx.crushStats;
    if (st.bodies !== st.initialCount + 50)
      ctx.errors.push(`cap: bodies ${st.bodies} !== initialCount ${st.initialCount} + 50`);
    if (st.fragments !== 50) ctx.errors.push(`cap: fragmentsMade ${st.fragments} !== 50`);
  },
  /**
   * Reset (after the intro): push into the page for 2 s (crushing/waking material), press R, let 5 steps run, then check
   * the boot state is back: no fragments and exactly the boot bodies (bodies === initialCount), every body at its boot
   * pose (window.__dozer.bootPoses), the dozer back at the intro's off-page start with the intro replaying and the key
   * hint hidden, and a clean census. Shot: reset.png (should match frame0).
   */
  reset: async (page, ctx) => {
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    ctx.statsBeforeReset = await debugStats(page);
    ctx.displacementBeforeReset = await bootDisplacement(page);
    await page.keyboard.press('KeyR');
    const f0 = await simFrame(page);
    while ((await simFrame(page)) - f0 < 5) await page.waitForTimeout(20);
    ctx.statsAfterReset = await debugStats(page);
    ctx.dozer = await dozerState(page);
    ctx.introAfterReset = await introState(page);
    ctx.hintAfterReset = await hintVisible(page);
    ctx.census = await census(page);
    ctx.displacementAfterReset = await bootDisplacement(page);
    await shot(page, ctx, 'reset.png');
    if (!(ctx.statsBeforeReset.fragments > 0)) {
      ctx.errors.push(
        `reset: the pre-reset push made no fragments, so the reset check proves nothing (${JSON.stringify(ctx.statsBeforeReset)})`,
      );
    }
    const st = ctx.statsAfterReset;
    if (st.fragments !== 0 || st.bodies !== st.initialCount) {
      ctx.errors.push(
        `reset: after reset fragments ${st.fragments} (want 0), bodies ${st.bodies} (want initialCount ${st.initialCount})`,
      );
    }
    const { plan } = ctx.introAfterReset;
    if (Math.abs(ctx.dozer.x - plan.startX) > 1 || Math.abs(ctx.dozer.y - plan.y) > 1e-6 || ctx.dozer.angle !== 0) {
      ctx.errors.push(`reset: dozer not back at the intro start (${JSON.stringify({ dozer: ctx.dozer, plan })})`);
    }
    if (ctx.introAfterReset.phase === 'done' || ctx.hintAfterReset) {
      ctx.errors.push(
        `reset: the intro did not restart or the key hint is showing (${JSON.stringify({ intro: ctx.introAfterReset, hint: ctx.hintAfterReset })})`,
      );
    }
    if (ctx.displacementAfterReset.over5px !== 0 || !(ctx.displacementBeforeReset.over5px > 0)) {
      ctx.errors.push(
        `reset: bodies not back at their boot poses (${JSON.stringify(ctx.displacementAfterReset)} vs before ${JSON.stringify(ctx.displacementBeforeReset)})`,
      );
    }
    assertCensus(ctx, 'reset', ctx.census);
  },
  /**
   * Intro (from boot, before any key): the dozer starts fully off the left edge, facing right; mid-intro shot
   * (intro-mid.png) while it pushes; once done it must be stopped with its whole footprint inside the page, text must
   * have moved (bodies displaced from their boot poses, or fragments), and the key hint must show (intro-end.png) and
   * disappear on a driving key (W). Then R replays the intro and a key press (D) skips it: done at once, the dozer
   * inside the page, no hint after a driving key.
   */
  intro: async (page, ctx) => {
    const s0 = await introState(page);
    const box0 = await footprintBox(page);
    ctx.introStart = { phase: s0.phase, plan: s0.plan, footprint: box0 };
    if (s0.phase === 'done' || !(box0.maxX < 0))
      ctx.errors.push(`intro: the dozer did not start fully off the left edge ${JSON.stringify(ctx.introStart)}`);
    const d0 = await dozerState(page);
    if (d0.angle !== 0) ctx.errors.push(`intro: the dozer does not start facing right (angle ${d0.angle})`);
    if (await hintVisible(page)) ctx.errors.push('intro: key hint visible before the intro finished');
    // Mid-intro: the blade tip ~150 px into the text.
    const midX = s0.plan.stopX - 220;
    const start = await simFrame(page);
    while ((await dozerState(page)).x < midX && (await simFrame(page)) - start < sec(10)) await page.waitForTimeout(20);
    ctx.introMid = {
      step: (await simFrame(page)) - start,
      dozer: await dozerState(page),
      intro: await introState(page),
    };
    await shot(page, ctx, 'intro-mid.png');
    ctx.introSteps = await waitIntro(page, ctx);
    ctx.introEnd = {
      dozer: await dozerState(page),
      footprint: await footprintBox(page),
      intro: await introState(page),
    };
    ctx.introStats = await debugStats(page);
    ctx.introDisplacement = await bootDisplacement(page);
    ctx.hintAfterIntro = await hintVisible(page);
    await shot(page, ctx, 'intro-end.png');
    const { dozer: d, footprint: fb } = ctx.introEnd;
    if (d.speed !== 0) ctx.errors.push(`intro: the dozer is still moving at the end (speed ${d.speed})`);
    if (fb.minX < 0 || fb.minY < 0 || fb.maxX > PAGE_SIZE || fb.maxY > PAGE_SIZE)
      ctx.errors.push(`intro: footprint not inside the page ${JSON.stringify(fb)}`);
    if (!(ctx.introDisplacement.over20px > 20 || ctx.introStats.fragments > 0)) {
      ctx.errors.push(
        `intro: no text was pushed ${JSON.stringify({ displacement: ctx.introDisplacement, stats: ctx.introStats })}`,
      );
    }
    if (!ctx.hintAfterIntro) ctx.errors.push('intro: key hint not visible after the intro');
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(100);
    ctx.hintAfterKey = await hintVisible(page);
    if (ctx.hintAfterKey) ctx.errors.push('intro: key hint still visible after pressing W');
    // Replay and skip.
    await page.keyboard.press('KeyR');
    const f0 = await simFrame(page);
    while ((await simFrame(page)) - f0 < 3) await page.waitForTimeout(20);
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(100);
    ctx.introSkip = {
      intro: await introState(page),
      footprint: await footprintBox(page),
      hint: await hintVisible(page),
    };
    const k = ctx.introSkip;
    if (k.intro.phase !== 'done' || !k.intro.skipped || k.footprint.minX < -1 || k.hint) {
      ctx.errors.push(`intro: skipping with D failed ${JSON.stringify(k)}`);
    }
    ctx.census = await census(page);
    assertCensus(ctx, 'intro', ctx.census);
  },
  /**
   * Icebreaker: steer the dozer straight through the largest image on the page (the largest non-word body at boot)
   * and keep going 1.5 s past its centre. Asserts that the image ends up shattered (> ICE_MIN_SHARDS live bodies whose
   * UV centre lies inside the image's UV rect), no slot exhaustion, a clean census and the teleport check.
   * Shots: icebreaker.png and icebreaker-zoom.png (crop ahead of the blade).
   */
  icebreaker: async (page, ctx) => {
    const target = await page.evaluate(async () => {
      const { count, shape, flags } = await window.__dozer.shapes();
      const p = await window.__dozer.poses();
      let best = -1,
        bestArea = 0;
      for (let i = 0; i < count; i++) {
        if (!(flags[i] & 1) || flags[i] & 4) continue; // active objects only
        const o = i * 16;
        let a = 0;
        for (let k = 0; k < 4; k++) {
          const j = (k + 1) % 4;
          a += shape[o + 2 * k] * shape[o + 2 * j + 1] - shape[o + 2 * j] * shape[o + 2 * k + 1];
        }
        if (a / 2 > bestArea) {
          bestArea = a / 2;
          best = i;
        }
      }
      const o = best * 16;
      const us = [0, 1, 2, 3].map((k) => shape[o + 8 + 2 * k]),
        vs = [0, 1, 2, 3].map((k) => shape[o + 9 + 2 * k]);
      return {
        slot: best,
        area: Math.round(bestArea),
        x: p.x[best],
        y: p.y[best],
        uv: [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)],
      };
    });
    ctx.iceTarget = { ...target, x: Math.round(target.x), y: Math.round(target.y) };
    // Autopilot: hold W, steer (A/D) toward the image centre until within 40 px of it, then lock the heading and drive
    // on for 1.5 s. Teleport probes sample single-step displacements on the way through.
    const held = new Set();
    const setKeys = async (want) => {
      for (const k of [...held])
        if (!want.includes(k)) {
          await page.keyboard.up(k);
          held.delete(k);
        }
      for (const k of want)
        if (!held.has(k)) {
          await page.keyboard.down(k);
          held.add(k);
        }
    };
    const start = await simFrame(page);
    const probeAt = [sec(2), sec(3), sec(4), sec(5), sec(6)];
    let reached = null;
    try {
      for (;;) {
        const f = (await simFrame(page)) - start;
        if (f > sec(14)) break;
        const d = await dozerState(page);
        const dist = Math.hypot(target.x - d.x, target.y - d.y);
        if (!reached && dist < 40) reached = f;
        if (reached !== null && f - reached > sec(1.5)) break;
        let steer = [];
        if (reached === null) {
          let e = Math.atan2(target.y - d.y, target.x - d.x) - d.angle;
          e = Math.atan2(Math.sin(e), Math.cos(e));
          if (e > 0.06) steer = ['KeyD'];
          else if (e < -0.06) steer = ['KeyA'];
        }
        await setKeys(['KeyW', ...steer]);
        if (probeAt.length && f >= probeAt[0]) {
          probeAt.shift();
          await teleportProbe(ctx, 'icebreaker')(page);
          continue;
        }
        await page.waitForTimeout(20);
      }
    } finally {
      await setKeys([]);
    }
    ctx.iceReachedStep = reached;
    if (reached === null)
      ctx.errors.push(`icebreaker: the dozer never reached the image centre ${JSON.stringify(ctx.iceTarget)}`);
    await shot(page, ctx, 'icebreaker.png');
    const d = await dozerState(page);
    await shotAt(
      page,
      ctx,
      'icebreaker-zoom.png',
      d.x - Math.cos(d.angle) * 20,
      d.y - Math.sin(d.angle) * 20,
      560,
      420,
    );
    ctx.ice = await page.evaluate(async (uv) => {
      const { count, shape, flags } = await window.__dozer.shapes();
      const p = await window.__dozer.poses();
      let shards = 0,
        maxArea = 0,
        areaSum = 0;
      const sizes = [],
        pieces = [];
      for (let i = 0; i < count; i++) {
        if (!(flags[i] & 1) || flags[i] & 4) continue;
        const o = i * 16;
        let cu = 0,
          cv = 0,
          a = 0;
        for (let k = 0; k < 4; k++) {
          cu += shape[o + 8 + 2 * k] / 4;
          cv += shape[o + 9 + 2 * k] / 4;
          const j = (k + 1) % 4;
          a += shape[o + 2 * k] * shape[o + 2 * j + 1] - shape[o + 2 * j] * shape[o + 2 * k + 1];
        }
        if (cu < uv[0] || cu > uv[2] || cv < uv[1] || cv > uv[3]) continue;
        shards++;
        a /= 2;
        areaSum += a;
        maxArea = Math.max(maxArea, a);
        sizes.push(Math.sqrt(a));
        pieces.push({
          i,
          area: Math.round(a),
          asleep: (flags[i] & 2) !== 0,
          stress: Math.round((p.stress[i] ?? 0) * 10) / 10,
          x: Math.round(p.x[i]),
          y: Math.round(p.y[i]),
        });
      }
      sizes.sort((p, q) => p - q);
      pieces.sort((p, q) => q.area - p.area);
      return {
        shards,
        maxShardArea: Math.round(maxArea),
        areaSum: Math.round(areaSum),
        medianShardSide: Math.round(sizes[sizes.length >> 1] ?? 0),
        largest: pieces.slice(0, 5),
      };
    }, target.uv);
    ctx.iceStats = await debugStats(page);
    // Break sounds (audio.ts): the key presses started the audio, and the fractures must have played hits.
    ctx.iceSound = await page.evaluate(() => window.__dozer.engine());
    if (ctx.iceSound.sound === 'running' && !(ctx.iceSound.breaks > 0))
      ctx.errors.push(`icebreaker: no break sounds played ${JSON.stringify(ctx.iceSound)}`);
    ctx.census = await census(page);
    ctx.shapes = await shapeCheck(page);
    finishTeleport(ctx);
    if (!(ctx.ice.shards > ICE_MIN_SHARDS))
      ctx.errors.push(`icebreaker: the image broke into only ${ctx.ice.shards} pieces (want > ${ICE_MIN_SHARDS})`);
    const cap = Number(/max=(\d+)/.exec(ctx.boot ?? '')?.[1] ?? Infinity);
    if (!(ctx.iceStats.bodies < cap))
      ctx.errors.push(`icebreaker: body slots exhausted (${ctx.iceStats.bodies} of ${cap})`);
    assertCensus(ctx, 'icebreaker', ctx.census);
    assertShapes(ctx, 'icebreaker', ctx.shapes);
  },
  /**
   * Smoke: idle 2 s (light wisps, smoke-idle.png), then drive forward with a turn 2.5 s (dark puffs, smoke-drive.png);
   * both zoomed on the dozer. Asserts more smoke under load than at idle.
   */
  smoke: async (page, ctx) => {
    const engine = () => page.evaluate(() => window.__dozer.engine());
    const zoomDozer = async (name) => {
      const d = await dozerState(page);
      await shotAt(page, ctx, name, d.x, d.y, 420, 360);
    };
    await holdKeysForFrames(page, [], sec(2));
    ctx.smokeIdle = await engine();
    await zoomDozer('smoke-idle.png');
    await holdKeysForFrames(page, ['KeyW'], sec(1.5));
    await holdKeysForFrames(page, ['KeyW', 'KeyD'], sec(1));
    ctx.smokeDrive = await engine();
    await zoomDozer('smoke-drive.png');
    // The key presses above are the user gesture that starts the engine sound (audio.ts): it must be running (or at
    // least never 'unavailable' when the file is there); headless Chromium plays to a null sink.
    ctx.sound = { idle: ctx.smokeIdle.sound, drive: ctx.smokeDrive.sound };
    if (ctx.smokeDrive.sound !== 'running' && ctx.smokeDrive.sound !== 'muted')
      ctx.errors.push(`sound: engine audio is ${ctx.smokeDrive.sound} after key presses`);
    if (!(ctx.smokeDrive.smoke > ctx.smokeIdle.smoke * 2 && ctx.smokeDrive.load > 0.5)) {
      ctx.errors.push(
        `smoke: not more smoke under load ${JSON.stringify({ idle: ctx.smokeIdle, drive: ctx.smokeDrive })}`,
      );
    }
  },
  /**
   * Track decals: drive forward 2 s, turn 1.5 s, forward 2 s, then a wide shot (decals.png) and a crop behind the dozer
   * (decals-zoom.png): faint tread prints along the trail, fading with age.
   */
  decals: async (page, ctx) => {
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    await holdKeysForFrames(page, ['KeyW', 'KeyA'], sec(1.5));
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    await holdKeysForFrames(page, ['Space'], sec(0.4));
    await shot(page, ctx, 'decals.png');
    const d = await dozerState(page);
    await shotAt(page, ctx, 'decals-zoom.png', d.x - Math.cos(d.angle) * 200, d.y - Math.sin(d.angle) * 200, 520, 420);
    ctx.dozer = d;
    ctx.census = await census(page);
    assertCensus(ctx, 'decals', ctx.census);
  },
  /**
   * Scooped layer: push forward 2 s (some bodies must be flagged FLAG_SCOOPED, drawn over the blade: scoop-forward.png),
   * then reset, turn on the spot to face left and reverse 3 s straight back into fresh words: no body may become
   * flagged while reversing, so the blade draws over the words it runs over (scoop-reverse.png).
   */
  scoopflag: async (page, ctx) => {
    const FLAG_SCOOPED = 8;
    const flagged = () =>
      page.evaluate(async (bit) => {
        const p = await window.__dozer.poses();
        let n = 0;
        for (let i = 0; i < p.count; i++) if (p.flags[i] & 1 && p.flags[i] & bit) n++;
        return n;
      }, FLAG_SCOOPED);
    const zoomBlade = async (name) => {
      const d = await dozerState(page);
      await shotAt(page, ctx, name, d.x + Math.cos(d.angle) * 90, d.y + Math.sin(d.angle) * 90, 420, 340);
    };
    await holdKeysForFrames(page, ['KeyW'], sec(2));
    ctx.flaggedPushing = await flagged();
    await zoomBlade('scoop-forward.png');
    if (!(ctx.flaggedPushing > 0)) ctx.errors.push('scoopflag: no body was flagged as scooped while pushing forward');
    await page.keyboard.press('KeyR');
    const f0 = await simFrame(page);
    while ((await simFrame(page)) - f0 < 5) await page.waitForTimeout(20);
    ctx.flaggedAfterReset = await flagged();
    // The intro restarts facing right at the left edge; D skips it, then turn on the spot to face left so reversing
    // runs back (right) into fresh words.
    const facingLeft = async (pg) => (await dozerState(pg)).angle >= Math.PI - 0.02;
    await holdKeysForFrames(page, ['KeyD'], sec(8), facingLeft);
    await holdKeysForFrames(page, ['Space'], sec(0.3));
    const during = [];
    await holdKeysForFrames(page, ['KeyS'], sec(3), null, {
      at: [sec(1), sec(1.6), sec(2.2), sec(2.8)],
      fn: async () => {
        during.push(await flagged());
      },
    });
    ctx.flaggedReversing = during;
    await zoomBlade('scoop-reverse.png');
    ctx.flaggedReverseEnd = await flagged();
    ctx.dozer = await dozerState(page);
    ctx.census = await census(page);
    if (ctx.flaggedAfterReset !== 0 || during.some((n) => n > 0) || ctx.flaggedReverseEnd > 0) {
      ctx.errors.push(
        `scoopflag: bodies flagged while reversing ${JSON.stringify({ afterReset: ctx.flaggedAfterReset, during, end: ctx.flaggedReverseEnd })}`,
      );
    }
    assertCensus(ctx, 'scoopflag', ctx.census);
  },
  /**
   * Page interaction (src/interaction.ts): clicks real controls through their bodies. A checkbox/toggle must flip
   * (`checked` and the content texture under it change), a select cycles, a text field takes "hello" while the dozer
   * ignores the keys (W included), Esc hands W back to the dozer, a slider drag changes its value; then the dozer
   * pushes a toggle away from its original spot and a click on it there must still flip it. No control may move in
   * page layout. Shots: interact-*.png.
   */
  interact: async (page, ctx) => {
    const r = (ctx.interact = {});
    const vp = page.viewportSize();
    const layout = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.dz-page :is(input, select, textarea, button, label, progress, meter)')]
          .map((e) => {
            const b = e.getBoundingClientRect();
            return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10).join(',');
          })
          .join(';'),
      );
    const layout0 = await layout();
    const recaps = () => page.evaluate(() => window.__dozer.recaptures().count);
    /** Polls `fn` until it returns a truthy value (or `ms` pass); returns its last value. */
    const waitFor = async (fn, ms = 5000) => {
      const t0 = Date.now();
      for (;;) {
        const v = await fn();
        if (v || Date.now() - t0 > ms) return v;
        await page.waitForTimeout(30);
      }
    };
    /** After an interaction: until `changed()` holds, then until a re-capture after that (≤ 1 s), then two frames. */
    const settle = async (changed) => {
      await waitFor(changed);
      const n0 = await recaps();
      await waitFor(async () => (await recaps()) > n0, 1000);
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    };
    const onScreen = (b) =>
      b && b.screen[0] > 20 && b.screen[1] > 20 && b.screen[0] < vp.width - 20 && b.screen[1] < vp.height - 120;
    const frames = (n = 2) =>
      page.evaluate(
        (k) =>
          new Promise((res) => {
            const f = (left) => (left ? requestAnimationFrame(() => f(left - 1)) : res());
            f(k);
          }),
        n,
      );
    /**
     * First element matching `selector` whose body is on screen (and not under the dozer), with its page rect. With
     * `look`, the camera is pointed at each candidate in turn (debug lookAt) so off-screen controls can be used.
     */
    const visible = async (selector, look = false) => {
      const n = await page.evaluate((sel) => document.querySelectorAll(`.dz-page ${sel}`).length, selector);
      for (let i = 0; i < n; i++) {
        let b = await page.evaluate(([sel, k]) => window.__dozer.findBody(sel, null, k), [selector, i]);
        if (b && !onScreen(b) && look) {
          await page.evaluate((w) => window.__dozer.lookAt(w), b.world);
          await frames(3);
          b = await page.evaluate(([sel, k]) => window.__dozer.findBody(sel, null, k), [selector, i]);
        }
        if (!onScreen(b)) continue;
        const rect = await page.evaluate(
          ([sel, k]) => {
            const e = document.querySelectorAll(`.dz-page ${sel}`)[k],
              o = document.querySelector('.dz-page').getBoundingClientRect(),
              q = e.getBoundingClientRect();
            return { x: q.left - o.left, y: q.top - o.top, w: q.width, h: q.height };
          },
          [selector, i],
        );
        const blocked = await page.evaluate(([x, y]) => {
          const [wx, wy] = [x, y];
          const fp = window.__dozer.footprint();
          const q = fp.chassis;
          let sign = 0;
          for (let k = 0; k < q.length; k++) {
            const a = q[k],
              b2 = q[(k + 1) % q.length];
            const c = (b2[0] - a[0]) * (wy - a[1]) - (b2[1] - a[1]) * (wx - a[0]);
            if (sign === 0) sign = Math.sign(c);
            else if (Math.sign(c) !== sign) return false;
          }
          return true;
        }, b.world);
        if (!blocked) return { ...b, nth: i, rect, selector };
      }
      return null;
    };
    const hashAt = (rect) =>
      page.evaluate(([x, y, w, h]) => window.__dozer.contentHash(x, y, w, h), [rect.x, rect.y, rect.w, rect.h]);
    const prop = (selector, nth, name) =>
      page.evaluate(([sel, k, n]) => document.querySelectorAll(`.dz-page ${sel}`)[k][n], [selector, nth, name]);
    const crop = async (name, b) => {
      const w = 240,
        h = 120;
      const clip = {
        x: Math.min(vp.width - w, Math.max(0, b.screen[0] - w / 2)),
        y: Math.min(vp.height - h, Math.max(0, b.screen[1] - h / 2)),
        width: w,
        height: h,
      };
      const path = `${OUT}${name}`;
      await page.screenshot({ path, clip });
      ctx.screenshots.push(path);
    };

    // Checkbox / toggle: click its body, `checked` flips and the content texture under it changes.
    const toggle = await visible('label:has(input[type=checkbox])');
    if (!toggle) throw new Error('interact: no checkbox or toggle body on screen');
    const isChecked = (t) =>
      page.evaluate(
        ([s2, k]) => document.querySelectorAll(`.dz-page ${s2}`)[k].querySelector('input').checked,
        [t.selector, t.nth],
      );
    const checked0 = await isChecked(toggle);
    const hash0 = await hashAt(toggle.rect);
    await crop('interact-toggle-before.png', toggle);
    await page.mouse.click(toggle.screen[0], toggle.screen[1]);
    await settle(async () => (await isChecked(toggle)) !== checked0);
    const checked1 = await isChecked(toggle);
    const hash1 =
      (await waitFor(async () => {
        const h = await hashAt(toggle.rect);
        return h !== hash0 && h;
      })) || hash0;
    await crop('interact-toggle-after.png', toggle);
    r.toggle = {
      index: toggle.index,
      page: toggle.rect,
      checked: [checked0, checked1],
      textureChanged: hash0 !== hash1,
    };
    if (checked0 === checked1)
      ctx.errors.push(`interact: clicking the toggle body did not flip it ${JSON.stringify(r.toggle)}`);
    if (hash0 === hash1) ctx.errors.push('interact: the content texture did not change under the toggled control');

    // Select: a click cycles to the next option.
    const sel = await visible('select');
    if (!sel) throw new Error('interact: no select body on screen');
    const v0 = await prop('select', sel.nth, 'value');
    const cursor = () => page.evaluate(() => document.getElementById('view').style.cursor);
    await page.mouse.move(sel.screen[0], sel.screen[1]);
    r.cursor = {
      select:
        (await waitFor(async () => ((await cursor()) === 'pointer' ? 'pointer' : null), 3000)) ?? (await cursor()),
    };
    await page.mouse.click(sel.screen[0], sel.screen[1]);
    await settle(async () => (await prop('select', sel.nth, 'value')) !== v0);
    const v1 = await prop('select', sel.nth, 'value');
    await crop('interact-select.png', sel);
    r.select = { values: [v0, v1] };
    if (v0 === v1) ctx.errors.push(`interact: the select did not cycle ${JSON.stringify(r.select)}`);

    // Text field: click, type, the dozer ignores the keys; Esc hands the keyboard back.
    const field = await visible('input:is([type=text], [type=email], [type=search])', true);
    if (!field) throw new Error('interact: no text field body on screen');
    await page.evaluate(
      ([s2, k]) => {
        document.querySelectorAll(`.dz-page ${s2}`)[k].value = '';
      },
      [field.selector, field.nth],
    );
    await page.mouse.move(field.screen[0], field.screen[1]);
    r.cursor.text =
      (await waitFor(async () => ((await cursor()) === 'text' ? 'text' : null), 3000)) ?? (await cursor());
    if (r.cursor.select !== 'pointer' || r.cursor.text !== 'text')
      ctx.errors.push(`interact: hover cursors ${JSON.stringify(r.cursor)}`);
    await page.mouse.click(field.screen[0], field.screen[1]);
    r.text = { typing: await waitFor(() => page.evaluate(() => window.__dozer.typing())) };
    const before = await dozerState(page);
    await page.keyboard.type('hello');
    await holdKeysForFrames(page, ['KeyW'], sec(0.5));
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const after = await dozerState(page);
    r.text.value = await prop(field.selector, field.nth, 'value');
    r.text.dozerMoved = Math.round(Math.hypot(after.x - before.x, after.y - before.y) * 100) / 100;
    r.text.badge = await page.evaluate(() => !document.getElementById('typing').hidden);
    await shot(page, ctx, 'interact-typing.png');
    if (!r.text.typing) ctx.errors.push('interact: clicking the text field body did not focus it');
    if (!String(r.text.value).startsWith('hello'))
      ctx.errors.push(`interact: typed text did not reach the field ${JSON.stringify(r.text)}`);
    if (r.text.dozerMoved > 0.5 || Math.abs(after.speed) > 1)
      ctx.errors.push(`interact: the dozer moved while typing ${JSON.stringify(r.text)}`);
    if (!r.text.badge) ctx.errors.push('interact: the typing badge is not showing');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    r.text.typingAfterEsc = await page.evaluate(() => window.__dozer.typing());
    const b2 = await dozerState(page);
    await holdKeysForFrames(page, ['KeyW'], sec(0.3));
    const a2 = await dozerState(page);
    await holdKeysForFrames(page, ['Space'], sec(0.4));
    r.text.drivesAfterEsc = Math.round(Math.hypot(a2.x - b2.x, a2.y - b2.y) * 100) / 100;
    if (r.text.typingAfterEsc || !(r.text.drivesAfterEsc > 1))
      ctx.errors.push(`interact: Esc did not hand the keyboard back ${JSON.stringify(r.text)}`);

    // Slider: drag from the left quarter to the right end.
    const range = await visible('input[type=range]', true);
    if (!range) throw new Error('interact: no slider body on screen');
    const at = (fx) =>
      page.evaluate(
        ([s2, k, p]) => window.__dozer.findBody(s2, p, k),
        [range.selector, range.nth, [range.rect.x + range.rect.w * fx, range.rect.y + range.rect.h / 2]],
      );
    const [pa, pb] = [await at(0.25), await at(0.97)];
    const rv0 = await prop(range.selector, range.nth, 'value');
    await page.mouse.move(pa.screen[0], pa.screen[1]);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.move(pb.screen[0], pb.screen[1], { steps: 6 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await settle(async () => (await prop(range.selector, range.nth, 'value')) !== rv0);
    const rv1 = await prop(range.selector, range.nth, 'value');
    await crop('interact-range.png', range);
    r.range = { values: [rv0, rv1] };
    if (!(Number(rv1) > 90) || rv0 === rv1)
      ctx.errors.push(`interact: dragging the slider did not set it near its max ${JSON.stringify(r.range)}`);

    await page.evaluate(() => window.__dozer.lookAt(null));
    // Push a toggle away from its original spot, then click it where it is now.
    const target = toggle;
    const goal = target.world;
    const moved = async () => {
      const b = await page.evaluate(([s2, k]) => window.__dozer.findBody(s2, null, k), [target.selector, target.nth]);
      return b
        ? Math.hypot(b.world[0] - (target.rect.x + target.rect.w / 2), b.world[1] - (target.rect.y + target.rect.h / 2))
        : 0;
    };
    for (let step = 0; step < 40 && (await moved()) < 160; step++) {
      const d = await dozerState(page);
      const b = await page.evaluate(([s2, k]) => window.__dozer.findBody(s2, null, k), [target.selector, target.nth]);
      const [gx, gy] = b ? b.world : goal;
      let diff = Math.atan2(gy - d.y, gx - d.x) - d.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > 0.08 && Math.hypot(gx - d.x, gy - d.y) > 120)
        await holdKeysForFrames(page, [diff > 0 ? 'KeyD' : 'KeyA'], Math.max(2, Math.round(Math.abs(diff) * 20)));
      else await holdKeysForFrames(page, ['KeyW'], sec(0.4));
    }
    await holdKeysForFrames(page, ['Space'], sec(0.5));
    await holdKeysForFrames(page, ['KeyS'], sec(0.6));
    await holdKeysForFrames(page, ['Space'], sec(0.5));
    r.pushed = { movedPx: Math.round(await moved()) };
    const now = await page.evaluate(([s2, k]) => window.__dozer.findBody(s2, null, k), [target.selector, target.nth]);
    const c0 = await isChecked(target);
    await crop('interact-moved-before.png', now);
    await page.mouse.click(now.screen[0], now.screen[1]);
    await settle(async () => (await isChecked(target)) !== c0);
    const c1 = await isChecked(target);
    await crop('interact-moved-after.png', now);
    await shot(page, ctx, 'interact-moved.png');
    r.pushed.checked = [c0, c1];
    r.pushed.screen = now.screen.map(Math.round);
    if (!(r.pushed.movedPx >= 100))
      ctx.errors.push(`interact: the dozer did not push the toggle away ${JSON.stringify(r.pushed)}`);
    if (c0 === c1) ctx.errors.push(`interact: clicking the moved toggle did not flip it ${JSON.stringify(r.pushed)}`);

    r.layoutUnchanged = (await layout()) === layout0;
    if (!r.layoutUnchanged) ctx.errors.push('interact: a control moved in the page layout');
    r.recaptures = await page.evaluate(() => {
      const s2 = window.__dozer.recaptures();
      const avg = (a) => (a.length ? Math.round((a.reduce((p, q) => p + q, 0) / a.length) * 100) / 100 : null);
      return {
        count: s2.count,
        cpuMsAvg: avg(s2.cpuMs),
        cpuMsMax: Math.max(0, ...s2.cpuMs),
        gpuMsAvg: avg(s2.gpuMs),
        gpuMsMax: Math.max(0, ...s2.gpuMs),
      };
    });
  },
  /** Idle: 4 s (sim) with no keys held after the intro (for `?prof` baselines). */
  idle: async (page) => {
    await holdKeysForFrames(page, [], sec(4));
  },
  /** Portrait viewport: the view must not stretch and the dozer stays centred (modulo camera clamping). */
  resize: async (page, ctx) => {
    await page.setViewportSize({ width: 900, height: 1200 });
    await page.waitForTimeout(300);
    await shot(page, ctx, 'resize.png');
  },
};

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const [queryArg = '', actionName] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const debug = flags.includes('--debug');
const params = new URLSearchParams(queryArg.replace(/^\?/, ''));
if (debug) params.set('debug', '');
const query = params.toString().replace(/=(?=&|$)/g, '');
if (actionName && !ACTIONS[actionName]) {
  console.error(`unknown action "${actionName}"; known: ${Object.keys(ACTIONS).join(', ') || '(none)'}`);
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const result = { bodies: 0, errors: [], consoleErrors: [], screenshots: [] };
let exitCode = 0;
let browser;
const logs = [];
try {
  browser = await chromium.launch({ args: LAUNCH_ARGS });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: Number(process.env.VERIFY_DPR) || 1,
  });
  // VERIFY_NO_REQUEST_PAINT=1 removes canvas.requestPaint before the app loads (some builds don't ship it).
  if (process.env.VERIFY_NO_REQUEST_PAINT)
    await page.addInitScript(() => {
      delete HTMLCanvasElement.prototype.requestPaint;
    });
  // An error before the boot log fails fast instead of waiting out the boot timeout.
  let failEarly;
  const earlyFailure = new Promise((resolve) => {
    failEarly = resolve;
  });
  page.on('console', (msg) => {
    logs.push(`${msg.type()}: ${msg.text()}`);
    if (msg.type() === 'error') {
      result.consoleErrors.push(msg.text());
      failEarly();
    }
  });
  page.on('pageerror', (err) => {
    result.errors.push(String(err));
    failEarly();
  });

  const bootLog = page.waitForEvent('console', {
    predicate: (msg) => msg.text().startsWith('[dozer] bodies='),
    timeout: 20000,
  });
  bootLog.catch(() => {}); // a failed goto must not leave this rejection unhandled
  await page.goto(`http://localhost:${PORT}/${query ? `?${query}` : ''}`);
  const booted = await Promise.race([
    bootLog.then(
      (msg) => msg,
      () => null,
    ),
    earlyFailure.then(() => 'early'),
  ]);
  if (booted === 'early') {
    result.errors.push('page reported an error before the "[dozer] bodies=" log');
  } else if (booted === null) {
    result.errors.push('timed out waiting for "[dozer] bodies=" log');
  } else {
    result.bodies = Number(/bodies=(\d+)/.exec(booted.text())?.[1] ?? 0);
    result.boot = booted.text();
  }
  // The loading veil (src/splash.ts) lifts by itself once the first frame is done, and the intro starts.
  if (booted && booted !== 'early') await page.waitForSelector('#splash', { state: 'hidden' });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // The page must stay PAGE_SIZE square with nothing overflowing its columns, photo stories or sidebar.
  result.pageOverflow = await page.evaluate(() =>
    [...document.querySelectorAll('.dz-page, .dz-col, .dz-sidebar, .dz-photo, .op-top')]
      .filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)
      .map(
        (e) =>
          `${e.className}#${[...e.parentElement.children].indexOf(e)} ${e.scrollWidth}x${e.scrollHeight} > ${e.clientWidth}x${e.clientHeight}`,
      ),
  );
  if (result.pageOverflow.length) result.errors.push(`page overflow: ${result.pageOverflow.join('; ')}`);
  const frame0 = `${OUT}frame0.png`;
  await page.screenshot({ path: frame0 });
  result.screenshots.push(frame0);

  /** Active word bodies (flags & 4): each word fracture adds one, so the difference from boot = word fragments. */
  const wordCount = () =>
    page.evaluate(async () => {
      const p = await window.__dozer.poses();
      let n = 0;
      for (let i = 0; i < p.count; i++) if ((p.flags[i] & 5) === 5) n++;
      return n;
    });
  const bootWords = params.has('debug') ? await wordCount() : 0;
  if (actionName && actionName !== 'intro' && params.has('debug')) result.introSteps = await waitIntro(page, result);
  // `?prof` (src/gpu/prof.ts): profile the action only, from the end of the intro.
  if (params.has('prof')) {
    result.adapter = await page.evaluate(async () => {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      return a
        ? { vendor: a.info.vendor, architecture: a.info.architecture, fallback: a.info.isFallbackAdapter ?? false }
        : null;
    });
    await page.evaluate(() => window.__dozerProf?.reset());
  }
  if (actionName) await ACTIONS[actionName](page, result);
  if (params.has('prof')) result.prof = await page.evaluate(() => window.__dozerProf?.report() ?? null);
  if (params.has('debug')) result.wordFragments = (await wordCount()) - bootWords;
  if (params.has('debug')) result.stats = await page.evaluate(() => window.__dozer?.stats() ?? null);
} catch (err) {
  result.errors.push(String(err));
} finally {
  if (process.env.VERIFY_LOGS) result.logs = logs;
  await browser?.close();
  await server.close();
}
if (result.errors.length || result.consoleErrors.length || result.bodies === 0) exitCode = 1;
console.log(JSON.stringify(result, null, 2));
process.exit(exitCode);
