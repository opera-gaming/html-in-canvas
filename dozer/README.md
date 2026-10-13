# Webpage Bulldozer

A WebGPU bulldozer drives across a live webpage captured with HTML-in-Canvas, pushing its words, images and form
controls into heaps and breaking them apart, all simulated in compute shaders. Clicking a control's body, wherever it
has been pushed, operates the real control.

Requires a Chromium-based browser (152+) with WebGPU and `chrome://flags/#canvas-draw-element` (or
`opera://flags/#canvas-draw-element`) enabled. Keep the window visible while the page loads.

## Running

    npm install
    npm run dev       # http://localhost:5180
    npm test          # unit tests
    npm run verify -- "?debug" push   # headless end-to-end check (Playwright); actions are listed in tools/verify.mjs

## Controls

| Key | Action |
|---|---|
| W / ↑, S / ↓ | Throttle forward / reverse |
| A / ←, D / → | Steer (tank steering) |
| Space | Brake |
| R | Reset the page and the dozer |
| M | Mute / unmute |
| Click a control's body | Operates the real control; Esc leaves a text field |

Query parameters: `max=N` (body capacity), `iter=N` (solver iterations), `tune=key:value,…` (overrides for `TUNING`
in `src/gpu/sim.ts`), `capture=2d` (prefer the 2D capture path), `debug`, `prof`, `showpage`.
