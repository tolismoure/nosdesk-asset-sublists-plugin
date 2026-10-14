#!/usr/bin/env bash
set -euo pipefail
HISTORY_PROJECT_DIR="${HISTORY_PROJECT_DIR:-$HOME/nosdesk}"
HISTORY_PROJECT_DIR="$(cd -- "$HISTORY_PROJECT_DIR" && pwd -P)"
cd -- "$HISTORY_PROJECT_DIR"
exec docker compose --project-directory "$HISTORY_PROJECT_DIR" -f "$HISTORY_PROJECT_DIR/compose.yaml" \
  -f "$HISTORY_PROJECT_DIR/compose.override.yaml" \
  -f "$HISTORY_PROJECT_DIR/compose.assets.yaml" \
  -f "$HISTORY_PROJECT_DIR/compose.history.yaml" "$@"
