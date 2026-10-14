# Asset History 1.0.0 for Nosdesk 1.1.0

See the [main project](../README.md), [permissions guide](../docs/PERMISSIONS.md) and [verification ledger](../docs/VERIFICATION.md).

A read-only history plugin and the scoped custom host support it needs. The interface uses the supported asset.info.panel and nav.item extension points. Standard Nosdesk 1.1.0 has no audit-history reader in its plugin API, so installing the plugin alone is insufficient.

Start with the one-command guide in [INSTALL.md](INSTALL.md). The automatic installer runs verification, backup, deployment and local plugin signing; manage.sh handles the Compose overrides for later commands. Installation shows a bar for completed steps and an elapsed-time heartbeat every ten seconds during active work, including builds with no recent output. This source is published alongside the sublists extension. Installation and instance signing are operator-run actions; cloning the repository does not deploy a server.

## Features

- Asset History panel and a separate history page under Plugins.
- Timestamp, recorded author, operation and old/new field values.
- Main asset details and nested custom attributes, with distinct missing/null/false/zero values.
- Related loans, lifecycle, stock usage/counts, attachment metadata, disposal and group/ticket membership records.
- Asset Sublists category/subcategory assignments, including historical names when a retained taxonomy snapshot resolves them.
- Optional shared category history: creation, stored names/parent changes and selected attribute checkboxes. This records saved configuration changes; it does not add rename/delete operations to the existing sublists interface.
- Server-side UTC date range, cursor pagination, search/action filters over loaded records, and selectable JSON copying of the loaded filtered records.
- Retained deleted-asset history when a main audit record still establishes workspace ownership.

The plugin performs no writes to assets, storage or collections and requests no network permission. History recording remains transactional on the server even when no history panel is open.

## Included source support

The custom assets.history reader requires an active, consented asset:history:read plugin grant **and** the user's workspace administration and existing audit role/scope authority. Admin/owner membership alone does not replace upstream audit authorization. Technician/member access is deliberately denied in this first version.

Queries are tenant-scoped, explicitly check workspace IDs, support deletion and bind pagination cursors to their asset/date/category scope. Only the known Asset Sublists plugin's non-secret assignment key and optional taxonomy key are integrated. No generic audit query or unrestricted cross-plugin storage reader is exposed.

The migration adds missing audit capture for asset_disposals, asset_group_assignments, asset_directory_memberships and ticket_assets, along with lookup indexes and a capture-start marker. It reuses the existing main-assets audit rather than duplicating it. Newly captured relationship/disposal details begin at deployment, without historical backfill.

The guarded installer requires official v1.1.0 commit b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2. It retains your existing custom Assets Navbar and sublist page. The exact previous delivered history-handler hash is accepted for the test-fixture correction. Other conflicting edits to a required replacement stop installation before any source file is written. It handles normal Windows/Linux line-ending differences and refuses symlink targets.

## Verification

Passed locally:

- 14 plugin tests, including execution of the compiled production bundle, nested differences, category edits/moves/labels, date scope, pagination, failures, asset switching and unmount.
- 31 bridge/service/sandbox tests covering consent, validation, authenticated routing, HTTP errors, presence flags and large audit IDs.
- 8 SQL tests using PostgreSQL 18.6 in PGlite 0.5.9: the delivered query, migration and pinned upstream trigger run on a representative partitioned schema. They cover isolation, secrets, unchanged child asset IDs, cascading deletion, historical category names, paging, missing context and migration rollback.
- 5 guarded-installer tests, including the exact prior-package upgrade and rejection of unrelated edits.
- Complete Nosdesk production frontend build and type check with the history API extension.

The 58 feature/source tests above passed. The automatic installer adds 12 passing preflight/readiness tests; one symlink-creation test is skipped on Windows. Nine progress checks passed, covering elapsed-time output, completed-step percentages, quiet-build activity updates, cleanup, and preservation of the original failure status. Shell syntax validation also passed. They do not replace server compilation or HTTP/database integration against the complete Nosdesk schema. Ten Rust tests are included. The first server run completed release compilation and passed nine tests; the remaining test seeded a supposed secret via an upsert that preserves the existing non-secret flag. Its fixture now explicitly sets and asserts the secret flag using fixture SQL, without changing production code or weakening the secret-exclusion assertion. The corrected ten-test suite still needs to pass on the server. This Windows environment has no Rust, Docker or installed WSL runtime. verify-server.sh builds the separate history-tests image with all upstream unit-test fixtures, caches test compilation, and runs them in a disposable PostgreSQL 18 Docker project before deployment. The production builder stages remain unchanged so a previous completed build can be reused. The reported deployment completed local signing/install, readiness and all ten full-schema server tests. Browser acceptance of each new revision remains an operator check; see ../docs/VERIFICATION.md.

## Limits

- Only retained, successfully captured saved changes can be shown. Existing gaps and pruned records cannot be recreated.
- Audit retention uses positive AUDIT_LOG_RETENTION_DAYS, default 540 days; pruning is by monthly partition. Displayed metadata describes policy, not an exact cutoff guarantee.
- Category-wide changes are explicitly labelled global and enabled separately from individual assignment changes.
- Category labels come from retained state at the assignment time; missing snapshots leave stored IDs unresolved. Current names are not substituted as historical names.
- Recorded actor UUIDs are stable; displayed actor names are current lookups. Background actions may lack a person UUID and show Unknown/system.
- Deleted file contents are not retained in metadata audit records. Shared native group/model/kind definitions are not copied as an edit to every associated asset.
- History depends on the upstream audit context/triggers. Unscoped custom writes fail rather than silently omit history. Privileged trigger suppression, database maintenance and retention remain outside a guarantee of tamper-proof evidence.
- Preserving the Asset Sublists plugin's database identity preserves its history mapping; deleting/recreating that identity can leave earlier rows unresolved.
- Export shows only currently loaded filtered rows. The sandbox does not permit arbitrary downloads, so the plugin provides selectable JSON to copy.
- Future Nosdesk upgrades require checking this custom host extension again. The manifest intentionally requires exactly host 1.1.0; custom host API minor becomes 1.1.0 while plugin API major remains 1.

## Development

From plugin/: npm ci, npm test, npm run build.

From tests/sql/: npm ci, node --test history.test.mjs. These tests create in-memory databases and do not contact a server.

For the source installer: python3 -m unittest discover -s tests -p test_installer.py.

After applying the patch to the official source, run the three frontend assetHistory*.spec.ts files with its Vitest runner. Run the backend handlers::asset_history::tests through the supplied disposable verification project; never point the upstream test harness at a live database.

Backend implementation notes and baseline evidence are under core-extension/backend/notes; that notes directory is not applied to Nosdesk source.

## Licensing

The independent plugin is MIT licensed; see plugin/LICENSE. Nosdesk source replacements, derived host support and the pinned upstream trigger fixture retain Nosdesk's Business Source License 1.1; see LICENSE.nosdesk. This package does not relicense Nosdesk.
