#!/usr/bin/env bash
# Build a Chrome Web Store-ready zip containing ONLY the files the extension ships.
# Excludes dev-only files (serve.js, docs/, .claude/, *.md, dist/).
set -e
cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/xtraclean-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  icons \
  popup \
  src/content.js \
  src/background.js \
  -x "*.DS_Store" >/dev/null

echo "Built $OUT"
echo "Contents:"
unzip -l "$OUT"
