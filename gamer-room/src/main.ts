// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { HemisphereLight, MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { InteractionManager } from 'three/addons/interaction/InteractionManager.js';
import { detectCapabilities } from './capabilities';
import { showError, showUnsupported } from './ui/unsupported';
import { createRenderer } from './app/createRenderer';
import { loadRoom } from './scene/loadRoom';
import { fitScreen, normalizeScreenUVs } from './scene/ScreenFitter';
import { ScreenSurface } from './screens/ScreenSurface';
import { getScreenDef, resolveSrc, defaultPixelSize, defaultScreen, mirrorCanvasFor } from './config/screens';
import { cameraConfig } from './config/camera';
import { emissiveHue, fillLight, fillLightBaked, lightOverrides, lightScale } from './config/lights';
import { CameraRig } from './camera/CameraRig';
import { CameraDirector } from './camera/CameraDirector';
import { findCameraClips } from './camera/clips';
import { focusPose, overviewPose, type Pose } from './camera/focusPose';
import { HoverPicker } from './app/hover';
import { createPaintGate } from './app/paintGate';
import { createOverlay, removeSplash } from './ui/overlay';
import { cycleScreen, initialState, reduce, type Action, type AppState } from './app/state';
import { JumpFloodOutline } from './fx/JumpFloodOutline';
import { OutlineAnimator } from './fx/OutlineAnimator';
import { createPostStack } from './fx/postStack';
import { compressForMsaa } from './fx/msaaHdr';
import { Music, startUntilPlaying } from './audio/music';
import { musicSrc } from './config/audio';
import { createDynamicLights, loadDynamicLights } from './scene/dynamicLights';
import { ScreenLight } from './scene/ScreenLight';
import { createEmissiveHue } from './scene/emissiveHue';

/** Arrow keys step through the screens: right/down to the next, left/up to the previous. */
const ARROW_STEPS: Record<string, 1 | -1 | undefined> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

