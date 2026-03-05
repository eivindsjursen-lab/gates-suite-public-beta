#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT_DIR/packages/cache-health-gate"
TEMPLATE_DIR="$ROOT_DIR/examples/cache-health-gate-pilot-bundle"

if [[ ! -f "$PKG_DIR/action.yml" ]]; then
  echo "Missing $PKG_DIR/action.yml" >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "Missing $PKG_DIR/dist/ (run pnpm build first)" >&2
  exit 1
fi

if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "Missing pilot bundle templates: $TEMPLATE_DIR" >&2
  exit 1
fi

if ! command -v sha256sum >/dev/null 2>&1; then
  echo "Missing 'sha256sum' command" >&2
  exit 1
fi

OUT_DIR="${1:-$ROOT_DIR/.pilot-bundles}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMMIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
COMMIT_SHORT="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
BUNDLE_NAME="cache-health-gate-pilot-${TIMESTAMP}-${COMMIT_SHORT}"
STAGE_DIR="$OUT_DIR/$BUNDLE_NAME"
ZIP_PATH="$OUT_DIR/${BUNDLE_NAME}.zip"
SUMS_PATH="$OUT_DIR/${BUNDLE_NAME}.sha256"

mkdir -p "$OUT_DIR"
rm -rf "$STAGE_DIR" "$ZIP_PATH" "$SUMS_PATH"
mkdir -p "$STAGE_DIR"

cp "$PKG_DIR/action.yml" "$STAGE_DIR/action.yml"
cp -a "$PKG_DIR/dist" "$STAGE_DIR/dist"
cp "$TEMPLATE_DIR/README-pilot.md" "$STAGE_DIR/README-pilot.md"
cp "$TEMPLATE_DIR/WORKFLOW-node.yml" "$STAGE_DIR/WORKFLOW-node.yml"
cp "$TEMPLATE_DIR/WORKFLOW-python.yml" "$STAGE_DIR/WORKFLOW-python.yml"
cp "$TEMPLATE_DIR/ROLLBACK.md" "$STAGE_DIR/ROLLBACK.md"
cp "$TEMPLATE_DIR/PERMISSIONS.md" "$STAGE_DIR/PERMISSIONS.md"
cp "$TEMPLATE_DIR/LICENSE.txt" "$STAGE_DIR/LICENSE.txt"

cat > "$STAGE_DIR/BUNDLE-METADATA.txt" <<EOF
Cache Health Gate Private Alpha Pilot Bundle

Built at (UTC): $TIMESTAMP
Source commit: $COMMIT_SHA
Source commit (short): $COMMIT_SHORT
Action entrypoint: dist/action.cjs
Bundle purpose: Assisted private alpha evaluation (dist-only)
EOF

(
  cd "$STAGE_DIR"
  sha256sum \
    action.yml \
    BUNDLE-METADATA.txt \
    LICENSE.txt \
    PERMISSIONS.md \
    README-pilot.md \
    ROLLBACK.md \
    WORKFLOW-node.yml \
    WORKFLOW-python.yml \
    dist/* \
    > SHA256SUMS.txt
)

if command -v zip >/dev/null 2>&1; then
  (
    cd "$OUT_DIR"
    zip -qr "$(basename "$ZIP_PATH")" "$BUNDLE_NAME"
  )
elif command -v python3 >/dev/null 2>&1; then
  python3 - <<PY
import pathlib
import zipfile

out_dir = pathlib.Path(r"$OUT_DIR")
stage_dir = pathlib.Path(r"$STAGE_DIR")
zip_path = pathlib.Path(r"$ZIP_PATH")

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(stage_dir.rglob("*")):
        if path.is_file():
            zf.write(path, path.relative_to(out_dir))
PY
else
  echo "Missing 'zip' and 'python3' (need one to build a zip bundle)" >&2
  exit 1
fi

sha256sum "$ZIP_PATH" > "$SUMS_PATH"

echo "Built pilot bundle:"
echo "  ZIP:  $ZIP_PATH"
echo "  SHA:  $SUMS_PATH"
echo "  SRC:  $COMMIT_SHA"
