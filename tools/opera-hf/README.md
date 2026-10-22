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
- Footer drops the language selector (not implemented here). The “Cookie Consent” link is kept: it is wired up by the
  consent bundle (`/assets/consent/v1/consent.js`) that the next.opera.com site publishes on the same origin, so
  this repo holds no consent code, legal text or GTM container ID. Without the bundle (forks, local preview,
  `vercel.app` previews) the link does nothing and no analytics load.

Fonts: next's SCSS references the commercial **Söhne** webfonts, which must never be committed or shipped from
this public repo. `update.sh` never copies them; `swap-fonts.mjs` rewrites the compiled `header-footer.css` to the
free Inter Tight / Roboto Mono (OFL 1.1, tracked in `site/opera-hf/fonts/`) and fails the run if any Söhne
reference survives. `site/opera-hf/fonts/soehne/` is also gitignored as a second safeguard.
