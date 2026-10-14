import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSublist, validTaxonomy, filteredAssets } from '../src/model.mjs';
const category = { id:'laptops',name:'Laptops',assetGroupId:7,children:[{id:'students',name:'Students',assetGroupId:8}] };
const taxonomy = {version:1,categories:[category]};
test('validates optional numeric group link without rejecting old taxonomies',()=>{
 assert.equal(validTaxonomy(taxonomy),true);
 assert.equal(validTaxonomy({version:1,categories:[{id:'x',name:'X',children:[]}]}),true);
 for(const bad of ['7',-1,0,1.2]) assert.equal(validTaxonomy({version:1,categories:[{...category,assetGroupId:bad}]}),false);
});
test('manual and group memberships are additive',()=>{
 assert.equal(matchesSublist({asset_groups:[]},{category:'laptops',subcategory:''},category),true);
 assert.equal(matchesSublist({asset_groups:[{id:7}]},undefined,category),true);
 assert.equal(matchesSublist({asset_groups:[{id:9}]},undefined,category),false);
 assert.equal(matchesSublist({groups:[{id:7}]},undefined,category),false);
});
test('parent includes child group; child requires its own group or manual assignment',()=>{
 const asset={asset_groups:[{id:8}]};
 assert.equal(matchesSublist(asset,undefined,category),true);
 assert.equal(matchesSublist(asset,undefined,category,'students'),true);
 assert.equal(matchesSublist({asset_groups:[{id:7}]},undefined,category,'students'),false);
 assert.equal(matchesSublist({}, {category:'laptops',subcategory:'students'},category,'students'),true);
 assert.equal(matchesSublist(asset,undefined,category,'deleted'),false);
});
test('deduplicates combined membership and excludes group members from uncategorised',()=>{
 const rows=[{id:1,name:'One',asset_groups:[{id:7}]},{id:2,name:'Two',asset_groups:[]}];
 const assignments={1:{category:'laptops',subcategory:''}};
 assert.deepEqual(filteredAssets(rows,assignments,'laptops','','',taxonomy).map(a=>a.id),[1]);
 assert.deepEqual(filteredAssets(rows,assignments,'','','',taxonomy).map(a=>a.id),[2]);
 assert.equal(matchesSublist({asset_groups:[]},undefined,category),false);
});
