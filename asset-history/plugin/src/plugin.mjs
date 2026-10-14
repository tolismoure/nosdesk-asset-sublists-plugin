import {valueText, fieldLabel, displayDiff, sourceLabel, actionLabel, actorLabel, matches, dateBounds, exportText} from './model.mjs';

export function mountHistory(root, api, initialContext = {}) {
  const doc = root.ownerDocument;
  let context = initialContext, assetId = context.asset?.id ?? null, generation = 0, dead = false, busy = false;
  let rows = [], cursor = null, metadata = {}, activeDates = {}, selectedLabel = context.asset?.name || '';
  const manager = context.component?.slot === 'nav.item';
  const controls = [];
  root.replaceChildren();
  const el = (tag, text, parent = root, className) => {
    const node = doc.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; parent.append(node); return node;
  };
  const style = el('style');
  style.textContent = `
    :root{color-scheme:light dark}.ah{font:14px/1.5 system-ui,sans-serif;color:var(--nd-text,#64748b);padding:8px;overflow-wrap:anywhere}
    .ah h2,.ah h3{color:var(--nd-text,inherit);margin:.5em 0}.ah p{margin:.55em 0}.ah .ah-controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:12px 0}.ah label{display:flex;flex-direction:column;gap:4px}
    .ah input,.ah select,.ah button,.ah textarea{font:inherit;border:1px solid #64748b;border-radius:5px;background:var(--nd-surface,transparent);color:inherit;padding:7px}
    .ah button{cursor:pointer}.ah button:disabled{opacity:.55;cursor:default}.ah :focus-visible{outline:3px solid #3b82f6;outline-offset:2px}
    .ah .ah-error{color:#ef4444}.ah .ah-record{border:1px solid #64748b;border-radius:7px;margin:14px 0;padding:12px}.ah .ah-global{border-left:4px solid #d97706}.ah .ah-muted{font-size:.9em}
    .ah .ah-scroll{overflow-x:auto}.ah table{border-collapse:collapse;width:100%;table-layout:fixed}.ah th,.ah td{text-align:left;vertical-align:top;border-bottom:1px solid #64748b;padding:8px}.ah th:first-child{width:24%}.ah pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
    .ah textarea{box-sizing:border-box;width:100%;min-height:230px}.ah details{margin-top:10px}.ah summary{cursor:pointer}.ah [hidden]{display:none!important}
    @media(max-width:600px){.ah table{table-layout:auto}.ah .ah-controls label{width:100%}}
    @media print{.ah .ah-controls,.ah .ah-export{display:none}.ah .ah-record{break-inside:avoid}.ah{color:#000}.ah .ah-error{color:#000}}
  `;
  const wrap = el('section', undefined, root, 'ah');
  el('h2', 'Asset history', wrap);
  el('p', 'Saved changes are read from Nosdesk’s server audit records. This plugin does not record or alter changes.', wrap);
  const heading = el('p', '', wrap);
  const status = el('p', '', wrap); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const error = el('p', '', wrap, 'ah-error'); error.setAttribute('role', 'alert');
  const button = (text, fn, parent) => {
    const node = el('button', text, parent); node.type = 'button'; node.addEventListener('click', fn); controls.push(node); return node;
  };
  const input = (label, type, parent) => {
    const holder = el('label', label, parent), node = el('input', undefined, holder); node.type = type; controls.push(node); return node;
  };
  const pickerControls = manager ? el('div', undefined, wrap, 'ah-controls') : null;
  let picker = null, manual = null;
  if (manager) {
    const holder = el('label', 'Current asset', pickerControls); picker = el('select', undefined, holder); controls.push(picker);
    const empty = el('option', 'Choose an asset', picker); empty.value = '';
    picker.addEventListener('change', () => {
      if (picker.value) selectAsset(picker.value, picker.selectedOptions[0]?.textContent || '');
    });
    manual = input('Asset ID (including a deleted asset)', 'number', pickerControls); manual.min = '1'; manual.step = '1';
    button('Open history', () => {
      if (!/^[1-9]\d*$/.test(manual.value) || !Number.isSafeInteger(Number(manual.value))) { error.textContent = 'Enter a positive whole-number asset ID.'; return; }
      selectAsset(Number(manual.value), '');
    }, pickerControls);
    el('p', 'The list contains current assets. Use an asset ID to read retained records for a deleted asset.', wrap, 'ah-muted');
  }
  const serverFilters = el('div', undefined, wrap, 'ah-controls');
  const since = input('From date (UTC)', 'date', serverFilters), until = input('To date (UTC)', 'date', serverFilters);
  const categoryHolder = el('label', '', serverFilters), includeCategories = el('input', undefined, categoryHolder); includeCategories.type = 'checkbox'; controls.push(includeCategories);
  categoryHolder.append(doc.createTextNode('Include global category configuration changes')); includeCategories.checked = false;
  button('Apply dates and category scope', () => reload(true), serverFilters);
  button('Refresh', () => reload(false), serverFilters);
  const localFilters = el('div', undefined, wrap, 'ah-controls');
  const search = input('Search loaded records', 'search', localFilters); search.placeholder = 'Field, value, author or record type';
  const actionHolder = el('label', 'Change type (loaded records)', localFilters), action = el('select', undefined, actionHolder); controls.push(action);
  for (const [value, label] of [['','All changes'],['I','Created'],['U','Updated'],['D','Deleted']]) { const option = el('option', label, action); option.value = value; }
  search.addEventListener('input', render); action.addEventListener('change', render);
  el('p', 'Search and change-type filters apply only to the records already loaded. Use Load more to include older records. Category configuration changes affect the shared category, rather than proving an edit to this asset.', wrap, 'ah-muted');
  const retention = el('p', '', wrap, 'ah-muted');
  const resultSummary = el('p', '', wrap);
  const timeline = el('div', undefined, wrap); timeline.setAttribute('aria-label', 'Historical changes');
  const bottom = el('div', undefined, wrap, 'ah-controls');
  const more = button('Load more', () => loadPage(true), bottom);
  const exportButton = button('Show JSON for copying', showExport, bottom);
  const exportArea = el('section', undefined, wrap, 'ah-export'); exportArea.hidden = true;
  el('h3', 'Copy loaded history', exportArea);
  el('p', 'This export contains only the loaded records matching your local filters. Select the text and copy it to a file; additional records may remain on the server.', exportArea);
  const exportHolder = el('label', 'History JSON', exportArea), exportBox = el('textarea', undefined, exportHolder); exportBox.readOnly = true;
  button('Select all text', () => { exportBox.focus(); exportBox.select(); }, exportArea);
  button('Close export', () => { exportArea.hidden = true; }, exportArea);

  function setBusy(value) {
    busy = value;
    for (const control of controls) control.disabled = value;
    // Asset switching remains possible while a prior request is in flight.
    if (picker) picker.disabled = false;
    if (manual) manual.disabled = false;
    more.disabled = value || !cursor || assetId === null;
    exportButton.disabled = value || rows.length === 0;
  }
  function fail(reason) {
    const code = reason?.status || reason?.statusCode || reason?.code;
    const message = typeof reason?.message === 'string' ? reason.message : String(reason || 'Unknown error');
    if (code === 401 || /unauthenticated|authentication required/i.test(message)) error.textContent = 'Sign in again to read asset history.';
    else if (code === 403 || /forbidden|permission|admin.only|administrator/i.test(message)) error.textContent = 'Asset history requires a workspace administrator and the Asset History read permission.';
    else error.textContent = `History could not be read: ${message}`;
  }
  function render() {
    if (dead) return;
    heading.textContent = assetId !== null ? `Asset #${assetId}${selectedLabel ? ` — ${selectedLabel}` : ''}` : 'Choose an asset to view its retained history.';
    timeline.replaceChildren();
    const filtered = rows.filter(row => matches(row, search.value, action.value));
    resultSummary.textContent = `${filtered.length} matching records / ${rows.length} loaded${cursor ? ' · More records are available.' : rows.length ? ' · End of the server results for this date and category scope.' : ''}`;
    if (!rows.length && assetId !== null && !busy && !error.textContent) el('p', 'No retained records were returned for this asset and date scope.', timeline);
    else if (rows.length && !filtered.length) el('p', 'No loaded records match your search and change-type filters.', timeline);
    for (const row of filtered) {
      const article = el('article', undefined, timeline, `ah-record${row.scope === 'category_global' ? ' ah-global' : ''}`);
      el('h3', `${actionLabel(row.op)} · ${sourceLabel(row)}`, article);
      const date = new Date(row.occurred_at), timeText = Number.isNaN(date.getTime()) ? String(row.occurred_at) : `${date.toLocaleString()} (${row.occurred_at})`;
      const time = el('time', timeText, article); time.dateTime = String(row.occurred_at);
      el('p', `Recorded author: ${actorLabel(row)}${row.actor_name && row.actor_uuid ? ` (${row.actor_uuid})` : ''}`, article);
      if (row.scope === 'category_global') el('p', 'Global category configuration: this affects the shared category setup. It is not an individual assignment change for this asset.', article);
      if (row.source === 'sublist_assignment') el('p', 'Category IDs are the values stored at the time. Names, when available, come from a retained category snapshot at assignment time; unresolved names remain IDs. Current category names are not substituted.', article, 'ah-muted');
      const changes = displayDiff(row);
      if (changes.length) {
        const scroll = el('div', undefined, article, 'ah-scroll'), table = el('table', undefined, scroll), head = el('tr', undefined, el('thead', undefined, table));
        for (const label of ['Changed field','Previous value','New value']) { const th = el('th', label, head); th.scope = 'col'; }
        const body = el('tbody', undefined, table);
        for (const item of changes) {
          const tr = el('tr', undefined, body), th = el('th', fieldLabel(item.field), tr); th.scope = 'row';
          el('pre', valueText(item.old, item.old_present), el('td', undefined, tr));
          el('pre', valueText(item.new, item.new_present), el('td', undefined, tr));
        }
      } else el('p', 'No field differences were supplied. The source snapshot is available below.', article);
      const details = el('details', undefined, article); el('summary', 'Source record and snapshots', details); el('pre', JSON.stringify(row, null, 2), details);
    }
    const days = metadata.retention_days;
    retention.textContent = `History is limited to records still retained by the server.${typeof days === 'number' ? ` Configured audit retention: ${days} days.` : ''}${metadata.related_capture_since ? ` Additional relationship recording began ${metadata.related_capture_since}.` : ''} Unknown authors, previously missing records and deleted file contents cannot be reconstructed. Actor names reflect the server’s current user record.`;
    more.hidden = !cursor;
    more.disabled = busy || !cursor;
    exportButton.disabled = busy || rows.length === 0;
  }
  function showExport() {
    exportBox.value = exportText(assetId, rows.filter(row => matches(row, search.value, action.value)), {dates: activeDates, search: search.value, op: action.value}, cursor, metadata);
    exportArea.hidden = false; exportBox.focus(); exportBox.select();
  }
  async function loadPage(append = false) {
    if (dead || assetId === null || (append && (!cursor || busy))) return;
    if (typeof api.assets?.history !== 'function') {
      error.textContent = 'The Asset History host extension is required. Standard Nosdesk 1.1.0 does not expose historical records to plugins.';
      status.textContent = ''; setBusy(false); render(); return;
    }
    const token = ++generation, requestedId = assetId, requestedCursor = append ? cursor : null;
    error.textContent = ''; status.textContent = append ? 'Loading more records…' : 'Loading history…'; setBusy(true); render();
    try {
      const response = await api.assets.history(requestedId, {limit: 50, ...activeDates, ...(requestedCursor ? {cursor: requestedCursor} : {}), include_category_changes: activeDates.include_category_changes === true});
      if (dead || generation !== token || assetId !== requestedId) return;
      if (!response || !Array.isArray(response.rows)) throw Error('The server returned an unsupported history response.');
      const incoming = response.rows;
      if (append) { const seen = new Set(rows.map(row => String(row.id))); rows = [...rows, ...incoming.filter(row => !seen.has(String(row.id)))]; }
      else rows = [...incoming];
      cursor = response.next_cursor || null;
      metadata = {retention_days: response.retention_days, related_capture_since: response.related_capture_since, category_changes_included: response.category_changes_included};
      status.textContent = `${incoming.length} records received${append ? '; earlier loaded records preserved' : ''}.`;
    } catch (reason) {
      if (!dead && generation === token) { fail(reason); status.textContent = append ? 'Earlier records are still shown. Load more can be retried.' : 'History was not refreshed. Previously loaded records may be out of date.'; }
    } finally {
      if (!dead && generation === token) { setBusy(false); render(); }
    }
  }
  function reload(applyDates) {
    if (dead || assetId === null) return;
    if (applyDates) {
      try { activeDates = {...dateBounds(since.value, until.value), include_category_changes: includeCategories.checked}; }
      catch (reason) { fail(reason); return; }
      // Previous records belong to the old server scope and must not be exported
      // or displayed as though they match a newly requested date/category scope.
      rows = []; cursor = null; metadata = {};
    }
    exportArea.hidden = true; return loadPage(false);
  }
  function selectAsset(id, label = '') {
    ++generation; assetId = id === null ? null : Number(id); selectedLabel = label; rows = []; cursor = null; metadata = {}; exportArea.hidden = true; error.textContent = ''; status.textContent = ''; setBusy(false); render();
    return loadPage(false);
  }
  async function loadPicker() {
    if (!picker || typeof api.assets?.list !== 'function') return;
    try {
      const list = await api.assets.list(); if (dead) return;
      if (!Array.isArray(list)) throw Error('The asset list was not returned.');
      for (const asset of [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        const option = el('option', `${asset.name || 'Unnamed asset'} (#${asset.id})`, picker); option.value = String(asset.id);
      }
      if (assetId !== null) picker.value = String(assetId);
    } catch (reason) { if (!dead) fail(reason); }
  }
  setBusy(false); render();
  const ready = assetId === null ? loadPicker() : loadPage(false);
  return {
    ready,
    update(next) {
      if (dead) return;
      const changed = context.asset?.id !== next.asset?.id; context = next;
      if (changed && !manager) return selectAsset(next.asset?.id ?? null, next.asset?.name || '');
      selectedLabel = next.asset?.name || selectedLabel; render();
    },
    unmount() { dead = true; ++generation; root.replaceChildren(); }
  };
}

export default { mount: mountHistory };