async function boot() {
  const app = document.getElementById('app')!;
  const caps = detectCapabilities();
  if (!caps.supported) {
    removeSplash();
    showUnsupported(app, caps);
    return;
  }

  const renderer = createRenderer(app, caps.api);
  RectAreaLightUniformsLib.init();
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    cameraConfig.fov,
    app.clientWidth / app.clientHeight,
    cameraConfig.near,
    cameraConfig.far,
  );

  const room = await loadRoom(`${import.meta.env.BASE_URL}models/room.glb`);
  scene.add(room.scene);
  scene.add(
    new HemisphereLight(
      fillLight.skyColor,
      fillLight.groundColor,
      room.lightmapped ? fillLightBaked : fillLight.intensity,
    ),
  );
  const emissiveHueFx = createEmissiveHue(room.scene, emissiveHue);
  const dyn = createDynamicLights(
    await loadDynamicLights(`${import.meta.env.BASE_URL}models/lights.json`),
    lightScale,
  );
  dyn.applyOverrides(lightOverrides);
  if (dyn.lights.length) scene.add(...dyn.lights);

  const outline = new JumpFloodOutline(scene, camera);
  const post = createPostStack(renderer, scene, camera, outline);
  const overviewLookAt = new Vector3().fromArray(cameraConfig.overview.lookAt);
  // DoF stays on and its focus eases towards `focusPoint`; snapping it makes the blur pop.
  let dofFocus: number | null = null;
  let focusPoint: Vector3 = overviewLookAt;
  const outlineAnim = new OutlineAnimator(6, 150);

  const interactions = new InteractionManager();
  interactions.connect(renderer, camera);

  const surfaces: ScreenSurface[] = [];
  // Pages raster at devicePixelRatio. Zoomed out a screen is ~200 px wide, so raster at 1x; the
  // screen being flown to rasters at the canvas's own density, which is what it is shown at.
  const overviewRasterScale = 1 / window.devicePixelRatio;
  const focusRasterScale = Math.min(1, renderer.getPixelRatio() / window.devicePixelRatio);
  const screenLights: ScreenLight[] = [];
  const viewpoint = new Vector3().fromArray(cameraConfig.overview.position);
  for (const { id, mesh } of room.screens) {
    if (!normalizeScreenUVs(mesh.geometry, room.fromGltf)) {
      console.warn(`[screen:${id}] no UVs, skipped`);
      continue;
    }
    const rect = fitScreen(mesh, viewpoint);
    if (!rect) {
      console.warn(`[screen:${id}] could not fit a rectangle, skipped`);
      continue;
    }
    const def = getScreenDef(id);
    const size =
      def.width && def.height ? { width: def.width, height: def.height } : defaultPixelSize(rect.width / rect.height);
    const src = resolveSrc(def, location.host, location.search, id, import.meta.env.DEV, location.origin);
    const surface = new ScreenSurface(id, rect, mesh, src, size, defaultScreen.src, mirrorCanvasFor(src));
    surface.setRasterScale(overviewRasterScale);
    surface.attachTo(renderer.domElement);
    scene.add(surface.proxy);
    interactions.add(surface.proxy);
    surfaces.push(surface);
    const glow = new ScreenLight(surface, renderer, screenLights.length * 80);
    scene.add(...glow.lights);
    screenLights.push(glow);
    console.info(
      `[screen:${id}] ${rect.width.toFixed(2)}x${rect.height.toFixed(2)}m${rect.curved ? ' curved' : ''} → ${src}`,
    );
  }

  // After the screens have their own materials: every room material compresses HDR before MSAA.
  console.info(`[post] HDR-aware MSAA on ${compressForMsaa(room.scene)} materials`);

  const ui = document.getElementById('ui')!;
  const overlay = createOverlay(ui, document.getElementById('splash')!);
  overlay.setHint('Hover a screen, click to zoom in · or use arrow keys and Enter');
  const audioEl = new Audio(encodeURI(musicSrc));
  // Touching localStorage can throw (blocked site data); fall back to an in-memory no-op store.
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  try {
    storage = window.localStorage;
  } catch {
    storage = { getItem: () => null, setItem: () => {} };
  }
  const music = new Music(audioEl, storage);
  // Pages that make sound (the dozer, ../dozer/src/audio.ts) follow the room's mute: every screen gets the state now,
  // after each load and on every toggle, and a page that asks (once it listens) gets an answer.
  const muteMessage = () => ({ type: 'dozer-mute', muted: music.muted });
  const shareMute = (): void => {
    for (const s of surfaces) s.postToPage('mute', muteMessage());
  };
  window.addEventListener('message', (e) => {
    const data = e.data as { type?: unknown } | null;
    if (e.origin !== location.origin || data?.type !== 'dozer-mute-query' || !e.source) return;
    e.source.postMessage(muteMessage(), { targetOrigin: location.origin });
  });
  overlay.setMuted(music.muted);
  shareMute();
  overlay.onMute(() => {
    overlay.setMuted(music.toggleMute());
    shareMute();
  });
  /** prefers-reduced-motion: no camera sway or idle path, no light pulse or hue drift. */
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const byId = new Map(surfaces.map((s) => [s.id, s]));
  const picker = new HoverPicker(
    camera,
    surfaces.map((s) => s.mesh),
  );
  const rig = new CameraRig(
    camera,
    overviewPose(cameraConfig.overview.position, cameraConfig.overview.lookAt),
    cameraConfig.flightMs,
    cameraConfig.arc,
  );
  rig.setSway(!motionQuery.matches);
  const clips = findCameraClips(room.scene, room.animations);
  console.info(
    '[camera] idle path:',
    clips.idle ? 'yes' : 'none (fallback overview)',
    'screen paths:',
    [...clips.byScreen.keys()].join(', ') || 'none',
  );

  const gate = createPaintGate(
    renderer.domElement,
    renderer,
    surfaces.map((s) => ({ id: s.id, element: s.element, texture: s.texture })),
  );

  let state = initialState;
  const dispatch = (a: Action) => {
    const next = reduce(state, a);
    if (next === state) return;
    const prev = state;
    state = next;
    onStateChange(prev, next);
  };

  const poseFor = (id: string | null): Pose =>
    id === null
      ? overviewPose(cameraConfig.overview.position, cameraConfig.overview.lookAt)
      : focusPose(byId.get(id)!.rect, camera.fov, camera.aspect, cameraConfig.fill);
  const director = new CameraDirector(camera, room.scene, clips, rig, poseFor, cameraConfig.blendMs);

  function onStateChange(prev: AppState, next: AppState) {
    if (next.mode === 'flying' && prev.mode !== 'flying') {
      rig.setSway(false);
      for (const s of surfaces) s.setInteractive(false);
      focusPoint = next.flyingTo !== null ? byId.get(next.flyingTo)!.rect.center : overviewLookAt;
      // The screen being flown to fills more and more of the view, so it uploads at full rate.
      gate.setPriority(next.flyingTo !== null ? byId.get(next.flyingTo)!.element : null);
      for (const s of surfaces) s.setRasterScale(s.id === next.flyingTo ? focusRasterScale : overviewRasterScale);
      if (next.flyingTo !== null) director.flyTo(next.flyingTo, () => dispatch({ type: 'arrive' }));
      else director.flyBack(() => dispatch({ type: 'arrive' }));
    }
    if (next.mode === 'focus') {
      const s = byId.get(next.focused!)!;
      s.setInteractive(true);
      s.focus();
    }
    if (next.mode === 'overview') {
      rig.setSway(!motionQuery.matches);
      focusPoint = overviewLookAt;
    }
    overlay.setMode(next.mode);
    renderer.domElement.classList.toggle('hover', next.hovered !== null);
    if (next.hovered) outline.setTarget(byId.get(next.hovered)!.mesh);
    outlineAnim.setTarget(next.hovered !== null);
  }

  overlay.onBack(() => dispatch({ type: 'back' }));

  const pointer = { nx: -2, ny: -2 }; // off-screen until the pointer moves
  /** A key picked the hovered screen: the pointer stops picking until it moves. */
  let keyboardHover = false;
  renderer.domElement.addEventListener('pointermove', (e) => {
    keyboardHover = false;
    pointer.nx = (e.clientX / app.clientWidth) * 2 - 1;
    pointer.ny = -(e.clientY / app.clientHeight) * 2 + 1;
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    pointer.nx = -2;
    pointer.ny = -2;
  });
  renderer.domElement.addEventListener('click', () => {
    if (state.mode === 'overview' && state.hovered) dispatch({ type: 'click', id: state.hovered });
  });

  // Keyboard: arrows (and Tab) step through the screens left to right, Enter or Space flies to the hovered one,
  // Escape comes back (overlay.ts). Tab past the last screen leaves for the page's buttons.
  const overviewRight = new Vector3()
    .fromArray(cameraConfig.overview.lookAt)
    .sub(viewpoint)
    .cross(new Vector3(0, 1, 0));
  const screenOrder = [...surfaces]
    .sort(
      (a, b) =>
        a.rect.center.clone().sub(viewpoint).dot(overviewRight) -
        b.rect.center.clone().sub(viewpoint).dot(overviewRight),
    )
    .map((s) => s.id);
  window.addEventListener('keydown', (e) => {
    if (state.mode !== 'overview' || e.metaKey || e.ctrlKey || e.altKey) return;
    const onPage = document.activeElement === document.body || document.activeElement === renderer.domElement;
    const tab = e.key === 'Tab' && onPage;
    const step = tab ? (e.shiftKey ? -1 : 1) : ARROW_STEPS[e.key];
    if (step) {
      const next = cycleScreen(screenOrder, state.hovered, step, !tab);
      if (next !== null || state.hovered !== null) {
        keyboardHover = true;
        dispatch({ type: 'hover', id: next });
      }
      if (next !== null) e.preventDefault();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && onPage && state.hovered) {
      e.preventDefault();
      dispatch({ type: 'click', id: state.hovered });
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = app.clientWidth / app.clientHeight;
    camera.updateProjectionMatrix();
    post.setSize(app.clientWidth, app.clientHeight);
    if (state.mode === 'focus') director.retarget(state.focused);
    else if (state.mode === 'flying') director.retarget(state.flyingTo);
  });

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    const msg = document.createElement('div');
    msg.className = 'unsupported';
    const title = document.createElement('h1');
    title.textContent = 'Graphics context lost';
    const reload = document.createElement('button');
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => location.reload());
    const p = document.createElement('p');
    p.appendChild(reload);
    msg.append(title, p);
    removeSplash();
    ui.appendChild(msg);
  });

  let last = performance.now();
  /** The loading veil lifts once the screens have painted, so the room behind it is complete. */
  let splashReady = false;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(100, now - last);
    last = now;
    if (state.mode === 'overview' && !keyboardHover)
      dispatch({ type: 'hover', id: picker.pick(pointer.nx, pointer.ny) });
    director.idleMotion = !motionQuery.matches;
    director.update(dt, now);
    music.update(dt);
    interactions.update();
    outline.width = outlineAnim.update(dt);
    const focusTarget = camera.position.distanceTo(focusPoint);
    dofFocus = dofFocus === null ? focusTarget : MathUtils.lerp(dofFocus, focusTarget, 1 - Math.exp(-dt / 400));
    post.setFocusDistance(dofFocus);
    const motionNow = motionQuery.matches ? 0 : now; // reduced motion: lights hold their base state
    dyn.update(motionNow);
    emissiveHueFx.update(motionNow);
    if (gate.ready()) {
      if (!splashReady) {
        splashReady = true;
        overlay.ready(() => {
          // Allowed at once when arriving by a click from the landing page; otherwise on the first click or key press.
          // Retries on every gesture until the music plays.
          startUntilPlaying(audioEl, window, () => music.start());
        });
      }
      for (const l of screenLights) l.update(now);
      post.render(dt / 1000);
    }
  });
}

boot().catch((err) => {
  console.error(err);
  removeSplash();
  showError(document.getElementById('app')!, err);
});
