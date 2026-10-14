# Storage and history data model

## Stable plugin identities

| Plugin | Version | Storage/API purpose |
| --- | --- | --- |
| asset-categories | 2.1.0 | Existing sublist identity; preserve it during updates |
| asset-history | 1.0.0 | Read-only viewer and scoped history grant |

Updating the same installed plugin retains its database identity and storage. Deleting/recreating a plugin can change its identity and leave earlier audit rows unresolved. Installation must use the supported verified installer rather than inserting plugin rows manually.

## Shared taxonomy

Key: taxonomy-v1. This is an illustrative value, not seeded data:

~~~json
{
  "version": 1,
  "categories": [
    {
      "id": "computers",
      "name": "Computers",
      "selectedAttributes": ["field:model", "field:serial_number"],
      "children": [
        {
          "id": "laptops",
          "name": "Laptops",
          "selectedAttributes": ["attribute:hostname"]
        }
      ]
    }
  ]
}
~~~

IDs are stable and unique across both levels. Creation uses UUID strings. Names are 1–80 characters; the validator bounds categories/children to 100 per level and selected fields to 500. Corrupt state is rejected before writes.

An explicitly empty selectedAttributes array means no optional columns. Legacy entries without this property inherit parent/default columns; absence must not be confused with an empty array.

## Per-asset assignment

Key: asset-42-category-v1 for native asset ID 42:

~~~json
{"category":"computers","subcategory":"laptops"}
~~~

Empty strings represent no manual assignment/no child; linked groups can still include the asset in a sublist. Unknown IDs resolve to unclassified rather than a fabricated name. Assignment storage does not update the asset record.

## Field IDs and catalog discovery

- field:model refers to a native/core asset property.
- attribute:hostname refers to a key within the attributes object.
- name is always displayed and not selectable as an optional column.
- The entire attributes object is not an optional column; individual top-level keys are catalogued.

The host UI merges core fields, declared asset-kind schema properties, observed accessible inventory fields and previously saved selections. The sandbox page sees core/observed fields because kind-schema enumeration is not in the standard SDK. Saved fields remain discoverable when current inventory has no value for them. Missing values display a dash; false and zero remain visible; objects/arrays are serialized whole.

## Historical records

The viewer projects retained audit rows into old/new values, presence flags, actor UUID/current name, UTC timestamp, operation, source and scope. BIGINT audit IDs travel as strings to avoid JavaScript precision loss. Date bounds use an inclusive since and exclusive until; pagination orders timestamp plus ID and binds cursors to the same workspace/asset/plugin/date/category query.

Individual assignments and shared taxonomy events are distinct sources. A taxonomy event is category_global scope and requires explicit inclusion. Historical assignment labels are best-effort retained taxonomy names at that event; no retained snapshot means unresolved IDs.

Only the integrated asset-categories storage keys are readable across plugin identities. Secret entries, settings, unrelated keys/plugins/workspaces and transitions to secret entries are excluded. Both non-null before/after snapshots must satisfy the allowed entry conditions.

## Capture, redaction and retention

Native asset, supported related record and plugin_data changes use server audit capture. The extension adds four previously missing relationship/disposal triggers. There is no historical backfill and no duplicate main-asset audit logger.

The upstream trigger supplies audit context/redaction. A missing workspace context fails the added captures instead of silently writing unauditable changes. This does not guarantee resistance to privileged trigger suppression or database maintenance.

Positive AUDIT_LOG_RETENTION_DAYS controls retention; invalid/nonpositive values fall back to 540 days. Monthly partition pruning makes this a policy rather than an exact per-record cutoff guarantee. Deleted file contents are not retained by metadata history.

## Optional group membership (2.1.0)

Each category or child may store `assetGroupId`, a positive integer or null. Missing/null preserves manual-only behavior. Membership is the union of explicit assignment and membership in the linked native `asset_groups` IDs. A parent includes assets in any linked child group; child views require that child’s manual assignment or group. Uncategorised means no manual or group-derived membership. Directory groups (`groups`/UUIDs) are deliberately excluded. Assets can appear in multiple group-linked lists while retaining one manual assignment. Removing a group link does not erase manual assignments or alter native groups. Group membership is evaluated from current accessible asset records, not copied into plugin storage.
