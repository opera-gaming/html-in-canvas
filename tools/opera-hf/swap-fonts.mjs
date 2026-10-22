#!/usr/bin/env node
// Replace the commercial Söhne webfonts in the compiled header/footer CSS with the free
// Inter Tight / Roboto Mono (OFL 1.1, tracked in site/opera-hf/fonts/). The next repo's SCSS
// references Söhne, which must never be committed or shipped from this public repo.
// Fails if anything Söhne-related survives the swap.
// Usage: node tools/opera-hf/swap-fonts.mjs <css-file>   (rewrites the file in place)
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('usage: node tools/opera-hf/swap-fonts.mjs <css-file>')

const FONT_DIR = '/html-in-canvas/opera-hf/fonts'
const face = (family, weight, path) =>
  `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;` +
  `src:url("${FONT_DIR}/${path}") format("woff2")}`

const FREE_FACES = [
  ...[400, 500, 600, 700, 900].map((w) =>
    face('Inter Tight', w, `inter-tight/inter-tight-latin-${w}-normal.woff2`),
  ),
  face('Roboto Mono', 400, 'roboto-mono/roboto-mono-latin-400-normal.woff2'),
].join('')

let css = readFileSync(file, 'utf8')

// The four Söhne @font-face rules → one block of free faces.
const SOEHNE_FACE = /@font-face\{font-family:"Söhne[^"]*";[^}]*\}/g
const faces = css.match(SOEHNE_FACE) ?? []
if (faces.length === 0) throw new Error(`${file}: no Söhne @font-face rules found (next changed?)`)
css = css.replace(SOEHNE_FACE, '')
const insertAt = css.lastIndexOf('}') + 1
css = css.slice(0, insertAt) + FREE_FACES + css.slice(insertAt)

// .next-theme font tokens.
css = css
  .replace(/--font-family-link: 'Söhne Mono', 'Roboto Mono', 'Courier New', monospace/g,
    "--font-family-link: 'Roboto Mono', 'Courier New', monospace")
  .replace(/--font-family-accent: 'Söhne Breit', roboto, sans-serif/g,
    "--font-family-accent: 'Inter Tight', roboto, sans-serif")
  .replace(/--font-family: 'Söhne', roboto, sans-serif/g,
    "--font-family: 'Inter Tight', roboto, sans-serif")

if (/s[oö]hne/i.test(css)) {
  const at = css.search(/s[oö]hne/i)
  throw new Error(`${file}: Söhne reference survived the swap near: ${css.slice(Math.max(0, at - 60), at + 80)}`)
}

writeFileSync(file, css)
console.log(`Swapped Söhne → Inter Tight / Roboto Mono in ${file}`)
