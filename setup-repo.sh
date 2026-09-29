#!/usr/bin/env bash
# One-time: personalise the package and push it to GitHub.
#
#   ./setup-repo.sh <github-username> "<Name for the copyright line>" [repo-name]
#
# Substitutes the placeholders, initialises git, and prints the remaining commands.
set -euo pipefail

USER_NAME="${1:-}"
COPYRIGHT="${2:-}"
REPO_NAME="${3:-foundry-vtt-stickynotes}"
if [[ -z "$USER_NAME" || -z "$COPYRIGHT" ]]; then
  echo "usage: ./setup-repo.sh <github-username> \"<Name for the copyright line>\" [repo-name]" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# NB: this script excludes itself below. Bash reads a script incrementally, so rewriting it
# mid-run shifts byte offsets and corrupts execution.
echo "==> substituting placeholders"
grep -rl 'djansen01\|Dave' . --exclude-dir=.git | while read -r f; do
  sed -i.bak "s|djansen01|${USER_NAME}|g; s|Dave|${COPYRIGHT}|g; s|foundry-vtt-stickynotes|${REPO_NAME}|g" "$f"
  rm -f "$f.bak"
  echo "    $f"
done

echo "==> stamping module.json urls"
python3 - "$USER_NAME" "$REPO_NAME" <<'PY'
import json, sys
user, name = sys.argv[1], sys.argv[2]
repo = f"https://github.com/{user}/{name}"
with open("module.json") as f:
    m = json.load(f)
m["url"] = repo
m["manifest"] = f"{repo}/releases/latest/download/module.json"
m["download"] = f"{repo}/releases/download/v{m['version']}/module.zip"
m["readme"] = f"{repo}/blob/main/README.md"
m["changelog"] = f"{repo}/blob/main/CHANGELOG.md"
m["bugs"] = f"{repo}/issues"
m["license"] = "MIT"
with open("module.json", "w") as f:
    json.dump(m, f, indent=2)
    f.write("\n")
print(json.dumps(m, indent=2))
PY

echo "==> sanity checks"
node --check scripts/core.js
node --check scripts/main.js
python3 -c "import json; json.load(open('module.json')); json.load(open('lang/en.json')); print('    manifest + lang ok')"

if [[ ! -d .git ]]; then
  echo "==> git init"
  git init -q -b main
  git add -A
  git -c user.email="you@example.com" -c user.name="$COPYRIGHT" commit -qm "Sticky Notes $(python3 -c "import json;print(json.load(open('module.json'))['version'])")"
fi

VERSION=$(python3 -c "import json;print(json.load(open('module.json'))['version'])")
cat <<EOF

==> done. Remaining steps:

  1. Create an empty repo on GitHub named  ${REPO_NAME}
     (no README, no licence — this folder already has them)

  2. Push:
       cd "$HERE"
       git remote add origin git@github.com:${USER_NAME}/${REPO_NAME}.git
       git push -u origin main

  3. Cut the first release:
       git tag v${VERSION} && git push origin v${VERSION}

     The Release workflow builds module.zip and publishes it.

  4. Share this manifest URL with your friend:
       https://github.com/${USER_NAME}/${REPO_NAME}/releases/latest/download/module.json

EOF
