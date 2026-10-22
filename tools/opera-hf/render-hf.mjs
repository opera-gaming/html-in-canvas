// Render next.opera.com header/footer macros to a static fragment.
// Usage: node tools/opera-hf/render-hf.mjs <next-repo-path>
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const nextRepo = process.argv[2]
const nunjucks = (await import(pathToFileURL(join(nextRepo, 'node_modules/nunjucks/index.js')))).default

const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([join(nextRepo, 'src/templates')]),
)
env.autoescape = false

// Breadcrumb: this landing page is the html-in-canvas section of next.opera.com,
// so “Next” links to the root (/) and the section is the current-page text.
const src = `
{% from "components/opera-header.njk" import opera_header_component %}
{% from "components/opera-footer.njk" import opera_footer_component %}
{{ opera_header_component() }}
{{ opera_footer_component(crumbs=[
    { label: 'HTML-in-Canvas', url: null }
]) }}
`

let html = env.renderString(src)

// Page is always dark → always use the white (darkmode) logo.
html = html.replace(/<picture>[\s\S]*?<\/picture>/g, (m) => {
  const img = m.match(/<img[\s\S]*?>/)
  if (!img) return m
  return img[0].replace(
    /src="[^"]*"/,
    'src="/assets/images/logo/opera-logo-text-flat-2026-darkmode.module.svg"',
  )
})

// Drop the language selector (removed from next.opera.com; no i18n here).
html = html.replace(
  /(\s*<div class="footer__lang-box">[\s\S]*?<\/div>)/g,
  '<!-- Language selector removed: no i18n here -->',
)

process.stdout.write(html)
