# Saved-sublist display update for Nosdesk 1.1.0

See the [main installation guide](../../docs/INSTALLATION.md#saved-list-display-update). Release archives include the canonical page and plugin payload; a Git checkout resolves them from the repository.

Saved categories and subcategories now open directly to the asset table. The attribute checklist appears only after choosing Edit columns, and closes on Save, Cancel or navigation. The full new-sublist setup appears only on Create sublist. Asset Sublists 2.1.0 registers its standalone Plugins page. The accompanying host frontend renders a compact Asset sublist card in each asset’s right-hand rail, alongside Asset groups, for manual category/subcategory assignment.

This update keeps plugin identity asset-categories and storage keys unchanged. It updates the same plugin so existing categories, column choices, assignments and history linkage are retained. The card is a host frontend extension; no sandbox assignment panel is registered.

## Install on your existing server

Save nosdesk-sublist-display-update.zip into Windows Downloads. In Windows PowerShell:

~~~powershell
scp "$HOME\Downloads\nosdesk-sublist-display-update.zip" nosdesk@YOUR_NOSDESK_HOST:/home/nosdesk/nosdesk-sublist-display-update.zip
ssh nosdesk@YOUR_NOSDESK_HOST
~~~

At the Ubuntu prompt:

~~~bash
python3 -m zipfile -e "$HOME/nosdesk-sublist-display-update.zip" "$HOME" && bash "$HOME/nosdesk-sublist-display-update/install.sh"
~~~

Wait for UPDATE COMPLETE, then refresh Nosdesk with Ctrl+Shift+R.

The installer requires the existing source ~/nosdesk-source-assets-1.1.0 and four Compose files under ~/nosdesk. It validates every managed frontend file against the pinned upstream baseline or exact prior delivery hashes before writing anything. Other edits stop it. It builds only the frontend and layers it on the exact currently running history-enabled image; no Rust backend compilation is needed. It backs up all managed original source files and compose.history.yaml under ~/nosdesk-ui-backups, preserves the existing configuration while changing its image reference, checks application/database/Redis readiness, and locally signs/installs the plugin. The progress display counts four completed steps and updates elapsed time every ten seconds.

A failed deployment attempts to restart the exact previous image. If plugin installation fails after readiness, the healthy frontend remains running; rerunning install.sh can retry using cached frontend layers. Logs are in the displayed backup folder. This installation has not been run on your server by Codex.

Use all four original Compose files for later maintenance. compose.history.yaml will contain the new image tag, which includes the existing history backend plus the UI update.

## Verification and source

Full frontend production build and Vue/TypeScript check passed with both the Assets sidebar and Asset History extension present. Four existing plugin tests passed. Installer shell syntax, embedded Python syntax, and preservation of extra Compose settings were verified locally. Docker deployment and live browser behavior still require the server installation.

AssetCategoriesView.vue contains the single updated frontend page; apply.py guards its installation. payload contains the unsigned plugin installer inputs. plugin-source includes the editable plugin source and build/test files. Dockerfile.ui modifies only /app/public in the captured runtime image. Nosdesk-derived UI source retains its Business Source License 1.1 (LICENSE.nosdesk); the independent plugin is MIT licensed (PLUGIN-LICENSE).

Loan user is a selectable column in the Assets sublist view. It shows the current unreturned loan’s borrower name, not the asset’s primary user or the last historical borrower. No active loan displays —; failed reads display Unavailable. Use Refresh assets after a loan changes. The sandbox plugin API does not expose loans, so this column requires the accompanying frontend update.

This frontend update also adds Latest lifecycle entry, Latest lifecycle date (UTC), and Latest lifecycle author as selectable sortable columns. It reads existing lifecycle records; it adds no recording mechanism or backend migration.
