#!/usr/bin/env bash
# Publishes the Lambda zip payload into api/publish/.
#
# Native AOT needs a Linux host with clang, so it only runs in CI (ubuntu-24.04-arm).
# On any other host this falls back to a self-contained non-AOT build, which
# produces the same `bootstrap` executable and deploys identically, just with a
# slower cold start. Pass AOT=true to force it.
set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$API_DIR/publish"
PROJECT="$API_DIR/src/Budget.Api/Budget.Api.csproj"

if [ "${AOT:-}" = "true" ] || { [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "aarch64" ]; }; then
  AOT_FLAG=true
else
  AOT_FLAG=false
fi

echo "Publishing linux-arm64 (PublishAot=$AOT_FLAG)"

rm -rf "$OUT"
# AOT trims implicitly; the fallback has to ask for it, and the build is already
# warning-free so nothing gets trimmed away that is needed at runtime.
dotnet publish "$PROJECT" \
  -c Release \
  -r linux-arm64 \
  --self-contained true \
  -p:PublishAot=$AOT_FLAG \
  -p:PublishTrimmed=true \
  -o "$OUT"

# provided.al2023 executes a file named exactly "bootstrap".
test -x "$OUT/bootstrap" || { echo "bootstrap missing from $OUT" >&2; exit 1; }

echo "Published to $OUT ($(du -sh "$OUT" | cut -f1))"
