<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAssetCategoryPlugin, type Assignment } from '@/composables/useAssetCategoryPlugin';
import { getAssets } from '@/services/assetService';
import { assetKindsService, type AssetKind } from '@nosdesk/core/services/assetKindsService';
import { attributeCatalog, attributeValue, assignmentKey, fieldLabel, selectedFields, mapLimit, type Field } from '@/utils/assetCategoryModel.mjs';
import type { Asset } from '@nosdesk/core/types/asset';
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
watch(() => route.fullPath, () => { editingColumns.value = false; fieldSearch.value = ''; });
const selected = computed(() => String(route.query.category ?? '*'));
const child = computed(() => String(route.query.subcategory ?? ''));
const category = computed(() => categories.value.find(c => c.id === selected.value));
const definition = computed(() => child.value ? category.value?.children.find(c => c.id === child.value) : category.value);
const title = computed(() => managing.value ? 'Create a sublist' : selected.value === '*' ? 'All categories' : selected.value === '' ? 'Uncategorised' : category.value?.name ?? 'Unknown sublist');
const allSaved = computed(() => categories.value.flatMap(c => [...(c.selectedAttributes ?? []), ...c.children.flatMap(s => s.selectedAttributes ?? [])]));
// The host extension can read asset-kind schemas; the sandbox SDK cannot.
// Saved selections stay discoverable even if a field disappears from inventory.
const catalog = computed(() => attributeCatalog(assets.value, kinds.value, allSaved.value));
const filteredCatalog = computed(() => catalog.value.filter(f => (f.label + ' ' + f.id + ' ' + f.sources.join(' ')).toLowerCase().includes(fieldSearch.value.toLowerCase())));
const choices = computed({ get: () => managing.value ? newAttributes.value : draft.value, set: (v: string[]) => { if (managing.value)
        newAttributes.value = v;
    else
        draft.value = v; } });
