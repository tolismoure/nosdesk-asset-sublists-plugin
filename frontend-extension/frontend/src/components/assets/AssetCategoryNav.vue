<script setup lang="ts">
import {ref,watch} from 'vue';
import {RouterLink,useRoute} from 'vue-router';
import {useAssetCategoryPlugin} from '@/composables/useAssetCategoryPlugin';
const route=useRoute();const expanded=ref(route.path.startsWith('/assets'));
const {api,categories,error,refresh}=useAssetCategoryPlugin();
watch(()=>route.path,p=>{if(p.startsWith('/assets'))expanded.value=true;});
function toggle(){expanded.value=!expanded.value;if(expanded.value)void refresh().catch(()=>{});}
function active(id:string){return route.path==='/assets/categories'&&String(route.query.category??'*')===id;}
</script>
<template>
 <div>
  <div class="flex items-center rounded-md" :class="route.path.startsWith('/assets')?'bg-surface-alt/80 text-primary':'text-secondary'">
   <RouterLink to="/assets" class="flex items-center flex-1 px-2.5 py-1 gap-2.5">
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-width="2" d="M3 4h18v13H3zM8 21h8m-4-4v4"/></svg>
    <span class="text-sm">{{ $t('nav-assets') }}</span>
   </RouterLink>
   <button type="button" class="px-2 py-1" :aria-expanded="expanded" aria-controls="asset-category-sublist" aria-label="Expand asset categories" @click="toggle">{{ expanded?'▾':'▸' }}</button>
  </div>
  <ul v-if="expanded" id="asset-category-sublist" class="ml-5 border-l border-default pl-2 space-y-0.5">
   <li><RouterLink to="/assets" class="block rounded px-2 py-1 text-sm hover:bg-surface-hover" :aria-current="route.path==='/assets'?'page':undefined">All assets</RouterLink></li>
   <template v-if="api">
    <li v-for="category in categories" :key="category.id"><RouterLink :to="{path:'/assets/categories',query:{category:category.id}}" class="block rounded px-2 py-1 text-sm hover:bg-surface-hover" :class="active(category.id)?'bg-surface-alt text-primary font-medium':'text-secondary'" :aria-current="active(category.id)?'page':undefined">{{ category.name }}</RouterLink><ul v-if="category.children.length" class="ml-3"><li v-for="sub in category.children" :key="sub.id"><RouterLink :to="{path:'/assets/categories',query:{category:category.id,subcategory:sub.id}}" class="block rounded px-2 py-1 text-sm hover:bg-surface-hover">{{ sub.name }}</RouterLink></li></ul></li>
    <li><RouterLink :to="{path:'/assets/categories',query:{category:''}}" class="block rounded px-2 py-1 text-sm hover:bg-surface-hover" :aria-current="active('')?'page':undefined">Uncategorised</RouterLink></li>
   </template>
   <li v-if="api"><RouterLink :to="{path:'/assets/categories',query:{manage:'1'}}" class="block rounded px-2 py-1 text-sm underline">Create sublist</RouterLink></li>
   <li v-if="api&&!categories.length" class="px-2 py-1 text-xs text-tertiary">No sublists created yet.</li>
   <li v-if="!api" class="px-2 py-1 text-xs text-tertiary">Install and enable Asset Categories to show categories.</li>
   <li v-if="error" role="alert" class="px-2 text-xs">{{ error }}</li>
  </ul>
 </div>
</template>
