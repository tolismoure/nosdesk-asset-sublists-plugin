#!/usr/bin/env bash
# Explicit operator-run handover; never invoked by the 1.1.0 installer.
set -Eeuo pipefail
umask 077
HERE="$(cd -- "$(dirname -- "$0")" && pwd -P)"
MANAGE="$HERE/../manage.sh"
if [[ "${1:-}" != --apply ]]; then
  printf 'Read-only disposal trigger inspection. Use --apply only immediately before the upstream upgrade.\n'
  bash "$MANAGE" exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$HERE/inspect-disposal-trigger.sql"
  exit 0
fi
BACKUP="$HOME/nosdesk-history-backups/disposal-handover-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
bash "$MANAGE" stop nosdesk
# Keep the app stopped: restarting 1.1.0 now would leave a disposal audit gap.
bash "$MANAGE" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP/database.sql"
test -s "$BACKUP/database.sql"
sha256sum "$BACKUP/database.sql" > "$BACKUP/SHA256SUMS"
bash "$MANAGE" exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$HERE/disposal-trigger-handover.sql"
printf 'Handover prepared. Application remains stopped. Backup: %s\n' "$BACKUP"
printf 'Proceed only with a reviewed upstream upgrade that installs its replacement trigger.\n'
