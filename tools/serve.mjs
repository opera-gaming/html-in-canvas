#!/usr/bin/env node
// Local preview for the built site (tools/build-site.sh → public/). Internal
// links carry an "/html-in-canvas/..." prefix, so public/ is served under it,
// mirroring the Vercel deployment.
// Usage: node tools/serve.mjs [port]   → http://localhost:4173/html-in-canvas/
// Consent bundle: set CONSENT_ORIGIN to a next.opera.com checkout/host to try the real popup locally, e.g.
//   CONSENT_ORIGIN=http://localhost:3000 node tools/serve.mjs   (npm run dev in the next repo)
// Without it /assets/consent/* is a no-op stub (the bundle is published by next.opera.com in production).
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

// The consent bundle belongs to next.opera.com (same origin in production), so it is not part of public/.
const CONSENT_PREFIX = '/assets/consent/'
const CONSENT_ORIGIN = process.env.CONSENT_ORIGIN?.replace(/\/$/, '')

async function serveConsent(req, res) {
  if (!CONSENT_ORIGIN) {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' })
    res.end('// consent bundle is served by next.opera.com; no-op in local preview\n')
    return
  }
  try {
    const upstream = await fetch(CONSENT_ORIGIN + req.url)
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || MIME['.js'],
      'Cache-Control': 'no-store',
    })
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(`consent proxy to ${CONSENT_ORIGIN} failed: ${err.message}`)
  }
}

http
  .createServer((req, res) => {
    if (req.url.startsWith(CONSENT_PREFIX)) {
      serveConsent(req, res)
      return
    }
    const abs = resolve(req.url)
    if (!abs || !existsSync(abs)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('404 Not Found: ' + req.url)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs)] || 'application/octet-stream',
      // Dev server: never cache, so edits show up on plain refresh.
      'Cache-Control': 'no-store',
    })
    createReadStream(abs).pipe(res)
  })
  .listen(PORT, () => console.log(`html-in-canvas preview @ http://localhost:${PORT}/html-in-canvas/`))
