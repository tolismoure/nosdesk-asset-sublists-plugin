# Installation

These instructions target self-hosted Nosdesk 1.1.0 and Docker Compose. Do not use the 1.0.13 replacement files on 1.1.0. The source checkout must be official commit b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2. Preserve your existing environment secrets, upload/database volumes and PostgreSQL 18 override.

## Choose the deployment path

| Existing installation | Path |
| --- | --- |
| Only need categories under Plugins | Install Asset Sublists plugin only |
| Stock 1.1.0, need nested Assets navigation | Apply frontend-extension and build Dockerfile.assets |
| Assets sidebar already present, need history | Run asset-history/install.sh after preparing the source |
| History backend already present, need the saved-list cleanup/panel removal | Use the frontend-only saved-list display update |

Plugin installation targets the CLI's bootstrap workspace. Install in other workspaces through their supported workspace installation flow; do not copy database rows between workspaces.

## Prepare installer inputs

From a developer checkout:

~~~bash
cd plugin
npm ci
npm test
npm run build
cd ..
python3 tools/package-release.py
~~~

Packages appear under dist. They contain source and unsigned payload inputs, not a trusted production plugin zip. Transfer the relevant package to the server and extract it there. Use YOUR_NOSDESK_HOST as a placeholder for your host; credentials are not embedded in this repository.

## Install Asset Sublists plugin only

Extract the sublists package, then from its root run:

~~~bash
bash scripts/install-sublists.sh
~~~

The helper discovers the nosdesk container using the existing Compose files, creates a unique temporary directory, copies the unsigned payload, gives the image's app user access, then invokes supported local sign/verify/install commands. It includes optional compose.override.yaml, compose.assets.yaml and compose.history.yaml when present. It neither rebuilds nor replaces the running backend.

NOSDESK_PROJECT_DIR can override the default ~/nosdesk path. Enable Asset Sublists in Administration → Plugins if necessary and perform a hard browser refresh. The plugin name remains asset-categories, preserving storage on updates.

## Fresh nested Assets sidebar

Prepare a separate pinned source tree, keeping the live Compose project separate:

~~~bash
git clone --branch v1.1.0 --depth 1 https://github.com/nosdesk/nosdesk.git ~/nosdesk-source-assets-1.1.0
python3 frontend-extension/apply.py ~/nosdesk-source-assets-1.1.0 --check
python3 frontend-extension/apply.py ~/nosdesk-source-assets-1.1.0
docker build --file Dockerfile.assets --tag nosdesk-local:1.1.0-assets ~/nosdesk-source-assets-1.1.0
~~~

Dockerfile.assets defaults to the official 1.1.0 runtime and builds only the frontend. That default is appropriate for a stock backend. A custom/history backend must be retained instead: use the captured-image frontend-only updater below, or explicitly select a compatible base image when maintaining a custom build.

Back up the existing Compose configuration/database before changing an image reference. Add an image-only Compose override, retaining your PostgreSQL 18 volume override and uploads mount. Start only the nosdesk service with all required -f files. Check /readiness (JSON ready, db=ok, redis=ok), then enable the plugin and refresh the browser.

## Install Asset History

The history installer assumes the existing Assets deployment: ~/nosdesk-source-assets-1.1.0 plus compose.yaml, compose.override.yaml and compose.assets.yaml in ~/nosdesk. For a fresh combined source, apply the sidebar first and prepare that deployment before running the history installer.

From the extracted history package:

~~~bash
bash install.sh
~~~

Its ordered stages are source verification, disposable PostgreSQL 18 tests, production image build, private configuration/database backup, deployment/readiness, and local plugin signing/install. The app remains available during build/tests, and only the app stops for the backup/deployment. No production writes occur during its disposable test project.

The full history image builds Rust as well as frontend code. Initial release compilation can take substantial time and memory. Its test image includes upstream test fixtures and caches test compilation. Progress counts completed stages; the heartbeat is not a measured compiler percentage.

Wait for INSTALLATION COMPLETE, then refresh. See [Permissions](PERMISSIONS.md) before assuming a workspace admin can read history. If only the final plugin step failed after readiness:

~~~bash
bash install.sh --plugin-only
~~~

## Saved-list display update

Use dist/nosdesk-sublist-display-update.zip on an existing history-enabled deployment. Extract it into the server account's home and run:

~~~bash
python3 -m zipfile -e ~/nosdesk-sublist-display-update.zip ~
bash ~/nosdesk-sublist-display-update/install.sh
~~~

The updater checks the pinned source and known hashes for all managed frontend files, captures the exact running history image, builds the frontend, preserves compose.history.yaml while replacing its image reference, checks readiness, and signs/installs Asset Sublists 2.1.0. The Rust backend and migration binaries come from the captured runtime image; there is no Rust build in this path.

It closes the saved-list setup by default and removes the individual-asset sublist panel. Categories, selected columns, assignment keys and plugin identity remain unchanged. Choose Edit columns only when needed, and assign assets from the standalone page.

NOSDESK_PROJECT_DIR and NOSDESK_SOURCE_DIR can override the default project/source directories. Backups and logs are under ~/nosdesk-ui-backups. A failed deployment attempts to restore the prior configuration and exact image. If plugin installation fails after readiness, the new frontend remains healthy; rerun the updater to retry using cached frontend layers.

Wait for UPDATE COMPLETE, then refresh with Ctrl+Shift+R. The installer scripts are operator tools; no action occurs on a server merely by cloning this repository.
