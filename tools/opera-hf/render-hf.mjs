// Render the opera header + footer macros from the next repo to a static HTML
// fragment (the exact markup used on next.opera.com).
//
// Usage: node tools/opera-hf/render-hf.mjs <next-repo-path>
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const nextRepo = process.argv[2]
const nunjucks = (await import(pathToFileURL(join(nextRepo, 'node_modules/nunjucks/index.js')))).default

const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([join(nextRepo, 'src/templates')]),
)
env.autoescape = false

const src = `
{% from "components/opera-header.njk" import opera_header_component %}
{% from "components/opera-footer.njk" import opera_footer_component %}
{{ opera_header_component() }}
{{ opera_footer_component() }}
`

let html = env.renderString(src)

// The landing page is permanently dark, so the header always uses the white
// (darkmode) logo. The next macro switches it via <picture>/prefers-color-scheme;
// here we collapse that to a plain <img> with the darkmode SVG every time.
html = html.replace(/<picture>[\s\S]*?<\/picture>/g, (m) => {
  const img = m.match(/<img[\s\S]*?>/)
  if (!img) return m
  return img[0].replace(
    /src="[^"]*"/,
    'src="/assets/images/logo/opera-logo-text-flat-2026-darkmode.module.svg"',
  )
})

// This repo has no cookie-consent implementation (CookieConsent.ts/GTM live in
// the next repo), so the “Cookie Consent” withdraw link in the footer would do
// nothing — drop it. NB: don't wrap the removed markup in an HTML comment, its
// `block--clickable` class breaks out of a comment via the "--" sequence.
html = html.replace(
  /(\s*<li>\s*<span class="hf__link cookie_withdraw block--clickable">[\s\S]*?<\/span>\s*<\/li>)/g,
  '<!-- Cookie Consent withdraw link disabled: html-in-canvas has no cookie-consent implementation -->',
)

// The language selector is being removed from next.opera.com (no i18n on this
// site either) — drop the footer__lang-box block while keeping a breadcrumb.
html = html.replace(
  /(\s*<div class="footer__lang-box">[\s\S]*?<\/div>)/g,
  '<!-- Language selector removed: dropped from next.opera.com, this site has no i18n -->',
)

process.stdout.write(html)
