#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
HISTORY_PACKAGE_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
UI_PROJECT="${NOSDESK_PROJECT_DIR:-$HOME/nosdesk}"
UI_SOURCE="${NOSDESK_SOURCE_DIR:-$HOME/nosdesk-source-assets-1.1.0}"
UI_PROJECT="$(cd -- "$UI_PROJECT" && pwd -P)"
UI_PAYLOAD="$HISTORY_PACKAGE_DIR/payload"
if ! test -f "$UI_PAYLOAD/manifest.json"; then UI_PAYLOAD="$HISTORY_PACKAGE_DIR/../../plugin/payload"; fi
cd -- "$UI_PROJECT"
for UI_COMMAND in docker python3 git flock tee; do command -v "$UI_COMMAND" >/dev/null; done
exec 9> .asset-history-install.lock
flock -n 9 || { printf 'Another installation is running. Wait for it to finish.\n'; exit 1; }
test -f compose.history.yaml
UI_RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
UI_BACKUP="$HOME/nosdesk-ui-backups/$UI_RUN"
mkdir -p "$UI_BACKUP"
exec > >(tee -a "$UI_BACKUP/install.log") 2>&1
source "$HISTORY_PACKAGE_DIR/tools/install_progress.sh"
HISTORY_PROGRESS_TOTAL=4
trap history_progress_stop EXIT
UI_ARGS=(-f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml)
ui_compose() { docker compose --project-directory "$UI_PROJECT" "${UI_ARGS[@]}" "$@"; }
UI_RECOVER=false
UI_SERVER_READY=false
failed() {
  local result="$1"
  trap - ERR INT TERM
  set +e
  history_progress_stop
  printf '\nUpdate stopped. Log: %s/install.log\n' "$UI_BACKUP"
  if [[ "$UI_RECOVER" == true ]]; then
    local restored
    restored="$(mktemp "$UI_PROJECT/.sublist-ui-rollback.XXXXXX")"
    cp -p -- "$UI_BACKUP/compose.history.yaml" "$restored"
    mv -f -- "$restored" "$UI_PROJECT/compose.history.yaml"
    ui_compose -f "$UI_BACKUP/rollback.yaml" up -d --no-deps nosdesk || true
    printf 'Previous application restart attempted.\n'
  fi
  exit "$result"
}
trap 'failed "$?"' ERR
trap 'failed 130' INT
trap 'failed 143' TERM
history_progress_start 0 'Checking the existing installation'
UI_CONTAINER="$(ui_compose ps -q nosdesk)"
test -n "$UI_CONTAINER"
test "$(docker inspect "$UI_CONTAINER" --format '{{.State.Running}}')" = true
# Pin the actual running binary, not a mutable tag or the upstream default.
UI_OLD_IMAGE="$(docker inspect "$UI_CONTAINER" --format '{{.Image}}')"
UI_OLD_REF="$(docker inspect "$UI_CONTAINER" --format '{{.Config.Image}}')"
[[ "$UI_OLD_REF" == nosdesk-local:1.1.0-history* ]] || { printf 'STOP: expected your existing history-enabled image.\n'; exit 1; }
cp -p compose.history.yaml "$UI_BACKUP/compose.history.yaml"
printf 'services:\n  nosdesk:\n    image: %s\n' "$UI_OLD_IMAGE" > "$UI_BACKUP/rollback.yaml"
cp -p "$UI_SOURCE/frontend/src/views/AssetCategoriesView.vue" "$UI_BACKUP/AssetCategoriesView.before.vue"
python3 "$HISTORY_PACKAGE_DIR/apply.py" "$UI_SOURCE"
history_progress_complete 1 'Source prepared'
history_progress_start 1 'Building the frontend only'
UI_BASE="nosdesk-local:sublist-ui-base-$UI_RUN"
UI_IMAGE="nosdesk-local:1.1.0-history-sublists-$UI_RUN"
docker image tag "$UI_OLD_IMAGE" "$UI_BASE"
docker build --file "$HISTORY_PACKAGE_DIR/Dockerfile.ui" \
  --build-arg "NOSDESK_BASE_IMAGE=$UI_BASE" --build-arg "VITE_BUILD_SHA=sublist-ui-$UI_RUN" \
  --tag "$UI_IMAGE" "$UI_SOURCE"
