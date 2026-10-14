#!/usr/bin/env bash
# Update the same verified plugin identity. This does not select a new app image.
set -Eeuo pipefail
umask 077
SUBLIST_REPO="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
SUBLIST_PROJECT="${NOSDESK_PROJECT_DIR:-$HOME/nosdesk}"
SUBLIST_PROJECT="$(cd -- "$SUBLIST_PROJECT" && pwd -P)"
SUBLIST_PAYLOAD="$SUBLIST_REPO/plugin/payload"
test -f "$SUBLIST_PAYLOAD/manifest.json"
SUBLIST_ARGS=(-f "$SUBLIST_PROJECT/compose.yaml")
# Retain deployment overrides, especially PostgreSQL 18 and the history backend.
for SUBLIST_FILE in compose.override.yaml compose.assets.yaml compose.history.yaml; do
  if test -f "$SUBLIST_PROJECT/$SUBLIST_FILE"; then SUBLIST_ARGS+=(-f "$SUBLIST_PROJECT/$SUBLIST_FILE"); fi
done
cd -- "$SUBLIST_PROJECT"
sublist_compose() { docker compose --project-directory "$SUBLIST_PROJECT" "${SUBLIST_ARGS[@]}" "$@"; }
SUBLIST_CONTAINER="$(sublist_compose ps -q nosdesk)"
[[ "$SUBLIST_CONTAINER" =~ ^[0-9a-f]{12,64}$ ]]
SUBLIST_TEMP="$(sublist_compose exec -T nosdesk mktemp -d /tmp/asset-sublists.XXXXXX)"
[[ "$SUBLIST_TEMP" =~ ^/tmp/asset-sublists\.[A-Za-z0-9]+$ ]]
# Docker copy may preserve unreadable operator modes; the pinned runtime is UID 1001.
docker cp "$SUBLIST_PAYLOAD" "$SUBLIST_CONTAINER:$SUBLIST_TEMP/payload"
sublist_compose exec -T --user 0 nosdesk chown -R 1001:1001 "$SUBLIST_TEMP"
sublist_compose exec -T nosdesk nosdesk-cli plugin sign "$SUBLIST_TEMP/payload" --local --out "$SUBLIST_TEMP/asset-sublists.zip"
sublist_compose exec -T nosdesk nosdesk-cli plugin verify "$SUBLIST_TEMP/asset-sublists.zip"
sublist_compose exec -T nosdesk nosdesk-cli plugin install "$SUBLIST_TEMP/asset-sublists.zip"
printf '\nAsset Sublists installed. Enable it if necessary and hard-refresh Nosdesk.\n'
