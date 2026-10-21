import { FOOTER_WHEEL, WheelGeometry } from './WheelGeometry';

interface WheelCell {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity: number;
  // Accumulated "push" offset (viewBox units). Grows while the cursor moves
  // or a ripple passes through, and decays back to zero (Tabscape pushDecay).
  offsetX: number;
  offsetY: number;
  // Scale is derived from |push| exactly like the Tabscape renderer:
  // influence = min(1, |push| / PUSH_MAG_FOR_FULL_SCALE) → SCALE_MIN..SCALE_MAX.
  scale: number;
}

interface Ripple {
  x: number;
  y: number;
  startTime: number; // ms
}

// ──────────────────────────────────────────────────────────────────────────
// Physics constants. Values mirror the Tabscape RippleMode + RippleManager
// (+ the renderer's push→scale rule) from tabscape.vercel.app/tabscape/,
// expressed in the shared wheel viewBox (1180 × 360) units.
// ──────────────────────────────────────────────────────────────────────────

// Cursor "drag": tiles within the radius are pushed along the cursor's
// movement direction, harder the faster it moves, and relax when it stops.
const CURSOR_RADIUS = 200; // cursorRadius
const VELOCITY_PUSH_AMOUNT = 40; // velocityPushAmount
const CURSOR_STRENGTH = 0.5; // pulseStrength / 100
const MAX_NORMALIZED_SPEED = 800; // u/s that maps normalizedSpeed → 1
const MIN_MOVE_SPEED = 5; // below this the cursor counts as still
const PUSH_DECAY = 0.8; // per-60Hz-frame multiplier (pushDecay)

// Click wave: an omnidirectional ring expands from the click point and
// pushes every tile it passes through, then fades with distance travelled.
const RIPPLE_SPEED = 300; // viewBox u/s (rippleSpeed)
const RIPPLE_WIDTH = 140; // ring band width (rippleWidth)
const RIPPLE_DECAY = 1.5; // exponential fade per 1000u travelled (rippleDecay)
const RIPPLE_PUSH_AMOUNT = 27; // per-frame push of the wave — exactly half of the original 55 (the user's "make it half")
const RIPPLE_MAX_RADIUS = 1500; // ring lifetime
const MAX_RIPPLES = 10;

// Push → scale (reference renderer: influence = min(1, |push| / 50)).
const PUSH_MAG_FOR_FULL_SCALE = 50;
const SCALE_MIN = 1;
const SCALE_MAX = 1.65;

// Cursor velocity smoothing / idle decay (CursorTracker.smoothing).
const VELOCITY_SMOOTHING = 0.2;

const SETTLE_EPSILON = 0.2; // stop looping once nothing moves
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 60;
const READY_CLASS = 'tabscape-wheel--ready';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function buildCells(geometry: WheelGeometry): WheelCell[] {
  return geometry.tiles.map(([x, y, w, h, color, opacity = 1]) => {
    return {
      x,
      y,
      w,
      h,
      color,
      opacity,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    };
  });
}

// CursorTracker.getFalloffAt('smooth') — smoothstep (hermite) falloff.
function smoothFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const normalized = distance / radius;
  return 1 - normalized * normalized * (3 - 2 * normalized);
}

export default class TabscapeWheel {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly geometry: WheelGeometry;
  private ctx: CanvasRenderingContext2D | null = null;
  private cells: WheelCell[] = [];
  private pointer: { x: number; y: number } | null = null;
  private prevPointer: { x: number; y: number } | null = null; // pointer pos at last tick
  private smoothVelocity = { x: 0, y: 0 }; // smoothed cursor velocity (u/s) for pushing
  private ripples: Ripple[] = [];
  private rafId: number | null = null;
  private lastTickTime = 0;
  private booted = false;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private resizeRafId: number | null = null;
  private readonly onPointerMove = this.handlePointerMove.bind(this);
  private readonly onPointerLeave = this.handlePointerLeave.bind(this);
  private readonly onPointerDown = this.handlePointerDown.bind(this);
  private readonly onPointerEnter = this.handlePointerEnter.bind(this);
  private readonly onVisibilityChange = this.handleVisibilityChange.bind(this);
  private readonly onResize = this.handleResize.bind(this);

