#!/usr/bin/env bash
# Guided deployment for the user's existing Nosdesk 1.1.0 + Assets setup.
set -Eeuo pipefail
umask 077

HISTORY_PACKAGE_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
HISTORY_PROJECT_DIR="${HISTORY_PROJECT_DIR:-$HOME/nosdesk}"
HISTORY_SOURCE_DIR="${HISTORY_SOURCE_DIR:-$HOME/nosdesk-source-assets-1.1.0}"
HISTORY_IMAGE="nosdesk-local:1.1.0-history"
HISTORY_PLUGIN_ONLY=false
if [[ "${1:-}" == --plugin-only && $# == 1 ]]; then
  HISTORY_PLUGIN_ONLY=true
elif [[ $# != 0 ]]; then
  printf 'Usage: bash install.sh [--plugin-only]\n' >&2
  exit 2
fi
for HISTORY_COMMAND in docker python3 git flock tee mktemp sha256sum; do
  command -v "$HISTORY_COMMAND" >/dev/null || { printf 'Required command is missing: %s\n' "$HISTORY_COMMAND" >&2; exit 1; }
done
test -d "$HISTORY_PROJECT_DIR" || { printf 'Cannot find your Nosdesk folder: %s\n' "$HISTORY_PROJECT_DIR" >&2; exit 1; }
HISTORY_PROJECT_DIR="$(cd -- "$HISTORY_PROJECT_DIR" && pwd -P)"
cd -- "$HISTORY_PROJECT_DIR"
exec 9> "$HISTORY_PROJECT_DIR/.asset-history-install.lock"
flock -n 9 || { printf 'Another Asset History installation is already running.\n' >&2; exit 1; }
HISTORY_RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
HISTORY_BACKUP="$HOME/nosdesk-history-backups/$HISTORY_RUN"
mkdir -p "$HISTORY_BACKUP"
HISTORY_LOG="$HISTORY_BACKUP/install.log"
exec > >(tee -a "$HISTORY_LOG") 2>&1
HISTORY_STATE="$HISTORY_BACKUP/state.json"
HISTORY_STAGE=preflight
source "$HISTORY_PACKAGE_DIR/tools/install_progress.sh"
if [[ "$HISTORY_PLUGIN_ONLY" == true ]]; then HISTORY_PROGRESS_TOTAL=2; fi
trap 'history_progress_stop' EXIT
HISTORY_RECOVER=false
HISTORY_SERVER_READY=false
HISTORY_HISTORY_EXISTED=false
HISTORY_OLD_IMAGE_ID=''
HISTORY_OLD_IMAGE_REF=''
HISTORY_ROLLBACK_TAG="nosdesk-local:history-rollback-$HISTORY_RUN"
HISTORY_BASE_ARGS=(-f "$HISTORY_PROJECT_DIR/compose.yaml" -f "$HISTORY_PROJECT_DIR/compose.override.yaml" -f "$HISTORY_PROJECT_DIR/compose.assets.yaml")
HISTORY_OLD_ARGS=("${HISTORY_BASE_ARGS[@]}")
HISTORY_NEW_ARGS=("${HISTORY_BASE_ARGS[@]}" -f "$HISTORY_PROJECT_DIR/compose.history.yaml")
history_compose() { docker compose --project-directory "$HISTORY_PROJECT_DIR" "${HISTORY_NEW_ARGS[@]}" "$@"; }
old_compose() { docker compose --project-directory "$HISTORY_PROJECT_DIR" "${HISTORY_OLD_ARGS[@]}" "$@"; }
state_value() {
  python3 -c 'import json,sys; v=json.load(open(sys.argv[1]))[sys.argv[2]]; print(str(v).lower() if isinstance(v,bool) else v)' "$HISTORY_STATE" "$1"
}
write_override() {
  local destination="$1" image="$2" temporary
  temporary="$(mktemp "$HISTORY_PROJECT_DIR/.history-override.XXXXXX")"
  printf 'services:\n  nosdesk:\n    image: %s\n' "$image" > "$temporary"
  mv -f -- "$temporary" "$destination"
}
install_failed() {
  local code="$1" line="$2"
  trap - ERR INT TERM
  set +e
  history_progress_stop
  printf '\nInstallation stopped during %s (line %s).\nLog: %s\n' "$HISTORY_STAGE" "$line" "$HISTORY_LOG"
  if [[ "$HISTORY_RECOVER" == true ]]; then
    printf 'Restarting the previous application image…\n'
    if [[ "$HISTORY_HISTORY_EXISTED" == true ]]; then
      local restore_file
      restore_file="$(mktemp "$HISTORY_PROJECT_DIR/.history-restore.XXXXXX")"
      cp -p -- "$HISTORY_BACKUP/compose.history.yaml" "$restore_file"
      mv -f -- "$restore_file" "$HISTORY_PROJECT_DIR/compose.history.yaml"
    else
      rm -f -- "$HISTORY_PROJECT_DIR/compose.history.yaml"
    fi
    # A repeated install may have rebuilt the same tag as the old application.
    if [[ "$HISTORY_OLD_IMAGE_REF" == "$HISTORY_IMAGE" ]]; then
      docker image tag "$HISTORY_OLD_IMAGE_ID" "$HISTORY_IMAGE"
    fi
    write_override "$HISTORY_BACKUP/rollback.yaml" "$HISTORY_ROLLBACK_TAG"
    if docker compose --project-directory "$HISTORY_PROJECT_DIR" "${HISTORY_OLD_ARGS[@]}" -f "$HISTORY_BACKUP/rollback.yaml" up -d --no-deps nosdesk; then
      printf 'Previous image restarted. Completed database additions may remain.\n'
    else
      printf 'Automatic application restart failed; retain this log for recovery.\n'
    fi
    printf 'Backup: %s\n' "$HISTORY_BACKUP"
  elif [[ "$HISTORY_SERVER_READY" == true ]]; then
    printf 'The healthy server extension remains running. Retry only the plugin step with:\n'
    printf 'bash %q --plugin-only\n' "$HISTORY_PACKAGE_DIR/install.sh"
  fi
  exit "$code"
}
trap 'install_failed "$?" "$LINENO"' ERR
trap 'install_failed 130 "$LINENO"' INT
trap 'install_failed 143 "$LINENO"' TERM

printf '\nAsset History setup for Nosdesk 1.1.0\nLog: %s\n' "$HISTORY_LOG"
history_progress_start 0 "Checking your existing setup"
HISTORY_CHECK_ARGS=(--project "$HISTORY_PROJECT_DIR" --state "$HISTORY_STATE")
if [[ "$HISTORY_PLUGIN_ONLY" == true ]]; then HISTORY_CHECK_ARGS+=(--plugin-only); fi
python3 "$HISTORY_PACKAGE_DIR/tools/install_checks.py" "${HISTORY_CHECK_ARGS[@]}"
HISTORY_OLD_IMAGE_ID="$(state_value old_image_id)"
HISTORY_OLD_IMAGE_REF="$(state_value old_image_ref)"
HISTORY_HISTORY_EXISTED="$(state_value history_file_existed)"
if [[ "$HISTORY_HISTORY_EXISTED" == true ]]; then HISTORY_OLD_ARGS+=(-f "$HISTORY_PROJECT_DIR/compose.history.yaml"); fi
history_progress_stop

wait_ready() {
  local expected="$1" deadline=$((SECONDS + 600))
  printf 'Waiting for the application, database and Redis…\n'
  while (( SECONDS < deadline )); do
    if python3 "$HISTORY_PACKAGE_DIR/tools/install_checks.py" --project "$HISTORY_PROJECT_DIR" --check-ready --image-id "$expected" >/dev/null 2>&1; then
      printf 'The new server is ready.\n'
      return 0
    fi
    sleep 5
  done
  printf 'Readiness timed out. Recent application output follows:\n' >&2
  history_compose logs --tail 60 nosdesk || true
  return 1
}

if [[ "$HISTORY_PLUGIN_ONLY" == false ]]; then
  HISTORY_STAGE='source verification'
  history_progress_start 0 "Preparing Assets source"
  printf '\n[1/6] Preparing your existing Assets source…\n'
  test -d "$HISTORY_SOURCE_DIR/.git"
  python3 "$HISTORY_PACKAGE_DIR/apply.py" "$HISTORY_SOURCE_DIR" --check
  python3 "$HISTORY_PACKAGE_DIR/apply.py" "$HISTORY_SOURCE_DIR"
  history_progress_complete 1 "Assets source prepared"

  HISTORY_STAGE='isolated server tests'
  history_progress_start 1 "Building and testing the server"
  printf '\n[2/6] Building and testing against a disposable database…\n'
  bash "$HISTORY_PACKAGE_DIR/verify-server.sh" "$HISTORY_SOURCE_DIR"
  history_progress_complete 2 "Server tests passed"

  HISTORY_STAGE='production image build'
  history_progress_start 2 "Building the production image"
  printf '\n[3/6] Building the production image…\n'
  docker image tag "$HISTORY_OLD_IMAGE_ID" "$HISTORY_ROLLBACK_TAG"
  docker build --file "$HISTORY_PACKAGE_DIR/Dockerfile.history" --target runtime \
    --build-arg NOSDESK_VERSION=1.1.0 --tag "$HISTORY_IMAGE" "$HISTORY_SOURCE_DIR"
  HISTORY_NEW_IMAGE_ID="$(docker image inspect "$HISTORY_IMAGE" --format '{{.Id}}')"
  history_progress_complete 3 "Production image built"

  HISTORY_STAGE='backup'
  history_progress_start 3 "Backing up your database"
  printf '\n[4/6] Backing up configuration and the database…\n'
  for HISTORY_FILE in compose.yaml compose.override.yaml compose.assets.yaml; do
    cp -p -- "$HISTORY_PROJECT_DIR/$HISTORY_FILE" "$HISTORY_BACKUP/"
  done
  if [[ "$HISTORY_HISTORY_EXISTED" == true ]]; then cp -p -- "$HISTORY_PROJECT_DIR/compose.history.yaml" "$HISTORY_BACKUP/"; fi
  if test -f "$HISTORY_PROJECT_DIR/.env"; then cp -p -- "$HISTORY_PROJECT_DIR/.env" "$HISTORY_BACKUP/"; fi
  printf '%s\n' "$HISTORY_BACKUP" > "$HOME/.nosdesk-history-backup-path"
  HISTORY_RECOVER=true
  # Stop only the writer app for a consistent dump. PostgreSQL/Redis stay up.
  old_compose stop nosdesk
  old_compose exec -T postgres pg_dump -U nosdesk -d nosdesk -Fc > "$HISTORY_BACKUP/nosdesk.dump"
  test -s "$HISTORY_BACKUP/nosdesk.dump"
  old_compose exec -T postgres pg_restore --list < "$HISTORY_BACKUP/nosdesk.dump" > "$HISTORY_BACKUP/restore-list.txt"
  (cd "$HISTORY_BACKUP" && sha256sum nosdesk.dump > SHA256SUMS && sha256sum -c SHA256SUMS)
  history_progress_complete 4 "Backup verified"

  HISTORY_STAGE='server deployment'
  history_progress_start 4 "Starting the server and checking readiness"
  printf '\n[5/6] Starting the history-enabled server…\n'
  write_override "$HISTORY_PROJECT_DIR/compose.history.yaml" "$HISTORY_IMAGE"
  history_compose up -d --no-deps nosdesk
  wait_ready "$HISTORY_NEW_IMAGE_ID"
  # Once ready, a plugin-only failure must not roll back the healthy host.
  HISTORY_RECOVER=false
  HISTORY_SERVER_READY=true
  history_progress_complete 5 "Server is ready"
else
  HISTORY_STAGE='installed server verification'
  history_progress_start 0 "Checking the installed server"
  python3 "$HISTORY_PACKAGE_DIR/tools/install_checks.py" --project "$HISTORY_PROJECT_DIR" --check-ready --image-id "$HISTORY_OLD_IMAGE_ID"
  HISTORY_SERVER_READY=true
  history_progress_complete 1 "Installed server is ready"
fi

HISTORY_STAGE='plugin signing and installation'
if [[ "$HISTORY_PLUGIN_ONLY" == true ]]; then
  history_progress_start 1 "Signing and installing Asset History"
else
  history_progress_start 5 "Signing and installing Asset History"
fi
printf '\n[%s/%s] Signing and installing Asset History…\n' "$HISTORY_PROGRESS_TOTAL" "$HISTORY_PROGRESS_TOTAL"
HISTORY_CONTAINER_ID="$(history_compose ps -q nosdesk)"
test -n "$HISTORY_CONTAINER_ID"
HISTORY_TEMP_DIR="$(history_compose exec -T nosdesk mktemp -d /tmp/asset-history.XXXXXX)"
[[ "$HISTORY_TEMP_DIR" =~ ^/tmp/asset-history\.[A-Za-z0-9]+$ ]]
docker cp "$HISTORY_PACKAGE_DIR/plugin/payload" "$HISTORY_CONTAINER_ID:$HISTORY_TEMP_DIR/payload"
# The image runs as UID 1001; Docker copy can otherwise leave root-owned 0600 files.
history_compose exec -T --user 0 nosdesk chown -R 1001:1001 "$HISTORY_TEMP_DIR"
history_compose exec -T nosdesk nosdesk-cli plugin sign "$HISTORY_TEMP_DIR/payload" --local --out "$HISTORY_TEMP_DIR/asset-history-1.0.0.zip"
history_compose exec -T nosdesk nosdesk-cli plugin verify "$HISTORY_TEMP_DIR/asset-history-1.0.0.zip"
history_compose exec -T nosdesk nosdesk-cli plugin install "$HISTORY_TEMP_DIR/asset-history-1.0.0.zip"
if ! docker cp "$HISTORY_CONTAINER_ID:$HISTORY_TEMP_DIR/asset-history-1.0.0.zip" "$HISTORY_BACKUP/signed-plugin.zip"; then
  printf 'Plugin installed; the optional signed archive copy could not be saved.\n'
fi
history_progress_complete "$HISTORY_PROGRESS_TOTAL" "Asset History installed"
printf '\nINSTALLATION COMPLETE\nSetup files and log: %s\n' "$HISTORY_BACKUP"
printf 'Refresh Nosdesk. Enable Asset History in plugin administration if it is disabled.\n'
printf 'Open an asset to view its history.\n'
