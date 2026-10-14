# Install Asset History on your Nosdesk 1.1.0 server

This package keeps the interface in a plugin. The accompanying custom server extension is required because stock Nosdesk 1.1.0 cannot expose audit history to a plugin. Access is restricted to workspace administrators. Your existing Asset Sublists plugin remains installed and its storage is reused.

Transfer nosdesk-asset-history.zip to the **Nosdesk Ubuntu server** as ~/nosdesk-asset-history.zip. Copy only the commands inside each code block, without the Markdown fence characters.

## 1. Extract and patch your existing build source

Use the source directory that you already built for the nested Assets sidebar. The installer preserves Navbar and sublist page files. It refuses a different upstream commit or custom edits to files that this extension needs to replace.

```bash
cd ~ || exit 1
python3 -m zipfile -e nosdesk-asset-history.zip .
test -d "$HOME/nosdesk-source-assets-1.1.0/.git" || exit 1
python3 ~/nosdesk-asset-history/apply.py ~/nosdesk-source-assets-1.1.0 --check
python3 ~/nosdesk-asset-history/apply.py ~/nosdesk-source-assets-1.1.0
```

If the source directory is missing or the installer reports a conflict, stop and retain its output. Do not reset custom files or reapply the old 1.0.13 extension.

## 2. Compile and verify against a disposable PostgreSQL 18 database

The Windows development environment has no Rust/Docker runtime. Frontend, plugin, guarded installer and embedded PostgreSQL checks have passed locally; the compiled server and HTTP integration tests still need this step. It uses a separate Docker project, a temporary test database, no published ports, no live volumes and no production .env file.

```bash
bash ~/nosdesk-asset-history/verify-server.sh ~/nosdesk-source-assets-1.1.0
```

This compiles server tests and may take considerably longer than the previous frontend-only build. Compilation concurrency is limited to two jobs per Rust stage. **Continue only after it reports that the server tests passed.** The temporary test containers/database are removed automatically.

## 3. Build the combined server image

```bash
docker build \
  --file ~/nosdesk-asset-history/Dockerfile.history \
  --target runtime \
  --build-arg NOSDESK_VERSION=1.1.0 \
  --tag nosdesk-local:1.1.0-history \
  ~/nosdesk-source-assets-1.1.0
```

This includes the existing custom Assets sidebar plus the history API and new migration. It retains the official production build stages rather than a debug/dev-mode image.

## 4. Back up and start the new image

The new migration creates indexes, four audit triggers and a capture-start timestamp. It does not backfill missing historical data. Index creation can delay the first startup on a large audit log. This is why the app is stopped after building and before backing up/deploying.

```bash
cd ~/nosdesk || exit 1
bash <<'BASH'
set -euo pipefail
umask 077
HISTORY_BACKUP="$HOME/nosdesk-history-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$HISTORY_BACKUP"
cp -p compose.yaml compose.override.yaml compose.assets.yaml "$HISTORY_BACKUP/"
if test -f .env; then cp -p .env "$HISTORY_BACKUP/"; fi
printf '%s\n' "$HISTORY_BACKUP" > "$HOME/.nosdesk-history-backup-path"
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml stop nosdesk
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml exec -T postgres \
  pg_dump -U nosdesk -d nosdesk -Fc > "$HISTORY_BACKUP/nosdesk.dump"
test -s "$HISTORY_BACKUP/nosdesk.dump"
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml exec -T postgres \
  pg_restore --list < "$HISTORY_BACKUP/nosdesk.dump" > "$HISTORY_BACKUP/restore-list.txt"
sha256sum "$HISTORY_BACKUP/nosdesk.dump" > "$HISTORY_BACKUP/SHA256SUMS"
cat > compose.history.yaml <<'YAML'
services:
  nosdesk:
    image: nosdesk-local:1.1.0-history
YAML
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml config --images
printf '\nBackup: %s\n' "$HISTORY_BACKUP"
BASH
```

Check the image output contains nosdesk-local:1.1.0-history, postgres:18-bookworm and redis:8-alpine, then start:

```bash
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml up -d --no-deps nosdesk
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml ps
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml logs --tail 80 nosdesk
```

Wait for healthy status and check readiness using the same /health endpoint already used on your server:

```bash
curl --fail http://127.0.0.1:8080/health
```

Preserve compose.override.yaml; it carries your PostgreSQL 18 volume/mount. Use all four -f files for subsequent operations to keep the history image selected. Do not run compose down -v against your live project.

## 5. Sign and install the History plugin

Run after the custom server is healthy. Stock Nosdesk rejects the new asset:history:read capability, so the plugin cannot be installed before the server extension.

```bash
cd ~/nosdesk || exit 1
docker cp ~/nosdesk-asset-history/plugin/payload nosdesk-nosdesk-1:/tmp/asset-history-payload
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml exec -T nosdesk \
  nosdesk-cli plugin sign /tmp/asset-history-payload --local --out /tmp/asset-history-1.0.0.zip
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml exec -T nosdesk \
  nosdesk-cli plugin verify /tmp/asset-history-1.0.0.zip
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml -f compose.history.yaml exec -T nosdesk \
  nosdesk-cli plugin install /tmp/asset-history-1.0.0.zip
```

Stop on errors. Signing refuses an existing ZIP; use a fresh output filename when repeating. Enable **Asset History** in your workspace's plugin administration, then refresh with Ctrl+Shift+R. CLI installation targets the bootstrap workspace, matching this deployment.

## 6. Verify the behavior

Open an asset as a workspace administrator. The **Asset history** panel should show retained saved changes. Make a small reversible edit, save, then refresh history. Confirm the prior/new value and recorded author. Change its sublist assignment and confirm **Sublist assignment** appears.

To inspect category creation, renaming/moving if available, or attribute-checkbox changes, select **Include global category configuration changes** and apply the scope. These are clearly labelled shared category changes, not individual edits to the selected asset. The separate **Asset history** page under Plugins also accepts a deleted asset ID.

Further checks should cover loans, lifecycle, stock, disposal and group/ticket associations. The new related-table capture begins at deployment; it cannot recreate earlier gaps. Normal saved changes are captured without any open history panel.

## Roll back the application

First disable Asset History in plugin administration, then return to the previous custom Assets image:

```bash
cd ~/nosdesk || exit 1
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml up -d --no-deps nosdesk
```

This changes the application image only. The history migration remains in the database and continues auditing its additional tables. If that capture itself causes an issue, a migration rollback requires its down.sql plus removal of the matching migration tracking entry, or restoration from the verified backup. Retain the logs and use a deliberate rollback procedure; do not casually restore over current data. Existing audit records are not erased by the supplied down.sql.
