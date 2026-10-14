# Verification evidence and limits

## Local source checks

- Asset Sublists: four automated DOM/model tests covering empty defaults, fields, assignments, creation, column editing, false/zero values, storage failures and lifecycle/context cleanup.
- Asset History: fourteen plugin model/DOM/production-bundle tests and thirty-one host bridge/service/sandbox tests.
- PostgreSQL/PGlite: eight tests running the delivered SQL/migration and pinned upstream trigger on a representative PostgreSQL 18 schema, including isolation, history names, secret transitions, cascades, paging, missing context and rollback.
- Guarded history installer: five tests, including exact prior-delivery upgrades and rejection of unrelated edits.
- Preflight/readiness: twelve checks passed; symlink creation was skipped on the Windows validation host.
- Progress: nine checks passed; Windows shell tests allow a short native-process startup interval, while POSIX exercises immediate cleanup.
- Complete frontend production build and Vue/TypeScript check passed with the Assets sidebar and history bridge together.
- Display-updater shell syntax, embedded Python syntax and preservation of extra Compose settings were checked.

CI re-runs the relevant checked-in source tests and builds. Generated payload reproducibility is checked against committed bundles. CI results remain the current evidence for the published revision; the historical totals above describe the implementation work and are not a substitute for checking the latest workflow result.

## Reported server verification

The deployment transcript for the supported self-hosted setup showed:

- Successful Rust release compilation and all ten handlers::asset_history::tests passing against a disposable PostgreSQL 18 database with the complete Nosdesk migrations.
- Successful production frontend/runtime build.
- Verified private database backup before deployment.
- New-server readiness with database and Redis healthy.
- Valid local signature and trusted installation of asset-history v1.0.0.

The initial fixture-only failure and missing test files were fixed before that successful run. Those failures were not bypassed. The app was not updated while the isolated tests were failing.

## Still requires instance acceptance

The saved-list cleanup/panel-removal updater was built/type-checked locally; its live deployment and browser behavior were not confirmed in the supplied transcript. Signing/installed identity, workspace-specific permissions, native forms, existing customizations and real browser sandbox behavior must be checked on the intended deployment.

Use an accessible test asset: classify it from the standalone page, verify its table/columns, make a reversible native field change, and confirm retained old/new history with an authorized account. Check shared category changes separately. No test result establishes complete historical coverage, resistance to privileged tampering, or support for a future Nosdesk version.
