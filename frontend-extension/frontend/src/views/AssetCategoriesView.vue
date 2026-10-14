<script setup lang="ts">
import { useAssetGroupsStore } from '@/stores/assetGroups';
import Button from '@/components/common/Button.vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAssetCategoryPlugin, type Assignment } from '@/composables/useAssetCategoryPlugin';
import { getAssets } from '@/services/assetService';
import { assetKindsService, type AssetKind } from '@nosdesk/core/services/assetKindsService';
import { attributeCatalog, attributeValue, assignmentKey, fieldLabel, selectedFields, mapLimit, matchesSublist, type Field } from '@/utils/assetCategoryModel.mjs';
import { assetLifecycleService } from '@nosdesk/core/services/assetLifecycleService';
import { latestLifecycleEvent, lifecycleSummary } from '@/utils/assetLifecycleColumns.mjs';
import { assetLoanService } from '@nosdesk/core/services/assetLoanService';
import { useUsersDirectory } from '@/composables/useUsersDirectory';
import type { Asset, AssetLifecycleEvent } from '@nosdesk/core/types/asset';
const { getUserHandle } = useUsersDirectory();
const loanUsers = ref<Record<number, string | null>>({}), loanErrors = ref<Record<number, boolean>>({});
let loanGeneration = 0, lifecycleGeneration = 0;
const lifecycleRows = ref<Record<number, AssetLifecycleEvent | null>>({}), lifecycleErrors = ref<Record<number, boolean>>({});
const groupStore = useAssetGroupsStore();
const newGroup = ref(''), draftGroup = ref('');
const route = useRoute(), router = useRouter();
const { api, categories, error: taxonomyError, refresh, readStorage, readTaxonomy, writeTaxonomy } = useAssetCategoryPlugin();
const assets = ref<Asset[]>([]), kinds = ref<AssetKind[]>([]), assignments = ref<Record<number, Assignment>>({});
const busy = ref(false), saving = ref(false), ready = ref(false), error = ref(''), notice = ref(''), schemaWarning = ref(''), query = ref(''), fieldSearch = ref('');
const newName = ref(''), newParent = ref(''), newAttributes = ref<string[]>([]), draft = ref<string[]>([]);
let generation = 0;
const managing = computed(() => route.query.manage === '1');
// Saved lists start in browsing mode. Navigation always closes the editor,
// including the redirect after creating a list.
const editingColumns = ref(false);
const sortField = ref('field:name'), sortDirection = ref<'asc' | 'desc'>('asc');
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function toggleSort(field: string) {
    sortDirection.value = sortField.value === field && sortDirection.value === 'asc' ? 'desc' : 'asc';
    sortField.value = field;
}
// Sort the full filtered inventory before truncation. Empty and unresolved values
// stay last in either direction; a stable asset-ID tie break prevents row jitter.
const sortedAssets = computed(() => [...visible.value].sort((a, b) => {
    const left = sortField.value === 'field:name' ? a.name : cellValue(a, sortField.value);
    const right = sortField.value === 'field:name' ? b.name : cellValue(b, sortField.value);
    const missing = (value: string) => ['—', 'Loading…', 'Unavailable', 'Unknown user', ''].includes(value);
    if (missing(left) !== missing(right)) return missing(left) ? 1 : -1;
    return (sortDirection.value === 'asc' ? 1 : -1) * collator.compare(left, right) || a.id - b.id;
}));
const tableHeaders = computed(() => [{ id: 'field:name', label: 'Asset' }, ...columns.value]);
watch(() => route.fullPath, () => { editingColumns.value = false; fieldSearch.value = ''; });
const selected = computed(() => String(route.query.category ?? '*'));
const child = computed(() => String(route.query.subcategory ?? ''));
const category = computed(() => categories.value.find(c => c.id === selected.value));
const definition = computed(() => child.value ? category.value?.children.find(c => c.id === child.value) : category.value);
const title = computed(() => managing.value ? 'Create a sublist' : selected.value === '*' ? 'All categories' : selected.value === '' ? 'Uncategorised' : category.value?.name ?? 'Unknown sublist');
const allSaved = computed(() => categories.value.flatMap(c => [...(c.selectedAttributes ?? []), ...c.children.flatMap(s => s.selectedAttributes ?? [])]));
// The host extension can read asset-kind schemas; the sandbox SDK cannot.
// Saved selections stay discoverable even if a field disappears from inventory.
const catalog = computed(() => [...attributeCatalog(assets.value, kinds.value, allSaved.value).filter(f => f.id !== 'field:loan_user'), { id: 'field:loan_user', label: 'Loan user', sources: ['Current unreturned loan (Assets view only)'] }, ...[{id:'field:latest_lifecycle_entry',label:'Latest lifecycle entry'},{id:'field:latest_lifecycle_date',label:'Latest lifecycle date (UTC)'},{id:'field:latest_lifecycle_author',label:'Latest lifecycle author'}].map(f => ({...f,sources:['Latest saved lifecycle transition (Assets view only)']}))].sort((a,b) => a.label.localeCompare(b.label)));
const filteredCatalog = computed(() => catalog.value.filter(f => (f.label + ' ' + f.id + ' ' + f.sources.join(' ')).toLowerCase().includes(fieldSearch.value.toLowerCase())));
const choices = computed({ get: () => managing.value ? newAttributes.value : draft.value, set: (v: string[]) => { if (managing.value)
        newAttributes.value = v;
    else
        draft.value = v; } });
