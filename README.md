# HTML-in-Canvas demos

Demos of the [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) browser feature. They need a Chromium-based
browser with `chrome://flags/#canvas-draw-element` enabled.

| Project                    | Demo                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| [gamer-room](gamer-room/)  | A three.js gaming room whose screens show live, interactive web pages      |
| [dozer](dozer/)            | A WebGPU bulldozer that pushes a webpage's words into piles                |
| [ninja](ninja/)            | HTML Ninja: slice flying HTML elements                                     |
| [effects](effects/)        | Live pages run through WebGL shaders: fire, teleport, dust, transitions... |

New to the API? Start with [hello/index.html](hello/index.html): one file, about 140 lines, no build.

Run `npm install` and `npm run dev` inside a project folder. `kit/` holds code shared by `effects` and `ninja`.
`tools/build-site.sh` builds every demo, plus the landing page in `site/`, into one static site in `public/`,
with production URLs under `/html-in-canvas/` (for example, `/html-in-canvas/dozer/`).

## Setup

- Node.js 20.19+ or 22.12+ with npm (Vite 8's minimum; developed on Node 25). Each project has its own
  `package.json`; there is no root install.
- Deploy: Vercel runs `bash tools/build-site.sh` (see `vercel.json`), which installs and builds every project, including
  the dozer copy for the room's arcade screen, and mounts the assembled `public/` at `/html-in-canvas/`. The domain
  root redirects there. Other static hosts must mount `public/` at the same prefix; for a local full-site preview,
  run the build script and serve `public/` under `/html-in-canvas/`, not at the server root.

## License

Copyright 2026, Opera Norway AS. Licensed under the [Apache License 2.0](LICENSE), except for the following:

- `gamer-room/public/audio/1000 Handz - Statik.mp3`:
  ["Statik" by 1000 Handz](https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-electronicgaming-instrumentals/statik/),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- `ninja/public/audio/little-chaos.mp3`: ["Little Chaos" by Ketsa](https://freemusicarchive.org/music/Ketsa/silly-happy/little-chaos/),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- `effects/src/transitions/generated.ts`: transition shaders from Opera's GameMaker transition prefab, ported from
  [gl-transitions](https://github.com/gl-transitions/gl-transitions), with simplex noise by Ashima Arts; MIT, with the
  notices in the file.
- `dozer/public/page/{tram,duck,buns}.jpg`: public domain (CC0) photos from Wikimedia Commons, resized and cropped:
  [tram](https://commons.wikimedia.org/wiki/File:Malmo_historic_tram_citadel.JPG) by Jan Pešula,
  [duck](https://commons.wikimedia.org/wiki/File:Day_60_Just_ducky_(32363040674).jpg) by terri_bateman,
  [buns](https://commons.wikimedia.org/wiki/File:Cardamom_buns.jpg) by W.carter.

Everything else is original work for these demos and falls under the Apache License 2.0, including:

- the sound effects (`ninja/public/audio/*.ogg`, `dozer/public/dozer/*.ogg`): recordings by Erik Möller;
- the gaming room model and its Blender scene, lightmaps and textures;
- the post-processing effects, ported from Opera's GameMaker post-process prefab;
- the HTML Ninja background and bomb (`ninja/public/img/ninja-wood.jpg`, `molotov.png`) and the bulldozer sprites (`dozer/public/dozer/*.png`),
  made by Erik Möller with ChatGPT image generation;
- the clips and posters on the landing page (`site/media/`), screen recordings of the demos.

[NOTICE](NOTICE) collects the third-party notices. The deployed site lists them too, with the per-transition authors and
the bundled three.js, postprocessing and N8AO notices, in [site/licenses.html](site/licenses.html).
