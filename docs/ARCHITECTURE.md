# Architecture and supported extension points

## Two independent layers

The sandbox plugins use Nosdesk's supported lifecycle and SDK. The host patches extend Nosdesk itself. Keep that distinction when installing, reviewing permissions or upgrading.

| Capability | Supported plugin API | Host customization |
| --- | --- | --- |
| Standalone page under Plugins | nav.item | Not required |
| Read accessible inventory | api.assets.list | Not required |
| Persist category definitions/assignments | api.storage.get/set with storage:plugin | Not required |
| Add list links under the existing Assets item | No such slot | Navbar + AssetCategoryNav |
| Enumerate declared asset-kind attribute schemas | Not exposed to the standalone plugin | Native assetKindsService in the list page |
| Read asset audit history | No stock history reader | Scoped assets.history bridge and backend route |
| Capture previously unaudited relationships | Not possible from browser events | Transactional database triggers |

The current Sublists manifest registers only the standalone page. Its reusable controller can accept an asset context for backward compatibility/testing, but it is not registered on individual asset pages. Asset History separately registers asset.info.panel and nav.item.

## Sublist read/write flow

~~~mermaid
flowchart LR
  Sidebar[Assets sidebar/list page] --> Storage[Approved plugin storage]
  Plugin[Standalone sandbox page] --> SDK[Permission-gated SDK]
  SDK --> Storage
  Inventory[Accessible assets and kind schemas] --> Sidebar
  Storage --> Taxonomy[Taxonomy and per-asset assignments]
  Taxonomy --> History[Existing plugin_data audit]
~~~

The list page reads taxonomy first, then inventory/kind schemas and per-asset assignment keys with bounded concurrency. Search and column selection are projections; native asset records are not rewritten. The route distinguishes creation from browsing. Draft columns are local until Save; Cancel or navigation closes the editor.

A taxonomy write re-reads and validates current storage, but this is not compare-and-swap. Concurrent writers can overwrite each other. The category IDs, plugin name and key names are persistence contracts, not presentation labels.

## History read/capture flow

~~~mermaid
flowchart LR
  Changes[Saved asset/relationship changes] --> Audit[Transactional audit_log]
  Audit --> Route[Authenticated scoped history route]
  Route --> Bridge[Validated SDK bridge]
  Bridge --> Viewer[Read-only sandbox viewer]
~~~

GET /api/plugins/{uuid}/assets/{asset_id}/history checks workspace administration, upstream audit role/scope, and the active consented plugin grant before every page. SQL explicitly filters workspace and allowed records even when an operator uses a database superuser. Deleted-asset ownership is established from retained main asset audit records.

The bounded page is materialized before lateral taxonomy lookup, limiting lookup work to at most limit+1 rows. Assignment names come from retained taxonomy state at the event time; missing state leaves IDs unresolved. Current names are never substituted as historical evidence.

The migration adds capture for asset_disposals, asset_group_assignments, asset_directory_memberships and ticket_assets, lookup indexes and a capture-start marker. Existing main-assets capture is reused. Recording does not depend on an open plugin page.

## Pinned source references

These implementation references were inspected at the supported tag:

- [Plugin SDK types](https://github.com/nosdesk/nosdesk/blob/v1.1.0/packages/plugin-sdk/src/types.ts)
- [Plugin slot registry](https://github.com/nosdesk/nosdesk/blob/v1.1.0/packages/core/src/types/pluginSlots.ts)
- [Navbar](https://github.com/nosdesk/nosdesk/blob/v1.1.0/frontend/src/components/Navbar.vue)
- [Signing/install CLI](https://github.com/nosdesk/nosdesk/blob/v1.1.0/backend/src/bin/nosdesk_cli.rs)
- [Upstream audit authorization](https://github.com/nosdesk/nosdesk/blob/v1.1.0/backend/src/utils/rbac.rs)
- [Storage repository contract](https://github.com/nosdesk/nosdesk/blob/v1.1.0/backend/src/repository/plugins.rs)

Guarded installers compare the exact Git commit and known file hashes before writing. They accept specified previous deliveries, not arbitrary local changes. Source patches do not become a supported upstream API merely because they are installed.
