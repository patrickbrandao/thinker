#!/bin/bash
# Regenerates the models[] of sim/wwz/opencode.yaml from the white-wizard
# example (real opencode.ai catalogs), keeping the header above `models:`.
set -euo pipefail
WWZ=${WWZ_REPO:-$HOME/Projects/white-wizard}
F="$(cd "$(dirname "$0")" && pwd)/opencode.yaml"
{ awk '/^models:/{exit} {print}' "$F"; awk '/^models:/,0' "$WWZ/examples/opencode-completo/config.yaml"; } > "$F.tmp"
mv "$F.tmp" "$F"
"$WWZ/bin/wwz" validate -config "$F"
