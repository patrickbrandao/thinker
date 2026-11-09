#!/usr/bin/env bash
# Points the community deploy templates (deploy/ and Dockerfile.heroku) at the
# given minor image tag, e.g. `scripts/pin-deploy-image.sh 0.31` rewrites every
# `tmsoftbrasil/thinker:X.Y` (and its URL-encoded `thinker%3AX.Y` form, used by
# the Koyeb button) to `tmsoftbrasil/thinker:0.31`. scripts/ship.sh calls it
# for every release, so a one-click deploy never starts from a stale version.
#
# Usage: scripts/pin-deploy-image.sh <major.minor> [root]
set -euo pipefail

minor=${1:?usage: scripts/pin-deploy-image.sh <major.minor> [root]}
root=${2:-$(git rev-parse --show-toplevel)}
[[ "$minor" =~ ^[0-9]+\.[0-9]+$ ]] || { echo "not a major.minor tag: $minor" >&2; exit 1; }

files=()
while IFS= read -r f; do files+=("$f"); done < <(
  grep -rlE 'tmsoftbrasil(/|%2F)thinker(:|%3A)[0-9]+\.[0-9]+' "$root/deploy" "$root/Dockerfile.heroku" 2>/dev/null || true
)
[ ${#files[@]} -eq 0 ] && exit 0
MINOR="$minor" perl -pi -e '
  s{(tmsoftbrasil(?:/|%2F)thinker)(:|%3A)\d+\.\d+(?![\d.])}{$1$2$ENV{MINOR}}g
' "${files[@]}"
