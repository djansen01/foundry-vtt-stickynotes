#!/usr/bin/env bash
# Push this module to GitHub and cut the first release.
# Run from your own machine, where your GitHub credentials live.
set -euo pipefail

REMOTE="git@github.com:djansen01/foundry-vtt-stickynotes.git"   # swap to https:// if you prefer
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

VERSION=$(python3 -c "import json;print(json.load(open('module.json'))['version'])")

git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"
echo "==> pushing main to $(git remote get-url origin)"
git push -u origin main

echo "==> tagging v${VERSION}"
git tag -f "v${VERSION}"
git push origin "v${VERSION}"

cat <<EOF

Done. The Release workflow is building now — watch it at:
  https://github.com/djansen01/foundry-vtt-stickynotes/actions

Once it's green, share this manifest URL:
  https://github.com/djansen01/foundry-vtt-stickynotes/releases/latest/download/module.json
EOF
