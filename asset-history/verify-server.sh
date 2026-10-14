#!/usr/bin/env bash
# Disposable test project. No production database, volumes, .env or ports.
set -euo pipefail
HISTORY_PACKAGE_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
HISTORY_SOURCE_DIR="${1:-$HOME/nosdesk-source-assets-1.1.0}"
export HISTORY_PACKAGE_DIR HISTORY_SOURCE_DIR
python3 "$HISTORY_PACKAGE_DIR/apply.py" "$HISTORY_SOURCE_DIR" --check
HISTORY_TEST_PROJECT="nosdesk-history-verification-$(date +%s)-$$"
test_compose() {
  docker compose --project-directory "$HISTORY_PACKAGE_DIR" --env-file /dev/null -p "$HISTORY_TEST_PROJECT" -f "$HISTORY_PACKAGE_DIR/compose.verify.yaml" "$@"
}
cleanup() { test_compose down --volumes >/dev/null 2>&1 || true; }
trap cleanup EXIT
test_compose build history-tests
test_compose up -d --wait history-db
test_compose run --rm history-tests
printf '\nServer history tests passed in a disposable PostgreSQL 18 environment.\n'
