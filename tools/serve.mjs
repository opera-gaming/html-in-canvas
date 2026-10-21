#!/usr/bin/env node
// Local preview server for the assembled full site (output of tools/build-site.sh).
//
// The production build bakes "/html-in-canvas/..." into every internal link
// (VITE_SITE_BASE), so `public/` must be served under that prefix, not at the
// server root. Vercel does this for the deployed site; this script does it locally.
//
// Usage:  node tools/serve.mjs            # → http://localhost:4173/html-in-canvas/
//         node tools/serve.mjs 8080       # custom port
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const PORT = Number(process.argv[2] || 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function resolve(urlPath) {
  // Strip the /html-in-canvas/ prefix the build baked into links.
  let p = decodeURIComponent(urlPath.split('?')[0])
  if (p.startsWith('/html-in-canvas/')) p = p.slice('/html-in-canvas'.length)
  if (p === '/html-in-canvas') p = '/'
  p = p === '/' ? '/index.html' : p
  const abs = normalize(join(ROOT, p))
  if (!abs.startsWith(ROOT)) return null // path traversal guard
  if (existsSync(abs) && statSync(abs).isDirectory()) return join(abs, 'index.html')
  return abs
}

http
  .createServer((req, res) => {
    const abs = resolve(req.url)
    if (!abs || !existsSync(abs)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('404 Not Found: ' + req.url)
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(abs)] || 'application/octet-stream' })
    createReadStream(abs).pipe(res)
  })
  .listen(PORT, () => console.log(`html-in-canvas preview @ http://localhost:${PORT}/html-in-canvas/`))
