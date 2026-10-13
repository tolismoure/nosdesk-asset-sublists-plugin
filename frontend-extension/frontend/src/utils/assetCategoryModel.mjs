export const taxonomyKey='taxonomy-v1';
export const assignmentKey=id=>'asset-'+id+'-category-v1';
export const defaults=()=>({version:1,categories:[]});
export const fallbackFields=['field:kind','field:model','field:serial_number'];
const baseFields=['id','kind','serial_number','model','manufacturer','location','status','primary_user_uuid','created_at','updated_at','purchase_date','asset_tag','quantity','unit','external_sync_source','low_stock_threshold','is_editable','primary_user','groups'];
export function validFieldId(s){return typeof s==='string'&&s.length<=512&&(/^(field|attribute):.+$/s).test(s)&&s!=='field:name'&&s!=='field:attributes';}
export function validTaxonomy(t){
 if(!t||t.version!==1||!Array.isArray(t.categories))return false;const ids=new Set();
 const valid=x=>x&&typeof x.id==='string'&&/^[a-z0-9-]{1,80}$/.test(x.id)&&!ids.has(x.id)&&ids.add(x.id)&&typeof x.name==='string'&&x.name.trim().length>0&&x.name.length<=80&&(x.selectedAttributes===undefined||(Array.isArray(x.selectedAttributes)&&x.selectedAttributes.length<=500&&x.selectedAttributes.every(validFieldId)&&new Set(x.selectedAttributes).size===x.selectedAttributes.length));
 return t.categories.length<=100&&t.categories.every(c=>valid(c)&&Array.isArray(c.children)&&c.children.length<=100&&c.children.every(valid));
}
export function normalizeAssignment(a,t){const c=t.categories.find(c=>c.id===a?.category);return {category:c?.id||'',subcategory:c?.children.some(s=>s.id===a?.subcategory)?a.subcategory:''};}
export function filteredAssets(assets,assignments,category,subcategory,query){const q=query.trim().toLowerCase();return assets.filter(a=>{const x=assignments[a.id]||{};return(category==='*'||(category===''?!x.category:x.category===category))&&(!subcategory||x.subcategory===subcategory)&&[a.name,a.serial_number,a.model,a.asset_tag].some(v=>String(v??'').toLowerCase().includes(q));});}
export async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i]);}}));return out;}
export function fieldLabel(id){const [prefix,...rest]=id.split(':');const key=rest.join(':');return (prefix==='attribute'?'Attribute: ':'')+key.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());}
export function attributeCatalog(assets=[],kinds=[],saved=[]){const map=new Map();const add=(id,label,source)=>{if(!validFieldId(id))return;const entry=map.get(id)||{id,label:label||fieldLabel(id),sources:[]};if(label)entry.label=label;if(!entry.sources.includes(source))entry.sources.push(source);map.set(id,entry);};
 for(const key of baseFields)add('field:'+key,null,'Core field');
 for(const kind of kinds){const props=kind?.attribute_schema?.properties;if(props&&typeof props==='object')for(const [key,schema] of Object.entries(props))add('attribute:'+key,typeof schema?.title==='string'?schema.title:null,'Defined: '+(kind.label||kind.slug||'asset kind'));}
 for(const a of assets){if(!a||typeof a!=='object')continue;for(const key of Object.keys(a))if(key!=='name'&&key!=='attributes')add('field:'+key,null,'Present in inventory');if(a.attributes&&typeof a.attributes==='object'&&!Array.isArray(a.attributes))for(const key of Object.keys(a.attributes))add('attribute:'+key,null,'Present in inventory');}
 for(const id of saved)add(id,null,'Previously selected');return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
export function selectedFields(category,childId=''){const entry=childId?category?.children?.find(c=>c.id===childId):category;return entry?.selectedAttributes??category?.selectedAttributes??fallbackFields;}
export function attributeValue(asset,id){const source=id.startsWith('attribute:')?asset?.attributes:asset;const key=id.slice(id.indexOf(':')+1);if(!source||!Object.prototype.hasOwnProperty.call(source,key))return '—';const value=source[key];if(value===null||value===undefined||value==='')return '—';if(typeof value==='object')return JSON.stringify(value);return String(value);}
