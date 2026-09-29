#!/usr/bin/env bash
set -euo pipefail

# Build a Chrome "Load unpacked" distribution from an explicit allow-list.
# Do not zip the project root: it contains development-only files and macOS
# metadata that must not ship to customers.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/manifest.json').version")"
PACKAGE_NAME="ARVION-BMT-Dashboard-${VERSION}"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/${PACKAGE_NAME}"
ZIP_PATH="${DIST_DIR}/${PACKAGE_NAME}.zip"

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/assets/brand" \
  "${STAGE_DIR}/src/background" \
  "${STAGE_DIR}/src/dashboard" \
  "${STAGE_DIR}/src/devtools" \
  "${STAGE_DIR}/src/popup"

copy_required() {
  local relative_path="$1"
  test -f "${ROOT_DIR}/${relative_path}" || {
    echo "Required extension file is missing: ${relative_path}" >&2
    exit 1
  }
  cp "${ROOT_DIR}/${relative_path}" "${STAGE_DIR}/${relative_path}"
}

for file in \
  manifest.json \
  rules.json \
  icon.png \
  view.html \
  assets/brand/arvion-system-roundel.png \
  src/background/background.js \
  src/dashboard/chart.js \
  src/dashboard/style.css \
  src/dashboard/view.js \
  src/devtools/devtools.html \
  src/devtools/devtools.js \
  src/popup/popup.html \
  src/popup/popup.js \
  src/popup/style.css
do
  copy_required "${file}"
done

rm -f "${ZIP_PATH}"
(
  cd "${DIST_DIR}"
  zip -X -r "${ZIP_PATH}" "${PACKAGE_NAME}" \
    -x '*/.DS_Store' -x '__MACOSX/*' >/dev/null
)

echo "Created: ${ZIP_PATH}"
echo "Load unpacked folder: ${STAGE_DIR}"
echo "Contents: $(find "${STAGE_DIR}" -type f | wc -l | tr -d ' ') files"
