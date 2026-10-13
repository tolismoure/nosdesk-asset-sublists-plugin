import {computed,ref,watch} from 'vue';
import {getLoadedPlugins} from '@/plugins/loader';
import pluginService from '@nosdesk/core/services/pluginService';
import {defaults,validTaxonomy,taxonomyKey,type Category,type Taxonomy} from '@/utils/assetCategoryModel.mjs';
export type AssetCategory=Category;
export interface Assignment {category:string;subcategory:string}
export function useAssetCategoryPlugin(){
 const plugin=computed(()=>getLoadedPlugins().find(p=>p.plugin.name==='asset-categories'&&p.plugin.manifest.permissions.includes('asset:read')&&p.plugin.manifest.permissions.includes('storage:plugin')));
 const api=computed(()=>Boolean(plugin.value));
 const categories=ref<Category[]>([]),error=ref('');let revision=0;
 async function readStorage<T>(key:string):Promise<T|null>{const p=plugin.value;if(!p)throw Error('Enable Asset Categories in this workspace.');return (await pluginService.getStorage(p.plugin.uuid,key)).value as T|null;}
 async function writeTaxonomy(value:Taxonomy){if(!validTaxonomy(value))throw Error('Invalid category data.');const p=plugin.value;if(!p)throw Error('Plugin is no longer enabled.');await pluginService.setStorage(p.plugin.uuid,{key:taxonomyKey,value});categories.value=value.categories;}
 async function readTaxonomy(){const stored=await readStorage<unknown>(taxonomyKey);if(stored!==null&&!validTaxonomy(stored))throw Error('Invalid category data; nothing overwritten.');return stored===null?defaults():stored as Taxonomy;}
 async function refresh(){const rev=++revision;error.value='';if(!api.value){categories.value=[];return;}try{const t=await readTaxonomy();if(rev===revision)categories.value=t.categories;}catch(e){if(rev===revision){categories.value=[];error.value=e instanceof Error?e.message:'Categories could not be loaded.';}throw e;}}
 watch(api,()=>{void refresh().catch(()=>{});},{immediate:true});
 return {api,categories,error,refresh,readStorage,readTaxonomy,writeTaxonomy};
}