  constructor(el: HTMLElement, geometry: WheelGeometry = FOOTER_WHEEL) {
    this.el = el;
    this.geometry = geometry;
    this.canvas = el.querySelector('.tabscape-wheel__canvas') as HTMLCanvasElement;

    if (!this.canvas || this.prefersReducedMotion() || this.primaryInputHasNoHover()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            this.boot();
          }
        });
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  }

  // Touch devices have no hover — the static SVG is the only layer (the SCSS
  // also keeps it visible via @media (hover: none)); never boot the canvas.
  private primaryInputHasNoHover(): boolean {
    return window.matchMedia('(hover: none)').matches;
  }

  private boot(): void {
    if (this.booted) return;

    // Reveal the canvas (it starts `hidden`, which forces `display: none`
    // and a zero-size layout box) before measuring it —
    // otherwise the canvas buffer is sized 0x0 and nothing ever renders.
    this.canvas.hidden = false;

    // Layout size (not getBoundingClientRect) — ignores CSS transforms,
    // so a rotated wheel keeps its canvas buffer in the right proportions.
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    if (width === 0 || height === 0) {
      // Layout hasn't settled yet (e.g. fonts/images still loading) —
      // retry on the next frame rather than booting with a 0x0 canvas.
      requestAnimationFrame(() => this.boot());
      return;
    }

    this.booted = true;
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) return;

    this.cells = buildCells(this.geometry);
    this.resizeCanvas(width, height);

    // Swap from the static SVG to the canvas once it has painted an
    // identical first frame — both render the same tile table, so this is
    // a seamless handoff rather than a cross-fade.
    this.el.classList.add(READY_CLASS);

    this.canvas.addEventListener('pointerenter', this.onPointerEnter);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('resize', this.onResize);
  }

  private resizeCanvas(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    if (this.canvasWidth === width && this.canvasHeight === height) return;

    this.canvasWidth = width;
    this.canvasHeight = height;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.drawFrame();
  }

  private handleResize(): void {
    if (this.resizeRafId !== null) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.resizeCanvas(this.el.offsetWidth, this.el.offsetHeight);
    });
  }

  // offsetX/offsetY are in the canvas's own (untransformed) box, so the
  // mapping stays correct when the wheel is rotated with a CSS transform.
  private toViewboxCoords(event: PointerEvent): { x: number; y: number } {
    return {
      x: (event.offsetX / this.canvas.offsetWidth) * this.geometry.width,
      y: (event.offsetY / this.canvas.offsetHeight) * this.geometry.height,
    };
  }

  private handlePointerEnter(event: PointerEvent): void {
    // Snap the frame-to-frame origin to the entry point so the first tick
    // doesn't compute a huge bogus velocity from a stale position.
    const point = this.toViewboxCoords(event);
    this.pointer = point;
    this.prevPointer = { ...point };
    this.smoothVelocity = { x: 0, y: 0 };
    this.ensureLoop();
  }

  private handlePointerMove(event: PointerEvent): void {
    // Only the position is tracked here. Velocity is computed every frame in
    // tick() from the pointer delta — CursorTracker-style — which keeps the
    // drag stable regardless of pointer-event rate.
    this.pointer = this.toViewboxCoords(event);
    this.ensureLoop();
  }

  private handlePointerDown(event: PointerEvent): void {
    const point = this.toViewboxCoords(event);
    this.ripples.push({ x: point.x, y: point.y, startTime: performance.now() });
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
    this.ensureLoop();
  }

  private handlePointerLeave(): void {
    this.pointer = null;
    this.prevPointer = null;
    this.ensureLoop();
  }

  private handleVisibilityChange(): void {
    if (document.hidden && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    } else if (!document.hidden && (this.pointer || this.ripples.length)) {
      this.ensureLoop();
    }
  }

  private ensureLoop(): void {
    if (this.rafId !== null || document.hidden) return;
    this.lastTickTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  private tick(): void {
    this.rafId = null;

    const now = performance.now();
    let dtFrame = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    if (!dtFrame) dtFrame = FRAME_MS / 1000;
    const dt = Math.min(dtFrame, 0.1);

    const pushScale = dt * 60; // normalise per-frame authoring to ~60Hz
    const decayStep = Math.pow(PUSH_DECAY, pushScale);

    // Cursor velocity, computed per-frame from the pointer delta
    // (CursorTracker.update style) — rate-independent and smooth.
    if (this.pointer && this.prevPointer) {
      const instVX = (this.pointer.x - this.prevPointer.x) / dt;
      const instVY = (this.pointer.y - this.prevPointer.y) / dt;
      this.smoothVelocity.x += (instVX - this.smoothVelocity.x) * VELOCITY_SMOOTHING;
      this.smoothVelocity.y += (instVY - this.smoothVelocity.y) * VELOCITY_SMOOTHING;
    } else {
      // Pointer gone / not yet entered — relax the smoothed velocity to zero.
      this.smoothVelocity.x *= 1 - VELOCITY_SMOOTHING;
      this.smoothVelocity.y *= 1 - VELOCITY_SMOOTHING;
    }
    if (this.pointer) {
      this.prevPointer = { x: this.pointer.x, y: this.pointer.y };
    }

    const smoothSpeed = Math.hypot(this.smoothVelocity.x, this.smoothVelocity.y);
    const normalizedSpeed = Math.min(1, smoothSpeed / MAX_NORMALIZED_SPEED);
    const hasVelocity = this.pointer !== null && smoothSpeed > MIN_MOVE_SPEED;

    // Drop ripples that have travelled beyond their lifetime.
    this.ripples = this.ripples.filter((ripple) => {
      const radius = ((now - ripple.startTime) / 1000) * RIPPLE_SPEED;
      return radius < RIPPLE_MAX_RADIUS;
    });

    // 1) Decay existing push offsets (Tabscape: decay then add).
    this.cells.forEach((cell) => {
      cell.offsetX *= decayStep;
      cell.offsetY *= decayStep;
    });

    // 2) Cursor drag: push tiles near the cursor along its movement
    //    direction, harder the faster it moves (smoothVelocity, u/s).
    if (hasVelocity) {
      const normVx = this.smoothVelocity.x / smoothSpeed;
      const normVy = this.smoothVelocity.y / smoothSpeed;
      const { x: px, y: py } = this.pointer!;

      this.cells.forEach((cell) => {
        const dx = cell.x - px;
        const dy = cell.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist >= CURSOR_RADIUS) return;

        const falloff = smoothFalloff(dist, CURSOR_RADIUS);
        if (falloff <= 0.01) return;

        const mag = falloff * CURSOR_STRENGTH * normalizedSpeed * VELOCITY_PUSH_AMOUNT * pushScale;
        cell.offsetX += normVx * mag;
        cell.offsetY += normVy * mag;
      });
    }

    // 3) Click waves: radial push for every tile the expanding ring passes.
    if (this.ripples.length) {
      this.cells.forEach((cell) => {
        let x = cell.offsetX;
        let y = cell.offsetY;
        for (const ripple of this.ripples) {
          const dx = cell.x - ripple.x;
          const dy = cell.y - ripple.y;
          const dist = Math.hypot(dx, dy);
          const radius = ((now - ripple.startTime) / 1000) * RIPPLE_SPEED;
          const distFromRing = Math.abs(dist - radius);
          if (distFromRing >= RIPPLE_WIDTH) continue;

          const decayFactor = Math.exp((-radius * RIPPLE_DECAY) / 1000);
          if (decayFactor <= 0.005) continue;

          const ringInfluence = 1 - distFromRing / RIPPLE_WIDTH;
          const influence = ringInfluence * decayFactor;
          const pushStr = influence * RIPPLE_PUSH_AMOUNT * pushScale;
          const angle = Math.atan2(dy, dx);
          x += Math.cos(angle) * pushStr;
          y += Math.sin(angle) * pushStr;
        }
        cell.offsetX = x;
        cell.offsetY = y;
      });
    }

    // 4) Scale from accumulated push magnitude (reference renderer rule).
    let stillMoving = this.ripples.length > 0;
    this.cells.forEach((cell) => {
      const pushMag = Math.hypot(cell.offsetX, cell.offsetY);
      const influence = Math.min(1, pushMag / PUSH_MAG_FOR_FULL_SCALE);
      cell.scale = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * influence;
      if (pushMag > SETTLE_EPSILON) stillMoving = true;
    });

    this.drawFrame();

    // Keep the loop alive while the pointer is over the wheel (so the drag
    // is tracked continuously, like Tabscape's always-on draw loop) or while
    // the cells are still settling back to rest.
    if (this.pointer || stillMoving) {
      this.ensureLoop();
    }
  }

  private drawFrame(): void {
    if (!this.ctx) return;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    const scaleX = width / this.geometry.width;
    const scaleY = height / this.geometry.height;
    const radius = this.geometry.radius;

    this.ctx.clearRect(0, 0, width, height);

    this.cells.forEach((cell) => {
      const x = (cell.x + cell.offsetX) * scaleX;
      const y = (cell.y + cell.offsetY) * scaleY;
      const w = cell.w * scaleX * cell.scale;
      const h = cell.h * scaleY * cell.scale;

      this.ctx!.globalAlpha = cell.opacity;
      this.ctx!.fillStyle = cell.color;
      this.ctx!.beginPath();
      if (typeof this.ctx!.roundRect === 'function') {
        this.ctx!.roundRect(x - w / 2, y - h / 2, w, h, h * radius);
      } else {
        this.ctx!.rect(x - w / 2, y - h / 2, w, h);
      }
      this.ctx!.fill();
    });

    this.ctx.globalAlpha = 1;
  }
}

/**
 * Mounts a wheel on every still-live element (nodes removed from the document
 * since main.ts collected them — e.g. by a re-render — are skipped).
 *
 * The main.ts router calls this only once the footer is near the viewport and
 * the user hasn't opted into reduced motion; the design-system styles above
 * are downloaded and adopted together with this module at that point.
 *
 * `getGeometry` lets a page pick a different tile picture per element
 * (e.g. the welcome-one side wheels); it defaults to the footer wheel.
 */
export function mountTabscapeWheel(
  elements: HTMLElement[],
  getGeometry: (el: HTMLElement) => WheelGeometry = () => FOOTER_WHEEL,
): void {
  elements.forEach((el) => {
    if (document.documentElement.contains(el)) new TabscapeWheel(el, getGeometry(el));
  });
}
