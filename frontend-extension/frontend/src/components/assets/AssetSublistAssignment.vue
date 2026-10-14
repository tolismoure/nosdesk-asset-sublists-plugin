<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import SectionCard from '@/components/common/SectionCard.vue';
import Button from '@/components/common/Button.vue';
import { useAssetCategoryPlugin, type Assignment } from '@/composables/useAssetCategoryPlugin';
import { assignmentKey, matchesSublist } from '@/utils/assetCategoryModel.mjs';
import type { AssetGroup } from '@nosdesk/core/types/asset';
const props = defineProps<{ assetId: number; groups: AssetGroup[]; editable: boolean }>();
const { api, categories, refresh, readStorage, writeAssignment } = useAssetCategoryPlugin();
const readReady = ref(false);
const categoryId = ref(''), childId = ref(''), loading = ref(false), saving = ref(false), error = ref(''), notice = ref('');
let generation = 0;
const parent = computed(() => categories.value.find(c => c.id === categoryId.value));
// Group inclusion is independent of the manual choice, so clearing a manual
// assignment cannot suppress a live asset-group association.
const inherited = computed(() => categories.value.flatMap(c => {
    const asset = { asset_groups: props.groups };
    const children = c.children.filter(s => matchesSublist(asset, undefined, c, s.id));
    return children.length ? children.map(s => c.name + ' / ' + s.name) : matchesSublist(asset, undefined, c) ? [c.name] : [];
}));
watch(() => [props.assetId, api.value], async () => {
    const gen = ++generation; readReady.value = false; loading.value = true; error.value = ''; notice.value = ''; categoryId.value = ''; childId.value = '';
    if (!api.value) { loading.value = false; return; }
    try {
        await refresh();
        const stored = await readStorage<Assignment>(assignmentKey(props.assetId));
        if (gen !== generation) return;
        if (stored && (typeof stored.category !== 'string' || typeof stored.subcategory !== 'string')) throw Error('Invalid saved assignment; no changes made.');
        const selected = categories.value.find(c => c.id === stored?.category);
        categoryId.value = selected?.id ?? '';
        childId.value = selected?.children.some(c => c.id === stored?.subcategory) ? stored?.subcategory ?? '' : '';
        readReady.value = true;
    } catch (e) { if (gen === generation) error.value = e instanceof Error ? e.message : 'Assignment could not be read.'; }
    finally { if (gen === generation) loading.value = false; }
}, { immediate: true });
onBeforeUnmount(() => { generation++; });
async function save() {
    if (!readReady.value || loading.value || saving.value || !props.editable) return;
    const id = props.assetId, gen = generation;
    saving.value = true; error.value = ''; notice.value = '';
    try {
        await writeAssignment(id, { category: categoryId.value, subcategory: childId.value });
        if (gen === generation) notice.value = 'Assignment saved.';
    } catch (e) { if (gen === generation) error.value = e instanceof Error ? e.message : 'Assignment was not saved.'; }
    finally { saving.value = false; }
}
</script>
<template>
 <SectionCard v-if="api" content-padding="p-4">
  <template #title>Asset sublist</template>
  <div class="space-y-3">
   <p v-if="loading" role="status" class="text-sm text-secondary">Loading assignment…</p>
   <label class="block text-sm">Sublist
    <select v-model="categoryId" :disabled="!readReady||loading||saving||!editable" class="w-full mt-1 bg-surface-alt border border-default rounded-lg px-3 py-2 text-sm" @change="childId=''">
     <option value="">No manual assignment</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
   </label>
   <label v-if="parent?.children.length" class="block text-sm">Subcategory
    <select v-model="childId" :disabled="loading||saving||!editable" class="w-full mt-1 bg-surface-alt border border-default rounded-lg px-3 py-2 text-sm"><option value="">Parent sublist only</option><option v-for="c in parent.children" :key="c.id" :value="c.id">{{ c.name }}</option></select>
   </label>
   <Button v-if="editable" size="sm" :disabled="!readReady||loading" :loading="saving" @click="save">Save assignment</Button>
   <p v-if="inherited.length" class="text-xs text-secondary">Included through asset groups: {{ inherited.join(', ') }}. Clearing the manual choice retains these memberships.</p>
   <p v-if="error" role="alert" class="text-sm">{{ error }}</p><p v-if="notice" role="status" class="text-sm">{{ notice }}</p>
  </div>
 </SectionCard>
</template>
