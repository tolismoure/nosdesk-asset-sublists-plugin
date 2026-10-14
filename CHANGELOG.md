# Changelog

## Asset Sublists 2.1.0 — 2026-10-14

- Add a compact per-asset manual assignment card in the right-hand rail.
- Link categories/subcategories to a native asset group during creation or column editing.
- Combine manual and live group membership without duplicates, preserving existing storage and history.
- Update the frontend installer to validate and back up every managed file before applying the extension.



## Loan user column — 2026-10-14

- Add a selectable Loan user column to the host Assets sublist view, resolving the current unreturned loan to its borrower name.
- Limit concurrent reads to four and only fetch displayed rows when selected; distinguish unavailable reads and unknown people from no current loan.
- Preserve earlier delivery hashes for the frontend-only updater.

## Asset Sublists 2.0.1

- Saved categories/subcategories open to their asset table.
- Attribute setup is hidden until Edit columns; Save, Cancel and navigation close it.
- The complete new-list setup is limited to Create sublist.
- Removed individual-asset sublist panel registration; classification remains on the standalone page.
- Added a frontend-only updater retaining the installed history backend and existing storage.
- Added operator/developer documentation, explanatory source comments and guarded prior-delivery compatibility.

## Asset History 1.0.0

- Read-only asset/related history, sublist assignment history and opt-in shared taxonomy changes.
- Scoped permission-gated host reader, validated SDK bridge, four missing audit triggers, indexes and capture metadata.
- UTC date bounds, cursor paging, loaded-row filters and selectable JSON copying.
- Private backup/deployment helper, isolated PostgreSQL 18 verification and progress heartbeat.
- Corrected test-image fixture inclusion and actual-secret test seeding before successful ten-test server verification.

## Asset Sublists 2.0.0

- Initial Nosdesk 1.1.0 plugin and custom Assets sidebar.
- User-created categories, one child level and independent selected display columns.
- Stable asset-categories identity and taxonomy-v1/asset-ID-category-v1 storage.
