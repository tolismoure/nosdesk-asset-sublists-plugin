# Asset History backend extension

Target: official Nosdesk v1.1.0, commit `b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2`. Source replacements retain the upstream Business Source License terms. This is a custom core bridge and migration, not an API supplied by unmodified Nosdesk.

The plugin remains the viewer. `GET /api/plugins/{uuid}/assets/{asset_id}/history` reads the authoritative PostgreSQL audit records. Every page requires workspace Admin (or Owner), the upstream audit-read role/scope policy, and an active plugin with consented `asset:history:read`. This initially means the normal platform-admin session in an administered workspace. An ordinary technician, member or audit reviewer without workspace administration is denied. A permission on the plugin alone does not authorize its user.

Queries run inside `TenantConn`; explicit audit workspace equality and snapshot workspace guards also prevent disclosures when the backend is run with a privileged database credential. Deleted assets are accessible only if their main asset audit record remains in that same workspace. Unknown or foreign IDs return 404. Cursors bind workspace, asset, integrated plugin identity, date range and the category option. Page sizes are 1–200 (default 50), newest first with `(occurred_at,id)` keyset pagination. `since` is inclusive and `until` exclusive; absence of these filters means all retained history, rather than the old admin endpoint's seven-day default.

## Included records

- `assets`: creation, updates and deletion; main fields and the whole custom `attributes` object.
- `asset_loans`, `asset_lifecycle_events`, `asset_usage_log`, `asset_audits`, `asset_media`: existing related row audits.
- `asset_disposals`, `asset_group_assignments`, `asset_directory_memberships`, `ticket_assets`: new transactional audit triggers, including cascade deletions.
- `asset-categories` plugin storage: only the non-secret `asset-{id}-category-v1` assignment key, and optionally its non-secret `taxonomy-v1` configuration. Other plugin names/IDs, settings, secret values and unrelated asset keys are excluded. Both snapshots must remain in the allowed scope; malformed administrator SQL converting a row to another type or secret fails closed.

Each row returns the stable audit ID as a string, table, entity ID, operation, time, actor UUID, current resolved actor name when available, correlation ID, full allowed before/after snapshots, and top-level field differences. Presence flags distinguish an absent property from explicit JSON null. Nested differences remain available from the full JSON snapshots. Plugin storage rows are projected to their value only, excluding storage bookkeeping. Category configuration rows are marked `category_global`, so creating a sublist or changing its field checkboxes is not presented as a direct edit to the selected asset.

Assignment labels resolve from the latest retained taxonomy audit snapshot at the assignment's `(occurred_at,id)`, through a bounded lateral lookup. Later renames cannot relabel an earlier assignment. A missing/pruned/deleted taxonomy snapshot leaves the saved ID unresolved. Assignment values are `{category,subcategory}`, matching the existing Asset Sublists plugin. Neither author names nor historical category names are inferred from today's viewer or current taxonomy. Actor names are explicitly current name lookups; the source record stores its stable actor UUID.

The additional capture boundary is recorded once by the migration in `asset_history_capture_info`. Its timestamp says when the four new table triggers became available; it is not a backfill. The table contains deployment metadata only and grants the app role SELECT. Four partial audit indexes support related-asset and plugin storage lookups across retained partitions.

## Context review and limitations

Source review confirmed native asset groups, lifecycle/disposal, directory membership and ticket link HTTP mutations run through `TenantConn`. Interactive and scheduled Microsoft Graph directory sync explicitly pin a workspace with `elevate_session_role`; its membership helpers reuse that connection. Added triggers reuse upstream `audit_log_trigger`, including its strict missing-workspace guard and actor/correlation attribution. No caller may turn that guard off to make a write succeed. The included database test checks both normal relation writes/cascade attribution and a missing-context failure.

This does not prove every integration/import/operator SQL path against a live deployment. A direct or custom write with no proper context must fail. Privileged cross-workspace maintenance/purge paths inherit the upstream audit trigger's context requirements; the bridge rejects a snapshot carrying another workspace ID. Normal background actions with no user UUID are displayed honestly as unattributed system/unknown activity.

Capture excludes unsaved changes, deleted file bytes, already-pruned events and previously uncaptured related rows. Shared definitions such as renaming a native group, manufacturer, kind schema or model are not duplicated as a change on every associated asset; membership changes and actual saved asset row changes are included. Audit updates can contain multiple rows from one transaction and are not deduplicated by correlation ID. Retention metadata mirrors positive `AUDIT_LOG_RETENTION_DAYS`, default 540; monthly partition pruning is policy, not an exact per-row cutoff. These are transactional records, not tamper-proof evidence against a privileged database administrator. Uninstall with preserved sublist identity keeps mappings; removing and recreating its database plugin row can leave older plugin IDs unresolved.

## Checks

Ten Rust tests are included in `handlers::asset_history::tests`: null/false/zero/absence, bounded/scoped cursors, range validation, deleted ownership and pagination, relation/cascade actor attribution, narrow cross-plugin storage and historical rename labels, active/consented gates, missing context, malformed storage and role/scope denial.

They require a disposable PostgreSQL 18 database through the upstream test harness. They have not been compiled or run in this local Windows environment, which has no Cargo or PostgreSQL installation. Run the parent package's verification workflow; a plugin bundle test alone cannot verify this backend.

The `notes` subtree is documentation and baseline metadata, not source to copy into the application. Required replacements and their exact upstream SHA-256 values are in `baselines.json`. New application files are `src/handlers/asset_history.rs`, `src/handlers/asset_history_query.sql`, and the migration's `up.sql`/`down.sql`.
