# User guide

## Create and browse a list

1. Enable Asset Sublists in Administration → Plugins in the intended workspace.
2. Expand Assets and choose Create sublist.
3. Enter a name; choose a parent only when creating a subcategory.
4. Select the columns to display. Nothing is preselected for a new list.
5. Create the list. It opens to its asset table, without the setup form.

The asset name always remains visible. An empty selection shows only the name. A list can have one level of child subcategories, each with its own selected columns. Structured values appear as a whole JSON field; nested properties are not separate checkboxes.

## Change columns later

Open a saved list and click Edit columns. Adjust the checkboxes and choose Save columns. Cancel discards the draft. Both actions close the checklist; navigating to another list also closes it. The native asset edit form and its required fields do not change.

## Assign assets

Use Plugins → Asset sublists. Choose an asset in Asset to classify, select a category and optional subcategory, and Save assignment. The individual asset page does not contain sublist controls in version 2.0.1. Choosing Uncategorised clears the classification.

Each asset has one category/subcategory assignment. Storage is workspace/plugin scoped. Refresh the list to see updated assignments, and reopen the Assets navigation if a newly created list link has not appeared. Lists show up to 200 matches; use Search assets to narrow results.

## Read history

Open an asset's Asset History panel or the standalone history page. Refresh, optionally apply a UTC date range, then load more records. Include global category configuration changes is separate: those events describe shared taxonomy edits, not edits to every asset in the category.

Search and action filters apply only to records already loaded. The JSON export likewise includes only loaded filtered records. The sandbox provides selectable JSON to copy rather than an arbitrary browser download.

Old/new values preserve false, zero, null and absence distinctly. Actor UUIDs are stable, but actor display names are current account lookups. Missing actors show Unknown/system. Older relationship history may not exist before the capture-start date; retention and previous gaps limit what can be shown.

## Editing and safety

Shared lists have no additional admin-only write policy beyond the host's runtime access/permission gates. Coordinate simultaneous taxonomy edits. Refresh failures do not authorize resetting malformed or inaccessible stored data. Attribute selection is a display preference, not validation, data deletion or a new asset type.
