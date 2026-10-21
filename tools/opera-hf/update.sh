#!/usr/bin/env bash
# Regenerate the shared Opera header/footer under site/opera-hf/ from a checkout
# of the next.opera.com repo (templates, SCSS, fonts, logos, Tabscape wheel).
# Only reads from it — nothing is written back. Run manually when next changes.
# Usage: bash tools/opera-hf/update.sh <path-to-next-repo>
set -euo pipefail
cd "$(dirname "$0")/../.."

NEXT="${1:?usage: bash tools/opera-hf/update.sh <path-to-next-repo>}"
SASS="$NEXT/node_modules/.bin/sass"
TSC="$NEXT/node_modules/.bin/tsc"
[ -x "$SASS" ] || { echo "sass not found in $NEXT (npm install there first)" >&2; exit 1; }
[ -x "$TSC" ] || { echo "tsc not found in $NEXT (npm install there first)" >&2; exit 1; }
[ -d "$NEXT/src/templates/components" ] || { echo "not a next repo: $NEXT" >&2; exit 1; }

OUT=site/opera-hf
DEST="$OUT/fonts/soehne"
IMAGES="$OUT/images"

mkdir -p "$DEST" "$IMAGES/icons/arrows" "$IMAGES/svg" "$IMAGES/logo"

echo "› compiling header-footer.css..."
"$SASS" --load-path="$NEXT/src/scss" --style=compressed --no-source-map \
  tools/opera-hf/export.scss /tmp/hic-hf-export.css 2>/dev/null
# Drop the sass BOM and repoint the font URLs onto this site's prefix.
sed '1s/^\xEF\xBB\xBF//; s|/assets/fonts/soehne/|/html-in-canvas/opera-hf/fonts/soehne/|g' \
  /tmp/hic-hf-export.css > "$OUT/header-footer.css"

echo "› rendering header-footer.html..."
node tools/opera-hf/render-hf.mjs "$NEXT" > /tmp/hic-hf-export.html
# Keep "Next" href="/" (next.opera.com root); only rewrite asset URLs and the
# self link.
sed -e 's|/assets/images/|/html-in-canvas/opera-hf/images/|g' \
    -e 's|href="https://next.opera.com/html-in-canvas/"|href="/html-in-canvas/"|g' \
    /tmp/hic-hf-export.html > "$OUT/header-footer.html"

echo "› copying fonts and images..."
cp "$NEXT/src/fonts/soehne/"*.woff2 "$DEST/"
cp "$NEXT/src/images/icons/arrows/right-clean.svg" "$IMAGES/icons/arrows/"
cp "$NEXT/src/images/svg/arrow-down--new-dark.svg" "$NEXT/src/images/svg/arrow-down-white--new.svg" "$IMAGES/svg/"
cp "$NEXT/src/images/logo/opera-logo-text-flat-2026.module.svg" \
   "$NEXT/src/images/logo/opera-logo-text-flat-2026-darkmode.module.svg" "$IMAGES/logo/"

echo "› regenerating tabscape wheel (animated canvas)"
# Copy wheel TS sources verbatim, transpile to browser ESM, .js the imports.
cp "$NEXT/src/ts/components/TabscapeWheel/TabscapeWheel.ts" \
   "$NEXT/src/ts/components/TabscapeWheel/WheelGeometry.ts" tools/opera-hf/wheel/
"$TSC" --target es2020 --module esnext --moduleResolution node --lib es2020,dom \
  --skipLibCheck --strict --outDir "$OUT/wheel" \
  tools/opera-hf/wheel/TabscapeWheel.ts \
  tools/opera-hf/wheel/WheelGeometry.ts \
  tools/opera-hf/wheel/tabscape-wheel.ts
# tsc keeps extensionless relative imports; append .js. Use temp + mv (not
# `sed -i ''`, which is BSD-only and fails on GNU/Linux).
for f in "$OUT/wheel"/*.js; do
  sed -e "s|from './WheelGeometry'|from './WheelGeometry.js'|g" \
      -e "s|from './TabscapeWheel'|from './TabscapeWheel.js'|g" "$f" > "$f.tmp" &&
    mv -f "$f.tmp" "$f"
done

rm -f /tmp/hic-hf-export.css /tmp/hic-hf-export.html
echo "✓ site/opera-hf/ regenerated from $NEXT"
echo "  next: bash tools/build-site.sh && node tools/serve.mjs"
