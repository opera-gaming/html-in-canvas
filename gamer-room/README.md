# Gamer Room

A three.js gaming room whose screens show live, interactive web pages via HTML-in-Canvas.

## Run

Needs Chromium 149+ with `chrome://flags/#canvas-draw-element` (Opera: `opera://flags/...`) enabled.

    npm install
    npm run dev     # http://localhost:5173
    npm test

The arcade screen shows a build of `../dozer` from `public/replicas/dozer/`, which is not checked in (it shows the
default page until built). Build it once, and again after changing the dozer:

    cd ../dozer && npm install && npx vite build --base /replicas/dozer/ --outDir ../gamer-room/public/replicas/dozer --emptyOutDir

## Assets

`public/models/room.glb` and `public/lightmaps/` come from a Blender scene (not in the repo) via
`npm run bake:blender` (`tools/bake.py`) and `npm run export:blender` (`tools/export.py`, configured by
`tools/export_config.json`). `public/replicas/dozer` is a build of `../dozer` (see Run).

The two monitors show `/replicas/gxcorner/` and `/replicas/gx/`. Those pages are not in the repo: they are copies of
third-party sites, so make your own with `tools/snapshot-site.mjs` (`--gx` for GX Corner) or point the screens at
same-origin pages of your own in `src/config/screens.ts`. A screen whose page is missing shows
`public/replicas/default/`.