UI_NEW_IMAGE="$(docker image inspect "$UI_IMAGE" --format '{{.Id}}')"
history_progress_complete 2 'Frontend image built'
history_progress_start 2 'Starting the updated application'
UI_OVERRIDE="$(mktemp "$UI_PROJECT/.sublist-ui-override.XXXXXX")"
python3 - "$UI_BACKUP/compose.history.yaml" "$UI_OVERRIDE" "$UI_OLD_REF" "$UI_IMAGE" <<'PY'
from pathlib import Path
import re, sys
original, destination, old, new = sys.argv[1:]
text = Path(original).read_text()
pattern = r'(?m)^(\s*image:\s*)(["\x27]?)' + re.escape(old) + r'\2(\s*(?:#.*)?)$'
updated, count = re.subn(pattern, lambda match: match[1] + match[2] + new + match[2] + match[3], text)
if count != 1:
    raise SystemExit('STOP: expected one current image line in compose.history.yaml; no deployment changed.')
Path(destination).write_text(updated)
PY
# Recovery becomes necessary only when live configuration is about to change.
UI_RECOVER=true
mv -f -- "$UI_OVERRIDE" "$UI_PROJECT/compose.history.yaml"
ui_compose up -d --no-deps nosdesk
UI_READY=false
UI_DEADLINE=$((SECONDS + 600))
while (( SECONDS < UI_DEADLINE )); do
  UI_CURRENT="$(ui_compose ps -q nosdesk)"
  if [[ -n "$UI_CURRENT" ]] && [[ "$(docker inspect "$UI_CURRENT" --format '{{.Image}}')" == "$UI_NEW_IMAGE" ]] && python3 - <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:8080/readiness', timeout=5) as response:
        data = json.load(response)
    sys.exit(0 if data.get('status') == 'ready' and data.get('checks', {}).get('db') == 'ok' and data.get('checks', {}).get('redis') == 'ok' else 1)
except Exception:
    sys.exit(1)
PY
  then UI_READY=true; break; fi
  sleep 5
done
[[ "$UI_READY" == true ]]
UI_RECOVER=false
UI_SERVER_READY=true
history_progress_complete 3 'Updated application is ready'
# Update the same plugin identity; do not recreate it or reset its storage.
history_progress_start 3 'Updating Asset Sublists plugin'
UI_CONTAINER="$(ui_compose ps -q nosdesk)"
UI_PLUGIN_TEMP="$(ui_compose exec -T nosdesk mktemp -d /tmp/sublist-display.XXXXXX)"
[[ "$UI_PLUGIN_TEMP" =~ ^/tmp/sublist-display\.[A-Za-z0-9]+$ ]]
docker cp "$UI_PAYLOAD" "$UI_CONTAINER:$UI_PLUGIN_TEMP/payload"
ui_compose exec -T --user 0 nosdesk chown -R 1001:1001 "$UI_PLUGIN_TEMP"
ui_compose exec -T nosdesk nosdesk-cli plugin sign "$UI_PLUGIN_TEMP/payload" --local --out "$UI_PLUGIN_TEMP/asset-sublists-2.0.1.zip"
ui_compose exec -T nosdesk nosdesk-cli plugin verify "$UI_PLUGIN_TEMP/asset-sublists-2.0.1.zip"
ui_compose exec -T nosdesk nosdesk-cli plugin install "$UI_PLUGIN_TEMP/asset-sublists-2.0.1.zip"
history_progress_complete 4 'Saved-sublist display and plugin updated'
printf '\nUPDATE COMPLETE. Refresh Nosdesk with Ctrl+Shift+R.\n'
printf 'Saved sublists show the asset table. Use Edit columns to change attributes.\n'
printf 'Asset pages no longer show Asset sublist controls. Assign assets from Plugins -> Asset sublists.\n'
printf 'Configuration backup and log: %s\n' "$UI_BACKUP"
