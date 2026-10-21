#!/usr/bin/env bash
# Regenerate the shared Opera header/footer artifacts under site/opera-hf/
# from the next.opera.com repo (source of truth for the header & footer).
#
# Produces:
#   site/opera-hf/header-footer.css        compiled, self-contained header/footer CSS
#   site/opera-hf/header-footer.html       header + footer markup (next nunjucks macros)
#   site/opera-hf/fonts/                   Söhne font files
#   site/opera-hf/images/                  logos + svg icons referenced by the CSS/markup
#
# Usage: bash tools/opera-hf/update.sh [path-to-next-repo]
# (default: "$HOME/opcom/next" — only the SCSS + nunjucks templates are read,
#  nothing is written back into the next repo)
set -euo pipefail
cd "$(dirname "$0")/../.."

NEXT="${1:-$HOME/opcom/next}"
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
# Drop the utf-8 BOM sass may emit and repoint the font URLs from the next
# repo's /assets base onto this site's own /html-in-canvas/opera-hf/.
sed '1s/^\xEF\xBB\xBF//; s|/assets/fonts/soehne/|/html-in-canvas/opera-hf/fonts/soehne/|g' \
  /tmp/hic-hf-export.css > "$OUT/header-footer.css"

echo "› rendering header-footer.html..."
node tools/opera-hf/render-hf.mjs "$NEXT" > /tmp/hic-hf-export.html
sed -e 's|/assets/images/|/html-in-canvas/opera-hf/images/|g' \
    -e 's|href="/"|href="/html-in-canvas/"|g' \
    -e 's|href="https://next.opera.com/html-in-canvas/"|href="/html-in-canvas/"|g' \
    /tmp/hic-hf-export.html > "$OUT/header-footer.html"

echo "› copying fonts and images..."
cp "$NEXT/src/fonts/soehne/"*.woff2 "$DEST/"
cp "$NEXT/src/images/icons/arrows/right-clean.svg" "$IMAGES/icons/arrows/"
cp "$NEXT/src/images/svg/arrow-down--new-dark.svg" "$NEXT/src/images/svg/arrow-down-white--new.svg" "$IMAGES/svg/"
cp "$NEXT/src/images/logo/opera-logo-text-flat-2026.module.svg" \
   "$NEXT/src/images/logo/opera-logo-text-flat-2026-darkmode.module.svg" "$IMAGES/logo/"

echo "› regenerating tabscape wheel (animated canvas)"
# Keep the wheel TS source verbatim next to the tooling, then transpile it to
# browser ESM under site/opera-hf/wheel/. tsc does not rewrite import
# specifiers, so the extensionless './X' imports need '.js' appended.
cp "$NEXT/src/ts/components/TabscapeWheel/TabscapeWheel.ts" \
   "$NEXT/src/ts/components/TabscapeWheel/WheelGeometry.ts" tools/opera-hf/wheel/
"$TSC" --target es2020 --module esnext --moduleResolution node --lib es2020,dom \
  --skipLibCheck --strict --outDir "$OUT/wheel" \
  tools/opera-hf/wheel/TabscapeWheel.ts \
  tools/opera-hf/wheel/WheelGeometry.ts \
  tools/opera-hf/wheel/tabscape-wheel.ts
sed -i '' -e "s|from './WheelGeometry'|from './WheelGeometry.js'|g" \
          -e "s|from './TabscapeWheel'|from './TabscapeWheel.js'|g" "$OUT/wheel"/*.js

rm -f /tmp/hic-hf-export.css /tmp/hic-hf-export.html
echo "✓ site/opera-hf/ regenerated from $NEXT"
echo "  next: bash tools/build-site.sh && node tools/serve.mjs"
