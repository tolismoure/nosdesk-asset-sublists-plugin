/** Pure history projections: preserve presence flags, stable IDs and saved values.
 * Rendering labels are descriptive only and must never become new audit evidence. */
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function valueText(value, present = true) {
  if (!present) return 'Not present';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? '"" (empty text)' : value;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function fieldLabel(field) {
  return String(field).replace(/^field:/, '').replace(/^attribute:/, 'Custom attribute: ').replace(/_/g, ' ');
}

function flatten(field, old, current, oldPresent, newPresent, output, depth = 0) {
  // Arrays remain intact: an index shift must not be mistaken for multiple field edits.
  const canExpand = depth < 20 && (record(old) || record(current)) &&
    (!oldPresent || record(old)) && (!newPresent || record(current));
  if (canExpand) {
    const keys = new Set([...Object.keys(old || {}), ...Object.keys(current || {})]);
    if (keys.size) {
      for (const key of keys) {
        const previous = oldPresent && own(old, key), next = newPresent && own(current, key);
        if (previous === next && equal(old?.[key], current?.[key])) continue;
        flatten(`${field}.${key}`, old?.[key] ?? null, current?.[key] ?? null, previous, next, output, depth + 1);
      }
      return;
    }
  }
  output.push({field, old: oldPresent ? old : null, new: newPresent ? current : null, old_present: oldPresent, new_present: newPresent});
}

function storedValue(snapshot) {
  let value = record(snapshot) && own(snapshot, 'value') ? snapshot.value : snapshot;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* Keep an unrecognised value readable. */ }
  }
  return value;
}

function taxonomyDiff(before, after) {
  if (!Array.isArray(before?.categories) && !Array.isArray(after?.categories)) return null;
  const output = [];
  const map = categories => {
    const entries = new Map();
    for (const category of categories || []) {
      entries.set(category.id, {value: category, parentId: null, parentLabel: 'Top level', label: `Category: ${category.name || category.id}`});
      for (const child of category.children || []) entries.set(child.id, {value: child, parentId: category.id, parentLabel: `${category.name || category.id} (${category.id})`, label: `Subcategory: ${category.name || category.id} / ${child.name || child.id}`});
    }
    return entries;
  };
  const previous = map(before?.categories), next = map(after?.categories);
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(id), b = next.get(id), label = b?.label || a?.label || id;
    if (!a || !b) {
      output.push({field: label, old: a?.value ?? null, new: b?.value ?? null, old_present: !!a, new_present: !!b});
      continue;
    }
    if (a.parentId !== b.parentId) output.push({field: `${label} · Parent category`, old: a.parentLabel, new: b.parentLabel, old_present: true, new_present: true});
    for (const key of new Set([...Object.keys(a.value), ...Object.keys(b.value)])) {
      if (key === 'children') continue;
      const ap = own(a.value, key), bp = own(b.value, key);
      if (ap === bp && equal(a.value[key], b.value[key])) continue;
      output.push({field: `${label} · ${key === 'selectedAttributes' ? 'Selected attribute checkboxes' : fieldLabel(key)}`, old: a.value[key] ?? null, new: b.value[key] ?? null, old_present: ap, new_present: bp});
    }
    const ac = (a.value.children || []).map(child => child.id), bc = (b.value.children || []).map(child => child.id);
    if (!equal(ac, bc)) output.push({field: `${label} · Subcategory order`, old: ac, new: bc, old_present: true, new_present: true});
  }
  const aOrder = (before?.categories || []).map(category => category.id), bOrder = (after?.categories || []).map(category => category.id);
  if (!equal(aOrder, bOrder)) output.push({field: 'Category order', old: aOrder, new: bOrder, old_present: !!before, new_present: !!after});
  return output;
}

export function displayDiff(row) {
  if (row.source === 'category_configuration') {
    const changes = taxonomyDiff(storedValue(row.before), storedValue(row.after));
    if (changes?.length) return changes;
  }
  if (row.source === 'sublist_assignment') {
    const previous = storedValue(row.before), next = storedValue(row.after);
    if (record(previous) || record(next)) {
      const changes = [];
      for (const key of new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])) {
        const ap = own(previous, key), bp = own(next, key);
        if (ap === bp && equal(previous?.[key], next?.[key])) continue;
        const named = (value, side) => {
          const label = row.assignment_labels?.[side]?.[key];
          return typeof label === 'string' && label && typeof value === 'string' && value
            ? `${label} (ID: ${value})` : value;
        };
        changes.push({field: key === 'category' ? 'Category ID' : key === 'subcategory' ? 'Subcategory ID' : fieldLabel(key), old: named(previous?.[key] ?? null, 'before'), new: named(next?.[key] ?? null, 'after'), old_present: ap, new_present: bp});
      }
      if (changes.length) return changes;
    }
  }
  const output = [];
  for (const item of Array.isArray(row.diff) ? row.diff : []) {
    // The bridge supplies flags because JSON null and a missing key are different.
    const ap = typeof item.old_present === 'boolean' ? item.old_present : own(item, 'old');
    const bp = typeof item.new_present === 'boolean' ? item.new_present : own(item, 'new');
    flatten(String(item.field), item.old, item.new, ap, bp, output);
  }
  return output;
}

export function sourceLabel(row) {
  if (row.source === 'category_configuration') return 'Category configuration';
  if (row.source === 'sublist_assignment') return 'Sublist assignment';
  return ({assets: 'Asset details', asset_loans: 'Loan', asset_lifecycle_events: 'Lifecycle', asset_disposals: 'Disposal', asset_usage_log: 'Stock usage', asset_audits: 'Stock count', asset_media: 'Attachment', asset_group_assignments: 'Asset group membership', asset_directory_memberships: 'Directory group membership', ticket_assets: 'Ticket link'})[row.table_name] || fieldLabel(row.table_name || row.source || 'Record');
}

export function actionLabel(op) { return ({I: 'Created', U: 'Updated', D: 'Deleted'})[op] || String(op || 'Changed'); }
export function actorLabel(row) { return row.actor_name || row.actor_uuid || 'Unknown / system'; }
export function matches(row, search, action) {
  if (action && row.op !== action) return false;
  if (!search.trim()) return true;
  const values = [sourceLabel(row), actionLabel(row.op), actorLabel(row), row.actor_uuid, row.pk_text, row.correlation_id,
    ...displayDiff(row).flatMap(item => [item.field, valueText(item.old, item.old_present), valueText(item.new, item.new_present)])];
  return values.join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}

export function dateBounds(since, until) {
  if (since && until && since > until) throw Error('The start date must be on or before the end date.');
  const from = since ? new Date(`${since}T00:00:00.000Z`).toISOString() : undefined;
  // The reader uses an exclusive upper bound, preserving submillisecond records
  // on the final day by requesting the following UTC midnight.
  const to = until ? new Date(new Date(`${until}T00:00:00.000Z`).getTime() + 86400000).toISOString() : undefined;
  return {since: from, until: to};
}

export function exportText(assetId, rows, query, nextCursor, metadata = {}) {
  return JSON.stringify({asset_id: assetId, exported_at: new Date().toISOString(), description: 'Read-only copy of the currently loaded and filtered records; not a complete-history guarantee.', more_records_available: !!nextCursor, query, metadata, rows}, null, 2);
}
