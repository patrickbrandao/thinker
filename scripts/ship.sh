#!/usr/bin/env bash
# Ships the current work to production in one step (ADR 0005):
#
#   1. commits any pending change with the given message;
#   2. bumps packages/thinker to the next patch (or minor/major) version and
#      writes docs/releases/X.Y.Z.md from the commit subjects since the last tag;
#   3. lands everything on main: a direct push, or, when branch protection
#      rejects it, a PR that is squash-merged right away (auto-merge if checks
#      are required);
#   4. tags the landed commit vX.Y.Z and pushes the tag. The Release workflow
#      then publishes tmsoftbrasil/thinker:latest and the GitHub release.
#
# Usage: scripts/ship.sh "<conventional commit message>" [patch|minor|major]
set -euo pipefail

msg=${1:?usage: scripts/ship.sh "<conventional commit message>" [patch|minor|major]}
bump=${2:-patch}
cd "$(git rev-parse --show-toplevel)"

branch=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin main --tags

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "$msg"
fi
git rebase -q origin/main

last=$(git describe --tags --abbrev=0 --match 'v[0-9]*' origin/main 2>/dev/null || true)
npm version "$bump" --no-git-tag-version --workspace packages/thinker >/dev/null
ver=$(node -p "require('./packages/thinker/package.json').version")

notes="docs/releases/$ver.md"
{
  echo "# Thinker $ver"
  echo
  echo '```bash'
  echo "docker pull tmsoftbrasil/thinker:$ver"
  echo '```'
  echo
  echo "## Mudanças"
  echo
  git log --no-merges --format='- %s' ${last:+"$last"..}HEAD | grep -v '^- chore(release)' || echo "- $msg"
} > "$notes"

git add -A
git commit -q -m "chore(release): version $ver"

if git push -q origin HEAD:refs/heads/main 2>/dev/null; then
  landed=$(git rev-parse HEAD)
else
  # main is protected: go through a PR and merge it at once.
  pr_branch="ship/v$ver"
  git push -q origin "HEAD:refs/heads/$pr_branch"
  gh pr create --base main --head "$pr_branch" --title "$msg" \
    --body "Shipped by scripts/ship.sh as v$ver." >/dev/null
  gh pr merge "$pr_branch" --squash --delete-branch 2>/dev/null \
    || gh pr merge "$pr_branch" --squash --delete-branch --auto
  for _ in $(seq 120); do
    [ "$(gh pr view "$pr_branch" --json state -q .state)" = MERGED ] && break
    sleep 15
  done
  [ "$(gh pr view "$pr_branch" --json state -q .state)" = MERGED ] \
    || { echo "PR for v$ver did not merge in 30 minutes" >&2; exit 1; }
  git fetch -q origin main
  landed=$(git rev-parse origin/main)
fi

git tag "v$ver" "$landed"
git push -q origin "refs/tags/v$ver"

if [ "$branch" = main ]; then
  git fetch -q origin main
  git reset -q --hard origin/main
fi

echo "Shipped v$ver ($landed). Release: https://github.com/patrickbrandao/thinker/actions/workflows/release.yml"