const columns = computed<Field[]>(() => selectedFields(category.value, child.value).map(id => catalog.value.find(f => f.id === id) ?? { id, label: fieldLabel(id), sources: ['Previously selected'] }));
watch(columns, () => { if (sortField.value !== 'field:name' && !columns.value.some(f => f.id === sortField.value)) { sortField.value = 'field:name'; sortDirection.value = 'asc'; } });
watch(() => [definition.value?.id, JSON.stringify(definition.value?.selectedAttributes ?? null), JSON.stringify(category.value?.selectedAttributes ?? null)], () => { draft.value = [...selectedFields(category.value, child.value)]; draftGroup.value = String(definition.value?.assetGroupId ?? ''); }, { immediate: true });
const visible = computed(() => assets.value.filter(a => {
    const x = assignments.value[a.id];
    const inAny = categories.value.some(c => matchesSublist(a, x, c));
    return (selected.value === '*' || (selected.value === '' ? !inAny : matchesSublist(a, x, category.value, child.value))) &&
        [a.name, a.model, a.serial_number, a.asset_tag].some(value => String(value ?? '').toLowerCase().includes(query.value.toLowerCase()));
}));
// Read the matching rows only when this column is selected. All borrowers
// must be resolved so Loan user sorting precedes the 200-row display limit. Loan records
// are separate from assets; never confuse the primary user with the borrower.
watch(() => JSON.stringify([ready.value, columns.value.some(f => f.id === 'field:loan_user'), visible.value.map(a => a.id)]), async () => {
    const gen = ++loanGeneration;
    loanUsers.value = {}; loanErrors.value = {};
    if (!ready.value || !columns.value.some(f => f.id === 'field:loan_user')) return;
    await mapLimit(visible.value, 4, async (asset) => {
        try {
            const loans = await assetLoanService.list(asset.id);
            const borrower = loans.find(loan => !loan.returned_at)?.borrower_user_uuid ?? null;
            if (gen === loanGeneration) loanUsers.value[asset.id] = borrower;
        } catch {
            if (gen === loanGeneration) loanErrors.value[asset.id] = true;
        }
    });
});
// Resolve all matching rows before the display cap so sorting includes the
// entire filtered inventory. Generation checks reject obsolete async reads.
watch(() => JSON.stringify([ready.value, columns.value.some(f => f.id.startsWith('field:latest_lifecycle_')), visible.value.map(a => a.id)]), async () => {
    const gen = ++lifecycleGeneration;
    lifecycleRows.value = {}; lifecycleErrors.value = {};
    if (!ready.value || !columns.value.some(f => f.id.startsWith('field:latest_lifecycle_'))) return;
    await mapLimit(visible.value, 4, async (asset) => {
        try {
            const event = latestLifecycleEvent(await assetLifecycleService.list(asset.id));
            if (gen === lifecycleGeneration) lifecycleRows.value[asset.id] = event;
        } catch { if (gen === lifecycleGeneration) lifecycleErrors.value[asset.id] = true; }
    });
});
function cellValue(asset: Asset, field: string): string {
    if (field.startsWith('field:latest_lifecycle_')) {
        if (lifecycleErrors.value[asset.id]) return 'Unavailable';
        const event = lifecycleRows.value[asset.id];
        if (event === undefined) return 'Loading…';
        if (event === null) return '—';
        if (field === 'field:latest_lifecycle_date') return new Date(event.occurred_at).toISOString();
        if (field === 'field:latest_lifecycle_entry') return lifecycleSummary(event);
        if (!event.actor_uuid) return 'Unknown user';
        const handle = getUserHandle(event.actor_uuid);
        return handle.user.value?.name ?? (handle.status.value === 'loading' ? 'Loading…' : 'Unknown user');
    }
    if (field !== 'field:loan_user') return attributeValue(asset, field);
    if (loanErrors.value[asset.id]) return 'Unavailable';
    const uuid = loanUsers.value[asset.id];
    if (uuid === undefined) return 'Loading…';
    if (uuid === null) return '—';
    const handle = getUserHandle(uuid);
    return handle.user.value?.name ?? (handle.status.value === 'loading' ? 'Loading…' : 'Unknown user');
}
// Generation checks prevent an older inventory scan from replacing a newer one.
async function load() {
    const gen = ++generation;
    ready.value = false;
    error.value = '';
    schemaWarning.value = '';
    if (!api.value) {
        assets.value = [];
        assignments.value = {};
        kinds.value = [];
        busy.value = false;
        return;
    }
    busy.value = true;
    try {
        await refresh();
        await groupStore.load(true);
        const [rows, schemas] = await Promise.all([getAssets(), assetKindsService.list().then(value => ({ value, error: '' })).catch(() => ({ value: [] as AssetKind[], error: 'Defined attribute schemas could not be read. The checklist still includes core fields and keys found in accessible assets.' }))]);
        const pairs = await mapLimit(rows, 8, async (a) => [a.id, await readStorage<Assignment>(assignmentKey(a.id))] as const);
        if (gen !== generation)
            return;
        assets.value = rows;
        kinds.value = schemas.value;
        schemaWarning.value = schemas.error;
        assignments.value = Object.fromEntries(pairs.map(([id, value]) => { const c = categories.value.find(c => c.id === value?.category); return [id, { category: c?.id ?? '', subcategory: c?.children.some(s => s.id === value?.subcategory) ? value?.subcategory ?? '' : '' }]; }));
        ready.value = true;
    }
    catch (e) {
        if (gen === generation) {
            assets.value = [];
            assignments.value = {};
            error.value = e instanceof Error ? e.message : 'Could not read inventory. No settings were overwritten.';
        }
    }
    finally {
        if (gen === generation)
            busy.value = false;
    }
}
watch(api, () => { void load(); }, { immediate: true });
onBeforeUnmount(() => { generation++; loanGeneration++; lifecycleGeneration++; });
function filter(key: 'category' | 'subcategory', event: Event) { const value = (event.target as HTMLSelectElement).value; void router.replace({ path: '/assets/categories', query: { category: selected.value, subcategory: child.value, [key]: value, ...(key === 'category' ? { subcategory: '' } : {}) } }); }
// Re-read taxonomy before writing so validation uses the latest stored state.
// Storage is still last-writer-wins; this is not optimistic conflict control.
async function create() {
    if (!ready.value || saving.value || busy.value)
        return;
    const name = newName.value.trim();
    if (!name || name.length > 80) {
        error.value = 'Enter a sublist name of 1–80 characters.';
        return;
    }
    saving.value = true;
    error.value = '';
    notice.value = '';
    try {
        const t = await readTaxonomy(), parent = newParent.value ? t.categories.find(c => c.id === newParent.value) : null;
        if (newParent.value && !parent)
            throw Error('Parent no longer exists. Refresh and retry.');
        const list = parent ? parent.children : t.categories;
        if (list.length >= 100)
            throw Error('Maximum 100 sublists per level.');
        if (list.some(c => c.name.toLowerCase() === name.toLowerCase()))
            throw Error('That name already exists at this level.');
        const entry = { id: crypto.randomUUID(), name, selectedAttributes: [...newAttributes.value], assetGroupId: newGroup.value ? Number(newGroup.value) : null, ...(parent ? {} : { children: [] }) };
        if (parent)
            parent.children.push(entry);
        else
            t.categories.push({ ...entry, children: [] });
        await writeTaxonomy(t);
        newName.value = '';
        newAttributes.value = []; newGroup.value = '';
        await router.push({ path: '/assets/categories', query: { category: parent?.id ?? entry.id, ...(parent ? { subcategory: entry.id } : {}) } });
        notice.value = 'Sublist created. Expand/reopen Assets to refresh its links.';
    }
    catch (e) {
        error.value = e instanceof Error ? e.message : 'Create failed.';
    }
    finally {
        saving.value = false;
    }
}
async function saveAttributes() {
    if (!ready.value || !definition.value || saving.value || busy.value)
        return;
    const id = definition.value.id, picked = [...draft.value];
    saving.value = true;
    error.value = '';
    notice.value = '';
    try {
        const t = await readTaxonomy();
        const entry = t.categories.flatMap(c => [c, ...c.children]).find(c => c.id === id);
        if (!entry)
            throw Error('Sublist no longer exists. Refresh and retry.');
        entry.selectedAttributes = picked;
        entry.assetGroupId = draftGroup.value ? Number(draftGroup.value) : null;
        await writeTaxonomy(t);
        notice.value = 'Columns saved.';
        editingColumns.value = false;
    }
    catch (e) {
        error.value = e instanceof Error ? e.message : 'Save failed.';
    }
    finally {
        saving.value = false;
    }
}
// Edit a draft only. Cancel and route changes never persist column choices.
function editColumns() { draftGroup.value = String(definition.value?.assetGroupId ?? ''); draft.value = [...selectedFields(category.value, child.value)]; fieldSearch.value = ''; editingColumns.value = true; }
function cancelColumns() { draftGroup.value = String(definition.value?.assetGroupId ?? ''); draft.value = [...selectedFields(category.value, child.value)]; editingColumns.value = false; }
function pickAll() { choices.value = [...new Set([...choices.value, ...filteredCatalog.value.map(f => f.id)])]; }
</script>
<template>
 <div class="p-6 space-y-4 overflow-auto">
  <h1 class="text-xl font-semibold">{{ title }}</h1>
  <p v-if="managing" class="text-sm text-secondary">You create the sublists. Selected attributes become columns in that sublist; the asset name always remains a link. Attribute selection does not delete values or make fields mandatory.</p>
  <div class="flex flex-wrap items-center gap-3">
   <Button variant="primary" size="sm" v-if="api&&!managing&&definition&&!editingColumns" type="button" :disabled="!ready||busy||saving" aria-controls="sublist-columns-editor" :aria-expanded="editingColumns" @click="editColumns">Edit columns</Button>
   <label v-if="!managing">Category <select :value="selected" class="bg-surface-alt border border-default rounded-lg px-3 py-1.5 text-sm" @change="filter('category',$event)"><option value="*">All categories</option><option value="">Uncategorised</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
   <label v-if="!managing&&category?.children.length">Subcategory <select :value="child" class="bg-surface border border-default rounded p-2" @change="filter('subcategory',$event)"><option value="">All subcategories</option><option v-for="s in category?.children??[]" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
   <Button variant="secondary" size="sm" type="button" :disabled="busy||saving" @click="load" :loading="busy">{{ managing||editingColumns?'Scan attributes':'Refresh assets' }}</Button>
  </div>
  <p v-if="!api" role="status">Install and enable the Asset Sublists 2.0.0 plugin in this workspace.</p>
  <p v-if="error||taxonomyError" role="alert">{{ error||taxonomyError }}</p>
  <p v-if="notice" role="status">{{ notice }}</p>
  <p v-if="schemaWarning" role="status">{{ schemaWarning }}</p>
  <p v-if="busy" role="status">Reading all accessible asset records and defined asset-kind attributes…</p>
  <p v-if="api&&!categories.length&&!busy">No sublists have been created. Use Create sublist to add your first one.</p>
  <!-- Setup is explicit: creation mode or the saved-list Edit columns action. -->
  <section v-if="api&&(managing||(definition&&editingColumns))" id="sublist-columns-editor" class="border border-default rounded p-4 space-y-3">
   <h2 class="font-semibold">{{ managing?'New sublist and attributes':'Columns and membership for '+definition?.name }}</h2>
   <template v-if="managing">
    <label>Name <input v-model="newName" maxlength="80" :disabled="saving" class="bg-surface border border-default rounded p-2" /></label>
    <label>Parent <select v-model="newParent" :disabled="saving" class="bg-surface border border-default rounded p-2"><option value="">Directly under Assets</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }} (subcategory)</option></select></label>
   </template>
   <label class="block">Include assets from group <select :value="managing?newGroup:draftGroup" :disabled="saving||!!groupStore.error" class="bg-surface-alt border border-default rounded-lg px-3 py-1.5 text-sm" @change="managing?newGroup=($event.target as HTMLSelectElement).value:draftGroup=($event.target as HTMLSelectElement).value"><option value="">No linked group (manual assignments only)</option><option v-for="g in groupStore.active" :key="g.id" :value="String(g.id)">{{ g.name }}</option><option v-if="(managing?newGroup:draftGroup)&&!groupStore.active.some(g=>String(g.id)===(managing?newGroup:draftGroup))" :value="managing?newGroup:draftGroup">Unavailable group #{{ managing?newGroup:draftGroup }}</option></select></label>
   <p class="text-sm text-secondary">Group members are included automatically alongside manual assignments. Linking a group does not change its membership.</p>
   <p v-if="groupStore.error" role="alert">Asset groups could not be loaded. Existing group links are retained; refresh to retry.</p>
   <p>{{ catalog.length }} available attributes from {{ assets.length }} accessible assets and {{ kinds.length }} asset-kind definitions. Structured attributes are selected as whole fields and displayed as JSON.</p>
   <label>Find attribute <input v-model="fieldSearch" class="bg-surface border border-default rounded p-2" /></label>
   <div class="flex gap-3"><Button variant="ghost" size="sm" type="button" :disabled="!ready||saving" @click="pickAll">Select listed attributes</Button><Button variant="ghost" size="sm" type="button" :disabled="!ready||saving" @click="choices=[]">Clear selection</Button></div>
   <fieldset :disabled="!ready||busy||saving" class="grid gap-2 max-h-80 overflow-auto"><legend>Attributes to show ({{ choices.length }} selected)</legend>
    <label v-for="field in filteredCatalog" :key="field.id" class="flex items-start gap-2"><input v-model="choices" type="checkbox" :value="field.id" /><span>{{ field.label }} <small class="text-tertiary">{{ field.id }} — {{ field.sources.join('; ') }}</small></span></label>
   </fieldset>
   <p v-if="managing">No attributes are preselected for a new sublist. With none selected, only the asset name is shown.</p>
   <Button variant="primary" size="sm" v-if="managing" type="button" :disabled="!ready||busy||saving" @click="create" :loading="saving">{{ saving?'Saving…':'Create sublist' }}</Button>
   <Button variant="primary" size="sm" v-else type="button" :disabled="!ready||busy||saving" @click="saveAttributes" :loading="saving">{{ saving?'Saving…':'Save columns' }}</Button>
   <Button variant="secondary" size="sm" v-if="!managing" type="button" :disabled="saving" @click="cancelColumns">Cancel</Button>
  </section>
  <template v-if="api&&!managing&&ready">
   <label>Search assets <input v-model="query" class="bg-surface border border-default rounded p-2" /></label>
   <p>{{ visible.length }} matching assets. Showing up to 200; use search to narrow results. Assign assets from the Asset sublist card on each asset, or link an asset group in Edit columns.</p>
   <div class="overflow-auto"><table class="w-full text-left"><thead><tr>
    <th v-for="field in tableHeaders" :key="field.id" scope="col" :aria-sort="sortField===field.id?(sortDirection==='asc'?'ascending':'descending'):'none'" class="px-3 py-2 first:pl-4 text-3xs font-semibold uppercase tracking-wider text-tertiary bg-surface border-b border-subtle">
     <button type="button" class="flex items-center gap-1 w-full text-left uppercase tracking-wider hover:text-primary rounded focus-visible:outline focus-visible:outline-2" :aria-label="'Sort by '+field.label+(sortField===field.id&&sortDirection==='asc'?', descending':', ascending')" @click="toggleSort(field.id)">{{ field.label }} <span v-if="sortField===field.id" class="text-primary" aria-hidden="true">{{ sortDirection==='asc'?'↑':'↓' }}</span></button>
    </th>
   </tr></thead><tbody><tr v-for="a in sortedAssets.slice(0,200)" :key="a.id" class="border-b border-subtle hover:bg-surface-hover"><td class="px-3 py-2 pl-4"><RouterLink :to="'/assets/'+a.id" class="font-medium hover:underline">{{ a.name }}</RouterLink></td><td v-for="field in columns" :key="field.id" class="px-3 py-2 whitespace-pre-wrap text-secondary">{{ cellValue(a,field.id) }}</td></tr></tbody></table></div>
  </template>
 </div>
</template>
