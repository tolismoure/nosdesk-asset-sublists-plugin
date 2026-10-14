# Nosdesk Asset Sublists and Asset History

User-created asset categories and subcategories for **Nosdesk 1.1.0**, with per-list display columns and an optional audited history viewer.

## What is included

- **Asset Sublists 2.0.1:** a signed sandbox plugin. Create your own lists, select display attributes, and classify assets from **Plugins → Asset sublists**. No sample categories are seeded and no sublist panel is added to individual asset pages.
- **Assets sidebar extension:** lists directly beneath Assets, plus a category/subcategory filter and asset table. Saved lists open in browsing mode; **Edit columns** opens the checklist, and Save or Cancel closes it.
- **Asset History 1.0.0:** a read-only plugin plus the scoped backend/SDK support it requires. It reads retained asset and related changes, including sublist assignments and optional shared category configuration changes.
- **Frontend-only updater:** installs the saved-list display changes on an existing history-enabled deployment while retaining its exact backend image. No Rust rebuild is required for this updater.

## Compatibility and API boundary

All components target official Nosdesk **v1.1.0**, commit **b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2**. The supported plugin API can render standalone navigation pages and asset panels, read accessible assets, and use permission-gated plugin storage. It cannot insert children into the existing Assets navigation item or read server audit history.

Those two features are explicitly **custom host extensions**. Installing either plugin alone does not provide the associated host customization. Future Nosdesk upgrades require reviewing these patches against the new source. See [architecture and supported extension points](docs/ARCHITECTURE.md).

## Start here

| Task | Guide |
| --- | --- |
| Install plugins and the sidebar | [Installation](docs/INSTALLATION.md) |
| Apply the saved-list UI update to an existing history deployment | [Installation: display update](docs/INSTALLATION.md#saved-list-display-update) |
| Create lists, choose columns and assign assets | [User guide](docs/USER-GUIDE.md) |
| Understand history permissions | [Permissions](docs/PERMISSIONS.md) |
| Understand storage and historical records | [Data model](docs/DATA-MODEL.md) |
| Upgrade or recover | [Upgrades and rollback](docs/UPGRADES.md) |
| Diagnose errors or a quiet build | [Troubleshooting](docs/TROUBLESHOOTING.md) |
| Build, test and package changes | [Development](docs/DEVELOPMENT.md) |
| Review verification evidence and remaining limits | [Verification](docs/VERIFICATION.md) |

## Repository layout

~~~text
plugin/                         Asset Sublists source, tests and unsigned payload
frontend-extension/             Guarded sidebar and saved-list source replacements
asset-history/                  History plugin, scoped host API, migration and tests
updates/sublist-display/        Frontend-only upgrade scripts
scripts/                        Plugin-only installation helper
tools/                          Release packaging
.github/workflows/              Automated source and integration checks
docs/                           Operator, user and developer documentation
~~~

The payload directories contain **unsigned installer inputs**. Sign them with your instance's supported CLI before installation. Local signing uses the instance's private key in its database; do not commit a private key or a signed instance installer to this public repository.

## Important limits

Display columns do not change native asset forms, required fields or stored asset values. Lists render at most 200 matching assets; search narrows the accessible inventory. Shared taxonomy writes are last-writer-wins. History covers only retained, successfully captured saved changes: older gaps, pruned records and deleted file contents cannot be recreated.

History requires workspace Admin/Owner **and** platform audit authority **and** an approved plugin grant. A workspace administrator whose platform role is user does not meet the audit gate. [Permissions](docs/PERMISSIONS.md) explains the distinction and the wider scope of Audit Reviewer access.

## Licensing

The independent plugin code is MIT licensed: [Asset Sublists](plugin/LICENSE) and [Asset History](asset-history/plugin/LICENSE). Nosdesk-derived frontend/backend replacements and fixtures retain the upstream Business Source License 1.1: [frontend license](frontend-extension/LICENSE.nosdesk) and [history host license](asset-history/LICENSE.nosdesk). This repository does not relicense Nosdesk; review the applicable files before redistribution or use.
