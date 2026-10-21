# Opera header & footer (site/opera-hf/)

Self-contained copy of the Opera site header/footer used across next.opera.com,
so the landing page matches the rest of the site.

| File | What it is |
| --- | --- |
| `header-footer.html` | Header/footer markup from the next repo's nunjucks macros. |
| `header-footer.css` | Scoped header/footer CSS (no global typography, so the page's own styles stay intact). |
| `wheel/` | Animated Tabscape wheel (canvas hover/click) as browser ESM; static SVG fallback for reduced-motion/touch. |
| `fonts/` `images/` | Free webfonts used by the header/footer (Inter Tight, Roboto Mono; SIL OFL 1.1) and the logo/SVG assets referenced by the markup and CSS. |

## Wire-in

- `site/index.html` carries `<!-- opera-header -->` / `<!-- opera-footer -->` markers and links `opera-hf/header-footer.css`.
- `tools/build-site.sh` copies `site/opera-hf/` → `public/opera-hf/` and runs
  `tools/inject-header-footer.mjs` to splice the header/footer into the page.

## Regenerating from the next repo

`update.sh` recompiles all of the above from a checkout of the next.opera.com repo
(templates, SCSS and fonts/logos, via that repo's `sass`/`tsc`). It only reads from
it — nothing is written back. Run it whenever the header/footer change upstream:

```bash
bash tools/opera-hf/update.sh <path-to-next-repo>
bash tools/build-site.sh && node tools/serve.mjs
```

Baked into regeneration:

- Header is always dark (dark tokens + white logo) — the landing page is dark, not the OS.
- “Next” keeps linking to the root (`/`) of next.opera.com; the footer breadcrumb reflects the html-in-canvas path.
- Footer drops the “Cookie Consent” link and the language selector (not implemented here).

> ⚠️ `update.sh` copies the commercial **Söhne** webfonts from the next repo and regenerates
> `header-footer.css` with `@font-face`/font-family references to them. Söhne must never be
> committed (`site/opera-hf/fonts/soehne/` is gitignored) nor shipped: after each regeneration,
> re-apply the Söhne → Inter Tight / Roboto Mono swap (delete `site/opera-hf/fonts/soehne/` and
> restore the Inter Tight/Roboto Mono `@font-face` + family declarations in `header-footer.css`).
