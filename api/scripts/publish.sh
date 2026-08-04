#!/usr/bin/env bash
# Publishes both Lambda zip payloads: api/publish and api/publish-reminders.
#
# Native AOT needs a Linux host with clang, so it only runs in CI (ubuntu-24.04-arm).
# On any other host this falls back to a self-contained non-AOT build, which
# produces the same `bootstrap` executable and deploys identically, just with a
# slower cold start. Pass AOT=true to force it.
set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${AOT:-}" = "true" ] || { [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "aarch64" ]; }; then
  AOT_FLAG=true
else
  AOT_FLAG=false
fi

echo "Publishing linux-arm64 (PublishAot=$AOT_FLAG)"

publish() {
  local project="$1" out="$2"
  rm -rf "$out"
  # AOT trims implicitly; the fallback has to ask for it, and the build is already
  # warning-free so nothing gets trimmed away that is needed at runtime.
  dotnet publish "$project" \
    -c Release \
    -r linux-arm64 \
    --self-contained true \
    -p:PublishAot=$AOT_FLAG \
    -p:PublishTrimmed=true \
    -o "$out"

  # provided.al2023 executes a file named exactly "bootstrap".
  test -x "$out/bootstrap" || { echo "bootstrap missing from $out" >&2; exit 1; }
  echo "  $out ($(du -sh "$out" | cut -f1))"
}

publish "$API_DIR/src/Budget.Api/Budget.Api.csproj" "$API_DIR/publish"
publish "$API_DIR/src/Budget.Reminders/Budget.Reminders.csproj" "$API_DIR/publish-reminders"
