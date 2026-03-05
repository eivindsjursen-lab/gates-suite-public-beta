#!/usr/bin/env bash
set -euo pipefail

# Release script for gates-suite actions.
# Usage: ./scripts/release.sh <tag>
# Example: ./scripts/release.sh cache-health-gate/v1.0.0
#
# Validates:
#   1. Clean working tree
#   2. Tag format matches an action package
#   3. dist/ is up to date for the targeted package
#   4. On main branch
# Then creates and pushes the tag.

# Intentionally locked for first release wave. Expand after real-world feedback.
VALID_PREFIXES=(
  "cache-health-gate"
)

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <tag>"
  echo "Example: $0 cache-health-gate/v1.0.0"
  exit 1
fi

TAG="$1"

# Extract prefix and version
if [[ ! "$TAG" =~ ^([a-z-]+)/v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "ERROR: Tag must match pattern: <action>/v<major>.<minor>.<patch>"
  echo "Example: cache-health-gate/v1.0.0"
  exit 1
fi

PREFIX="${BASH_REMATCH[1]}"
VERSION="${BASH_REMATCH[2]}"
MAJOR="${VERSION%%.*}"

# Validate prefix
VALID=false
for p in "${VALID_PREFIXES[@]}"; do
  if [[ "$PREFIX" == "$p" ]]; then
    VALID=true
    break
  fi
done

if [[ "$VALID" != "true" ]]; then
  echo "ERROR: Unknown action prefix: $PREFIX"
  echo "Enabled release prefixes right now: ${VALID_PREFIXES[*]}"
  exit 1
fi

# Must be on main
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "ERROR: Must be on main branch (currently on: $BRANCH)"
  exit 1
fi

# Clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is dirty. Commit or stash changes first."
  git status --short
  exit 1
fi

# Verify dist
echo "Verifying dist for packages/$PREFIX ..."
node scripts/check-dist.js --package "$PREFIX"

# Create tags
echo ""
echo "Creating tag: $TAG"
git tag -a "$TAG" -m "Release $TAG"

FLOATING_TAG="${PREFIX}/v${MAJOR}"
echo "Updating floating tag: $FLOATING_TAG"
git tag -fa "$FLOATING_TAG" -m "Release $TAG (floating major)"

echo ""
echo "Tags created locally. Push with:"
echo "  git push origin $TAG"
echo "  git push origin $FLOATING_TAG --force"
