#!/usr/bin/env node
// Inject the shared Opera header/footer (site/opera-hf/header-footer.html) into
// a built page that carries <!-- opera-header --> / <!-- opera-footer --> markers.
//
// The fragment is the exact markup from the next.opera.com repo (regenerated via
// tools/opera-hf/update.sh). It contains a <header class="next-header">…</header>
// followed by the footer inner content (breadcrumbs, columns, tabscape wheel) —
// this script adds the design-system `next-theme` class and wraps the footer in
// the <footer class="footer-wrap"><div class="wrapper container-fluid"> shell,
// mirroring base.njk of the next repo.
//
// Usage: node tools/inject-header-footer.mjs <fragment.html> <output.html>
import { readFileSync, writeFileSync } from 'node:fs'

const [, , fragmentPath = 'site/opera-hf/header-footer.html', outputPath = 'public/index.html'] =
  process.argv

const fragment = readFileSync(fragmentPath, 'utf8')
const headerEnd = fragment.indexOf('</header>')
if (headerEnd === -1) throw new Error(`No </header> found in ${fragmentPath}`)

// <header class="next-header"> → <header class="next-header next-theme">
const header = fragment
  .slice(0, headerEnd + '</header>'.length)
  .replace('<header class="next-header"', '<header class="next-header next-theme"')

const footerInner = fragment.slice(headerEnd + '</header>'.length).trim()
const footer = [
  '<footer class="footer-wrap next-theme">',
  '  <div class="wrapper container-fluid">',
  footerInner,
  '  </div>',
  '</footer>',
].join('\n')

const page = readFileSync(outputPath, 'utf8')
if (!page.includes('<!-- opera-header -->') || !page.includes('<!-- opera-footer -->')) {
  throw new Error(`${outputPath} is missing the <!-- opera-header --> / <!-- opera-footer --> markers`)
}

const out = page
  .replace('<!-- opera-header -->', header)
  .replace('<!-- opera-footer -->', footer)

writeFileSync(outputPath, out)
console.log(`Injected header+footer into ${outputPath} (${out.length} bytes)`)
