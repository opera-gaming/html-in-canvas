# Opera header & footer (site/opera-hf/)

The `site/opera-hf/` folder holds a self-contained copy of the Opera site header and
footer used across next.opera.com, so the html-in-canvas landing page matches the
rest of the site.

| File | What it is |
| --- | --- |
| `header-footer.html` | Header + footer markup, generated from the nunjucks macros `components/opera-header.njk` / `components/opera-footer.njk` of the **next** repo (`~/opcom/next`). |
| `header-footer.css` | Compiled CSS scoped to the header/footer (design tokens via the `next-theme` class + dark `footer-wrap` overrides). Does **not** include the next site's global typography, so it won't restyle the rest of the page. |
| `wheel/` | The **animated** Tabscape wheel (canvas hover/click effect) — `TabscapeWheel.js` + `WheelGeometry.js` transpiled from the identical TS files in the next repo, plus `tabscape-wheel.js` boot entry, loaded as `<script type="module">` on the landing page. On reduced-motion / touch the static SVG in `header-footer.html` stays visible. |
| `fonts/` `images/` | Söhne webfonts and the logo/SVG assets referenced by the markup and CSS. |

## How it's wired in

- `site/index.html` has `<!-- opera-header -->` and `<!-- opera-footer -->` markers and
  links `opera-hf/header-footer.css`.
- `tools/build-site.sh` copies `site/opera-hf/` into `public/opera-hf/` and runs
  `node tools/inject-header-footer.mjs` to replace the markers with the header and
  footer (adding the `next-theme` class and the `<footer class="footer-wrap">` shell,
  mirroring `base.njk` of the next repo).

## Updating from the next repo

When the header/footer change in `~/opcom/next` (templates, SCSS, logos):

```bash
bash tools/opera-hf/update.sh ~/opcom/next
bash tools/build-site.sh && node tools/serve.mjs
```

`update.sh` only reads from the next repo — it never writes back. It recompiles the
SCSS from `tools/opera-hf/export.scss` (via the next repo's own `sass`), re-renders
the nunjucks macros, and re-copies the fonts/images, rewriting asset URLs onto the
`/html-in-canvas/opera-hf/…` prefix this site serves under. It also re-copies the
Tabscape wheel TypeScript (`tools/opera-hf/wheel/`) from the next repo, transpiles
it to browser ESM under `site/opera-hf/wheel/` (via the next repo's `tsc` — the
only change is appending `.js` to the relative import specifiers).

### Permanent dark header

The html-in-canvas landing page is always dark, so the port **forces** the dark
theme on the header instead of following the OS/browser scheme (in the next repo
dark is gated behind `prefers-color-scheme`). Two things make this permanent and
survive regeneration:

- `tools/opera-hf/export.scss` includes the `opera-2026-dark-theme-variables` mixin
  on `.next-header.next-theme` unconditionally (higher specificity than the media-
  gated `.next-theme` block), so the header always wears dark tokens;
- `tools/opera-hf/render-hf.mjs` collapses the `<picture>`/`<source>` logo switcher
  from the next macro into a plain `<img>` using the white
  `opera-logo-text-flat-2026-darkmode.module.svg` every time.

The footer keeps its own always-dark `.footer-wrap` overrides.
