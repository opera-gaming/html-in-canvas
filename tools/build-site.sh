#!/usr/bin/env bash
# Copyright 2026, Opera Norway AS
# SPDX-License-Identifier: Apache-2.0
#
# Assemble the demos into ./public, served under /html-in-canvas/:
#   /        landing page (site/index.html)
#   /room/   gamer-room page; its assets stay at the site base
#   /dozer/  dozer
#   /fire/, /teleport/, /endgame/, /electric/, /transitions/, /post/, /frost/   the effects pages (one Vite project, effects/)
#   /ninja/  HTML Ninja
#   /hello/  the minimal example (hello/index.html, no build)
#   /licenses/  third-party notices (site/licenses.html)
set -euo pipefail
cd "$(dirname "$0")/.."

export VITE_SITE_BASE=/html-in-canvas/

(cd dozer && npm ci && npm run build -- --base "${VITE_SITE_BASE}dozer/")
# The room's arcade screen embeds its own build of the dozer.
(cd dozer && npx vite build --base "${VITE_SITE_BASE}replicas/dozer/" --outDir ../gamer-room/public/replicas/dozer --emptyOutDir)
(cd gamer-room && npm ci && npm run build -- --base "$VITE_SITE_BASE")
(cd effects && npm ci && npm run build -- --base "$VITE_SITE_BASE")
(cd ninja && npm ci && npm run build -- --base "${VITE_SITE_BASE}ninja/")

rm -rf public
cp -R gamer-room/dist public
mkdir -p public/room
mv public/index.html public/room/index.html
cp -R dozer/dist public/dozer
cp -R effects/dist/. public/
cp -R ninja/dist public/ninja
cp site/index.html public/index.html
cp site/favicon.svg public/favicon.svg
cp -R hello public/hello
mkdir -p public/licenses
cp site/licenses.html public/licenses/index.html
cp -R site/media public/media
cp -R site/opera-hf public/opera-hf
# Landing page ships the shared Opera header/footer.
node tools/inject-header-footer.mjs site/opera-hf/header-footer.html public/index.html