const columns = computed<Field[]>(() => selectedFields(category.value, child.value).map(id => catalog.value.find(f => f.id === id) ?? { id, label: fieldLabel(id), sources: ['Previously selected'] }));
watch(() => [definition.value?.id, JSON.stringify(definition.value?.selectedAttributes ?? null), JSON.stringify(category.value?.selectedAttributes ?? null)], () => { draft.value = [...selectedFields(category.value, child.value)]; }, { immediate: true });
const visible = computed(() => assets.value.filter(a => { const x = assignments.value[a.id]; return (selected.value === '*' || (selected.value === '' ? !x?.category : x?.category === selected.value)) && (!child.value || x?.subcategory === child.value) && [a.name, a.model, a.serial_number, a.asset_tag].some(v => String(v ?? '').toLowerCase().includes(query.value.toLowerCase())); }));
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
onBeforeUnmount(() => { generation++; });
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
        const entry = { id: crypto.randomUUID(), name, selectedAttributes: [...newAttributes.value], ...(parent ? {} : { children: [] }) };
        if (parent)
            parent.children.push(entry);
        else
            t.categories.push({ ...entry, children: [] });
        await writeTaxonomy(t);
        newName.value = '';
        newAttributes.value = [];
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
function editColumns() { draft.value = [...selectedFields(category.value, child.value)]; fieldSearch.value = ''; editingColumns.value = true; }
function cancelColumns() { draft.value = [...selectedFields(category.value, child.value)]; editingColumns.value = false; }
function pickAll() { choices.value = [...new Set([...choices.value, ...filteredCatalog.value.map(f => f.id)])]; }
</script>
<template>
 <div class="p-6 space-y-4 overflow-auto">
  <h1 class="text-xl font-semibold">{{ title }}</h1>
  <p v-if="managing" class="text-sm text-secondary">You create the sublists. Selected attributes become columns in that sublist; the asset name always remains a link. Attribute selection does not delete values or make fields mandatory.</p>
  <div class="flex flex-wrap items-center gap-4">
   <button v-if="api&&!managing&&definition&&!editingColumns" type="button" :disabled="!ready||busy||saving" class="border border-default rounded p-2" aria-controls="sublist-columns-editor" :aria-expanded="editingColumns" @click="editColumns">Edit columns</button>
   <label v-if="!managing">Category <select :value="selected" class="bg-surface border border-default rounded p-2" @change="filter('category',$event)"><option value="*">All categories</option><option value="">Uncategorised</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
   <label v-if="!managing&&category?.children.length">Subcategory <select :value="child" class="bg-surface border border-default rounded p-2" @change="filter('subcategory',$event)"><option value="">All subcategories</option><option v-for="s in category?.children??[]" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
   <button type="button" :disabled="busy||saving" class="border border-default rounded p-2" @click="load">{{ managing||editingColumns?'Scan attributes':'Refresh assets' }}</button>
  </div>
  <p v-if="!api" role="status">Install and enable the Asset Sublists 2.0.0 plugin in this workspace.</p>
  <p v-if="error||taxonomyError" role="alert">{{ error||taxonomyError }}</p>
  <p v-if="notice" role="status">{{ notice }}</p>
  <p v-if="schemaWarning" role="status">{{ schemaWarning }}</p>
  <p v-if="busy" role="status">Reading all accessible asset records and defined asset-kind attributes…</p>
  <p v-if="api&&!categories.length&&!busy">No sublists have been created. Use Create sublist to add your first one.</p>
  <!-- Setup is explicit: creation mode or the saved-list Edit columns action. -->
  <section v-if="api&&(managing||(definition&&editingColumns))" id="sublist-columns-editor" class="border border-default rounded p-4 space-y-3">
   <h2 class="font-semibold">{{ managing?'New sublist and attributes':'Columns for '+definition?.name }}</h2>
   <template v-if="managing">
    <label>Name <input v-model="newName" maxlength="80" :disabled="saving" class="bg-surface border border-default rounded p-2" /></label>
    <label>Parent <select v-model="newParent" :disabled="saving" class="bg-surface border border-default rounded p-2"><option value="">Directly under Assets</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }} (subcategory)</option></select></label>
   </template>
   <p>{{ catalog.length }} available attributes from {{ assets.length }} accessible assets and {{ kinds.length }} asset-kind definitions. Structured attributes are selected as whole fields and displayed as JSON.</p>
   <label>Find attribute <input v-model="fieldSearch" class="bg-surface border border-default rounded p-2" /></label>
   <div class="flex gap-3"><button type="button" :disabled="!ready||saving" class="underline" @click="pickAll">Select listed attributes</button><button type="button" :disabled="!ready||saving" class="underline" @click="choices=[]">Clear selection</button></div>
   <fieldset :disabled="!ready||busy||saving" class="grid gap-2 max-h-80 overflow-auto"><legend>Attributes to show ({{ choices.length }} selected)</legend>
    <label v-for="field in filteredCatalog" :key="field.id" class="flex items-start gap-2"><input v-model="choices" type="checkbox" :value="field.id" /><span>{{ field.label }} <small class="text-tertiary">{{ field.id }} — {{ field.sources.join('; ') }}</small></span></label>
   </fieldset>
   <p v-if="managing">No attributes are preselected for a new sublist. With none selected, only the asset name is shown.</p>
   <button v-if="managing" type="button" :disabled="!ready||busy||saving" class="border border-default rounded p-2" @click="create">{{ saving?'Saving…':'Create sublist' }}</button>
   <button v-else type="button" :disabled="!ready||busy||saving" class="border border-default rounded p-2" @click="saveAttributes">{{ saving?'Saving…':'Save columns' }}</button>
   <button v-if="!managing" type="button" :disabled="saving" class="border border-default rounded p-2 ml-2" @click="cancelColumns">Cancel</button>
  </section>
  <template v-if="api&&!managing&&ready">
   <label>Search assets <input v-model="query" class="bg-surface border border-default rounded p-2" /></label>
   <p>{{ visible.length }} matching assets. Showing up to 200; use search to narrow results. Assign assets from Plugins → Asset sublists.</p>
   <div class="overflow-auto"><table class="w-full text-left"><thead><tr><th scope="col">Asset</th><th v-for="field in columns" :key="field.id" scope="col">{{ field.label }}</th></tr></thead><tbody><tr v-for="a in visible.slice(0,200)" :key="a.id" class="border-t border-default"><td class="py-2"><RouterLink :to="'/assets/'+a.id" class="underline">{{ a.name }}</RouterLink></td><td v-for="field in columns" :key="field.id" class="px-2 whitespace-pre-wrap">{{ attributeValue(a,field.id) }}</td></tr></tbody></table></div>
  </template>
 </div>
</template>
