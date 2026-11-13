#!/usr/bin/env bash
# Merge the newest upstream nightly tag into the `rad` fork branch and run the checks.
# Usage: scripts/rad-merge-nightly.sh [tag]
# It never pushes, builds or restarts. See docs/operations/rad-fork-deploy.md.
set -euo pipefail
export LC_ALL=C

cd "$(git rev-parse --show-toplevel)"

[ "$(git branch --show-current)" = "rad" ] || { echo "Check out rad first."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "The worktree has changes. Commit or stash them first."; exit 1; }

git fetch upstream --tags --quiet
TAG="${1:-$(git tag -l 'v*-nightly.*' --sort=-v:refname | head -1)}"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "Tag $TAG not found."; exit 1; }

if git merge-base --is-ancestor "$TAG" HEAD; then
  echo "rad already contains $TAG. Nothing to do."
  exit 0
fi

BASE="$(git merge-base HEAD "$TAG")"
echo "Merging $TAG: $(git rev-list --count --no-merges "$BASE..$TAG") upstream commits."

# Files that both sides changed since the last common nightly. Review these first.
BOTH="$(comm -12 <(git diff --name-only "$BASE" HEAD | sort) <(git diff --name-only "$BASE" "$TAG" | sort))"

if ! git merge --no-ff -m "chore: merge upstream nightly ${TAG#v}" "$TAG"; then
  echo
  echo "Merge conflicts. Resolve them, commit, then run the checks with:"
  echo "  GIT_CONFIG_GLOBAL=/dev/null vp run check:changed $TAG"
  git diff --name-only --diff-filter=U
  exit 1
fi

DUPS="$(find apps/server/src/persistence/Migrations -maxdepth 1 -name '[0-9]*_*.ts' ! -name '*.test.ts' -printf '%f\n' \
  | cut -d_ -f1 | sort | uniq -d)"
if [ -n "$DUPS" ]; then
  echo "Duplicate migration numbers: $DUPS. Renumber the rad migration before you go on."
  exit 1
fi

vp i

# Against the tag, check:changed sees exactly the rad changes, so it picks the tests for our
# features. The global git config on dev machines sets core.hooksPath, which breaks git tests.
set +e
GIT_CONFIG_GLOBAL=/dev/null vp run check:changed "$TAG"
CHECKS=$?
set -e

echo
echo "== Report"
echo "Merged:  $TAG into rad ($(git rev-parse --short HEAD)), not pushed."
echo "Changed on both sides:"
if [ -n "$BOTH" ]; then echo "$BOTH" | sed 's/^/  /'; else echo "  none"; fi
if [ "$CHECKS" -eq 0 ]; then
  echo "Checks:  pass"
else
  echo "Checks:  FAIL (exit $CHECKS). Fix the failures, then run the check again:"
  echo "  GIT_CONFIG_GLOBAL=/dev/null vp run check:changed $TAG"
fi
exit "$CHECKS"
