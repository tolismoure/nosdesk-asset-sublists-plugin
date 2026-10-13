# Asset Sublists 2.0.0 for Nosdesk 1.1.0

This package contains a supported sandbox plugin and a separate core frontend extension. Install both for your requested sublists directly beneath Assets.

## Features

No custom categories are seeded. Create your own sublists and one level of subcategories. Each has independent checkbox selections for display columns, editable later. Empty selections show only the asset name. Classify saved assets in the plugin panel, or use the standalone page's asset picker. One category/subcategory assignment per asset is stored in plugin storage without editing asset records.

The frontend extension reads every accessible asset returned by the existing unpaginated service and asset-kind JSON schema properties. The standalone plugin API cannot enumerate asset-kind definitions: its checklist contains core fields and keys observed in accessible assets. Inaccessible inventory cannot be scanned. Structured values display as JSON; nested keys are not separate checkboxes. Attribute selection controls columns, not native asset forms or mandatory fields. Lists show at most 200 matches; search narrows the complete accessible set.

## Verified support and limitations

Inspected official v1.1.0 source, commit b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2:

- [SDK API](https://github.com/nosdesk/nosdesk/blob/v1.1.0/packages/plugin-sdk/src/types.ts): asynchronous assets.list and plugin storage get/set, mount/update/unmount contract.
- [Sandbox runtime](https://github.com/nosdesk/nosdesk/blob/v1.1.0/packages/plugin-runtime/src/runtime.ts): module lifecycle.
- [Slot registry](https://github.com/nosdesk/nosdesk/blob/v1.1.0/packages/core/src/types/pluginSlots.ts): asset.info.panel and nav.item are supported. There is no slot for children under the existing Assets item.
- [Navbar](https://github.com/nosdesk/nosdesk/blob/v1.1.0/frontend/src/components/Navbar.vue): supported nav.item contributions appear in Plugins. That standalone link remains available with the sidebar customization.
- [Bundled CLI](https://github.com/nosdesk/nosdesk/blob/v1.1.0/backend/src/bin/nosdesk_cli.rs): local signing, verification and installation. CLI installation targets the bootstrap workspace; other workspaces require their own supported installation flow.
- [Provisioning documentation](https://github.com/nosdesk/nosdesk/blob/v1.1.0/plugins/README.md): production plugins require signatures. The implemented bundled CLI supplements that document's separate signing-tool example.

Only asset:read and storage:plugin permissions are requested. No external requests or parent DOM access are used. Nesting under Assets is explicitly a core frontend customization outside the supported plugin API. Recheck it for future upgrades. Do not apply the old 1.0.13 replacement files. The manifest requires exactly Nosdesk 1.1.0; the plugin itself is version 2.0.0.

Plugin identity asset-categories and storage keys taxonomy-v1 / asset-ID-category-v1 are preserved for earlier data. Updating the same plugin retains its storage. New installations start empty. Workspace users with runtime plugin access can edit shared sublists; there is no added admin-only policy. Taxonomy storage has no conflict detection, so coordinate simultaneous edits. Uninstall requests storage preservation; retain database backups regardless.

## Installation on your Ubuntu Nosdesk server

Transfer the delivered archive to your Nosdesk server account as ~/nosdesk-1.1-asset-sublists.zip using your usual file transfer method. Run these commands on the server hosting Nosdesk.

### Extract, sign and install

```bash
cd ~ || exit 1
python3 -m zipfile -e nosdesk-1.1-asset-sublists.zip .
cd ~/nosdesk || exit 1
docker cp ~/nosdesk-1.1-asset-sublists/plugin/payload nosdesk-nosdesk-1:/tmp/asset-sublists-payload
docker compose exec -T nosdesk nosdesk-cli plugin sign /tmp/asset-sublists-payload --local --out /tmp/asset-sublists-2.0.0.zip
docker compose exec -T nosdesk nosdesk-cli plugin verify /tmp/asset-sublists-2.0.0.zip
docker compose exec -T nosdesk nosdesk-cli plugin install /tmp/asset-sublists-2.0.0.zip
```

Stop if any command fails. Signing refuses an existing output; use a fresh filename if repeating it. Enable Asset Sublists in your workspace's plugin administration area and refresh the browser. Check the new page under Plugins and the panel on a saved asset. Signing uses your instance's own key without exporting it. The supplied payload is unsigned; the resulting signed ZIP is the production installer.

### Add the nested Assets sidebar

Build in a separate source directory. Keep your running project's .env and PostgreSQL 18 override in ~/nosdesk. Requires Git, Docker and download access. This builds only the frontend and layers it onto the official 1.1.0 runtime image.

```bash
set -e
cd ~
git clone --branch v1.1.0 --depth 1 https://github.com/nosdesk/nosdesk.git nosdesk-source-assets-1.1.0
python3 ~/nosdesk-1.1-asset-sublists/frontend-extension/apply.py ~/nosdesk-source-assets-1.1.0
docker build --file ~/nosdesk-1.1-asset-sublists/Dockerfile.assets --tag nosdesk-local:1.1.0-assets ~/nosdesk-source-assets-1.1.0
cd ~/nosdesk
umask 077
ASSET_BACKUP="$HOME/nosdesk-assets-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ASSET_BACKUP"
cp -p compose.yaml compose.override.yaml "$ASSET_BACKUP/"
docker compose exec -T postgres pg_dump -U nosdesk -d nosdesk -Fc > "$ASSET_BACKUP/nosdesk.dump"
test -s "$ASSET_BACKUP/nosdesk.dump"
cat > compose.assets.yaml <<'YAML'
services:
  nosdesk:
    image: nosdesk-local:1.1.0-assets
YAML
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml config --images
```

Check that the output still includes postgres:18-bookworm before starting:

```bash
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml up -d --no-deps nosdesk
docker compose -f compose.yaml -f compose.override.yaml -f compose.assets.yaml ps
curl --fail http://127.0.0.1:8080/health
```

Wait for healthy status if the first health request is early. Preserve compose.override.yaml: it carries the PostgreSQL 18 volume and mount. Use all three -f files for subsequent application commands to keep the custom image selected.

Refresh the browser fully, expand Assets, and choose Create sublist. Enter a name and parent, select attributes, and create. Assign existing assets via their plugin panel. Expand/reopen Assets to refresh its links. The nested sidebar is available in the expanded desktop navigation; collapsed and mobile navigation retain the standard Assets link. The standalone Plugins page remains available.

Rollback the frontend using the original image, retaining database and plugin storage:

```bash
cd ~/nosdesk || exit 1
docker compose up -d --no-deps nosdesk
```

## Build and verification

From plugin/: run npm ci, npm run build, npm test. The supplied payload/bundle.js is self-contained ESM. Source, lockfile, tests and the guarded exact-source installer are included; node_modules is excluded.

Passed: four automated tests covering empty defaults, discovered checkboxes, creation, assignment saving, editing attributes, false/zero values, storage errors, context updates and unmount. Script/template compilation passed for the sidebar components and category page. APIs and CLI arguments were inspected against the official tag.

Not verified here: complete production frontend build, execution inside a live 1.1.0 sandbox, instance signing/install validation, and server deployment. The Docker build and CLI install perform those integration checks. Validate on your own instance before relying on the integration.

## Licensing

The plugin is MIT licensed. Included Nosdesk frontend replacements retain the upstream Business Source License 1.1 in frontend-extension/LICENSE.nosdesk; that license permits modifications and includes an additional use grant for internal use. This package does not relicense Nosdesk.
