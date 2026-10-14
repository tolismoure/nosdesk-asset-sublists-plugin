# Saved-sublist display update for Nosdesk 1.1.0

See the [main installation guide](../../docs/INSTALLATION.md#saved-list-display-update). Release archives include the canonical page and plugin payload; a Git checkout resolves them from the repository.

Saved categories and subcategories now open directly to the asset table. The attribute checklist appears only after choosing Edit columns, and closes on Save, Cancel or navigation. The full new-sublist setup appears only on Create sublist. Asset Sublists 2.0.1 registers only its standalone Plugins page; individual asset pages no longer show the Asset sublist panel. Assign assets from Plugins -> Asset sublists using its asset picker and category/subcategory controls.

This update keeps plugin identity asset-categories and storage keys unchanged. It updates the same plugin so existing categories, column choices, assignments and history linkage are retained. It does not register an individual-asset assignment panel.

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

The installer requires the existing source ~/nosdesk-source-assets-1.1.0 and four Compose files under ~/nosdesk. It accepts only the known previous sublist-page hash or this updated file. Other edits stop it. It builds only the frontend and layers it on the exact currently running history-enabled image; no Rust backend compilation is needed. It backs up the original source page and compose.history.yaml under ~/nosdesk-ui-backups, preserves the existing configuration while changing its image reference, checks application/database/Redis readiness, and locally signs/installs the plugin. The progress display counts four completed steps and updates elapsed time every ten seconds.

A failed deployment attempts to restart the exact previous image. If plugin installation fails after readiness, the healthy frontend remains running; rerunning install.sh can retry using cached frontend layers. Logs are in the displayed backup folder. This installation has not been run on your server by Codex.

Use all four original Compose files for later maintenance. compose.history.yaml will contain the new image tag, which includes the existing history backend plus the UI update.

## Verification and source

Full frontend production build and Vue/TypeScript check passed with both the Assets sidebar and Asset History extension present. Four existing plugin tests passed. Installer shell syntax, embedded Python syntax, and preservation of extra Compose settings were verified locally. Docker deployment and live browser behavior still require the server installation.

AssetCategoriesView.vue contains the single updated frontend page; apply.py guards its installation. payload contains the unsigned plugin installer inputs. plugin-source includes the editable plugin source and build/test files. Dockerfile.ui modifies only /app/public in the captured runtime image. Nosdesk-derived UI source retains its Business Source License 1.1 (LICENSE.nosdesk); the independent plugin is MIT licensed (PLUGIN-LICENSE).
