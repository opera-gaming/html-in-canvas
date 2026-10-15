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

The two monitors show `pages/page-1/` and `pages/page-2/` (see `src/config/screens.ts`). Those pages are not in this repo: the deploy serves them from a separate repo next to the
site. To see them locally, put them in `public/pages/` (ignored by git), for example as a symlink to a checkout's
`pages/` folder. A screen whose page is missing shows `public/replicas/default/`. `tools/snapshot-site.mjs` saves a
static, same-origin copy of a live page for a screen.
