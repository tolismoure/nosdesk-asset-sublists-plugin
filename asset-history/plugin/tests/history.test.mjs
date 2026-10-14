import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountHistory} from '../src/plugin.mjs';
import {displayDiff, valueText, dateBounds} from '../src/model.mjs';

const row = (id, fields = {}) => ({id: String(id), table_name: 'assets', pk_text: '12', op: 'U', actor_uuid: null, actor_name: null, occurred_at: '2026-10-13T01:02:03Z', source: 'asset', scope: 'asset', before: null, after: null, diff: [{field:'quantity', old: 0, new: 1, old_present: true, new_present: true}], ...fields});
const result = (rows, next_cursor = null) => ({rows, next_cursor, asset_id: 12, retention_days: 540, related_capture_since: '2026-10-13T00:00:00Z', category_changes_included: false});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(api, context = {asset:{id:12,name:'Computer 12'},component:{slot:'asset.info.panel'}}) {
  const dom = new JSDOM('<main></main>', {url:'https://example.test/'}), root = dom.window.document.querySelector('main');
  const controller = mountHistory(root, api, context);
  return {dom, root, controller, button:text => [...root.querySelectorAll('button')].find(node=>node.textContent===text)};
}
function noWrites() {
  return {update(){throw Error('Asset update must not be called');}, set(){throw Error('Storage set must not be called');}, delete(){throw Error('Delete must not be called');}};
}

test('nested JSON changes preserve absence, null, false, zero and whole arrays', () => {
  const changes = displayDiff(row('1', {diff:[{field:'attributes', old:{ram:8, flag:true, removed:null, nested:{quantity:1}, list:['a','b']}, new:{ram:0,flag:false,added:null,nested:{quantity:0},list:['b']}, old_present:true, new_present:true}]}));
  assert.deepEqual(changes.map(change=>change.field), ['attributes.ram','attributes.flag','attributes.removed','attributes.nested.quantity','attributes.list','attributes.added']);
  assert.equal(changes.find(change=>change.field==='attributes.removed').new_present, false);
  assert.equal(changes.find(change=>change.field==='attributes.added').new_present, true);
  assert.equal(valueText(null, false), 'Not present'); assert.equal(valueText(null, true), 'null');
  assert.equal(valueText(false), 'false'); assert.equal(valueText(0), '0');
  assert.match(valueText(changes.find(change=>change.field==='attributes.list').old), /"a"/);
});

test('category snapshots identify names, checkbox changes and global scope honestly', async () => {
  const before = {version:1,categories:[{id:'computers',name:'Computers',selectedAttributes:['field:model'],children:[]}]};
  const after = {version:1,categories:[{id:'computers',name:'Laptops',selectedAttributes:['field:model','attribute:RAM'],children:[{id:'staff',name:'Staff',selectedAttributes:[]}]}]};
  const entry = row('taxonomy', {table_name:'plugin_data',source:'category_configuration',scope:'category_global',before,after,diff:[]});
  const fixture = setup({assets:{history:async()=>result([entry])}}); await fixture.controller.ready;
  assert.match(fixture.root.textContent, /Global category configuration/);
  assert.match(fixture.root.textContent, /Selected attribute checkboxes/);
  assert.match(fixture.root.textContent, /Computers/); assert.match(fixture.root.textContent, /Laptops/);
  assert.match(fixture.root.textContent, /Subcategory: Laptops \/ Staff/);
  fixture.controller.unmount();
});

test('assignments display stored IDs rather than substituting current category names', async () => {
  const entry = row('assignment', {source:'sublist_assignment',before:{category:'computers',subcategory:''},after:{category:'pdus',subcategory:'rack1'},diff:[]});
  const fixture = setup({assets:{history:async()=>result([entry])}}); await fixture.controller.ready;
  assert.match(fixture.root.textContent, /Category ID/); assert.match(fixture.root.textContent, /computers/); assert.match(fixture.root.textContent, /pdus/);
  assert.match(fixture.root.textContent, /values stored at the time/);
  fixture.controller.unmount();
});

test('moving a subcategory preserves its identity and records the parent change', () => {
  const child = {id:'staff',name:'Staff',selectedAttributes:[]};
  const before = {version:1,categories:[{id:'computers',name:'Computers',children:[child]},{id:'pdus',name:'PDUs',children:[]}]};
  const after = {version:1,categories:[{id:'computers',name:'Computers',children:[]},{id:'pdus',name:'PDUs',children:[child]}]};
  const changes = displayDiff(row('move',{source:'category_configuration',before,after}));
  const moved = changes.find(change=>change.field.includes('Parent category'));
  assert.equal(moved.old,'Computers (computers)'); assert.equal(moved.new,'PDUs (pdus)');
});

test('best-effort assignment names retain their original IDs and unresolved names remain IDs', () => {
  const entry = row('labels',{source:'sublist_assignment',before:{category:'computers',subcategory:'old-child'},after:{category:'pdus',subcategory:'rack1'},assignment_labels:{before:{category:'Computers',subcategory:null},after:{category:'Power units',subcategory:'Rack one'}}});
  const changes = displayDiff(entry);
  assert.equal(changes.find(change=>change.field==='Category ID').old,'Computers (ID: computers)');
  assert.equal(changes.find(change=>change.field==='Category ID').new,'Power units (ID: pdus)');
  assert.equal(changes.find(change=>change.field==='Subcategory ID').old,'old-child');
  assert.equal(changes.find(change=>change.field==='Subcategory ID').new,'Rack one (ID: rack1)');
});

test('stale responses from an earlier asset cannot replace the current asset history', async () => {
  const first = deferred(), second = deferred(), calls = [];
  const fixture = setup({assets:{history:(id)=>{calls.push(id); return id===12?first.promise:second.promise;}}});
  const update = fixture.controller.update({asset:{id:13,name:'PDU 13'},component:{slot:'asset.info.panel'}});
  second.resolve(result([row('second',{diff:[{field:'name',old:'Old PDU',new:'Current PDU',old_present:true,new_present:true}]})])); await update;
  first.resolve(result([row('first',{diff:[{field:'name',old:'Wrong old computer',new:'Wrong computer',old_present:true,new_present:true}]})])); await fixture.controller.ready;
  assert.deepEqual(calls,[12,13]); assert.match(fixture.root.textContent,/Current PDU/); assert.doesNotMatch(fixture.root.textContent,/Wrong computer/);
  fixture.controller.unmount();
});

test('paging deduplicates IDs and preserves prior rows on a retryable failure', async () => {
  let calls = 0;
  const fixture = setup({assets:{history:async(_id,query)=>{calls++; if(calls===1)return result([row('one')],'cursor-1'); assert.equal(query.cursor,'cursor-1'); if(calls===2)throw Error('Temporary server failure'); return result([row('one'),row('two')]);}}});
  await fixture.controller.ready; fixture.button('Load more').click(); await tick();
  assert.match(fixture.root.textContent,/Earlier records are still shown/); assert.equal(fixture.root.querySelectorAll('article').length,1);
  fixture.button('Load more').click(); await tick();
  assert.equal(fixture.root.querySelectorAll('article').length,2); assert.match(fixture.root.textContent,/2 matching records \/ 2 loaded/);
  fixture.controller.unmount();
});

test('loaded-record filters and copy export do not claim a complete history', async () => {
  const a = row('1',{actor_name:'Jane Brown'}), b = row('2',{actor_name:'Alex Smith',op:'D'});
  const fixture = setup({assets:{history:async()=>result([a,b],'older')}}); await fixture.controller.ready;
  const search = fixture.root.querySelector('input[type=search]'); search.value='Jane'; search.dispatchEvent(new fixture.dom.window.Event('input'));
  assert.equal(fixture.root.querySelectorAll('article').length,1);
  fixture.button('Show JSON for copying').click();
  const copied = JSON.parse(fixture.root.querySelector('textarea').value);
  assert.equal(copied.rows.length,1); assert.equal(copied.more_records_available,true); assert.match(copied.description,/currently loaded and filtered/);
  assert.match(fixture.root.textContent,/filters apply only to the records already loaded/);
  fixture.controller.unmount();
});

test('new server scope clears old rows, including when the new request fails', async () => {
  const calls = [];
  const fixture = setup({assets:{history:async(_id,query)=>{calls.push(query); if(calls.length===1)return result([row('old')],'older'); throw Error('No response');}}});
  await fixture.controller.ready;
  const dates = [...fixture.root.querySelectorAll('input[type=date]')]; dates[0].value='2026-10-01'; dates[1].value='2026-10-12';
  fixture.root.querySelector('input[type=checkbox]').checked=true;
  fixture.button('Apply dates and category scope').click(); await tick();
  assert.equal(calls[1].since,'2026-10-01T00:00:00.000Z'); assert.equal(calls[1].until,'2026-10-13T00:00:00.000Z'); assert.equal(calls[1].include_category_changes,true);
  assert.equal(fixture.root.querySelectorAll('article').length,0);
  assert.equal(fixture.button('Show JSON for copying').disabled,true);
  assert.throws(()=>dateBounds('2026-10-12','2026-10-01'),/start date/);
  fixture.controller.unmount();
});

test('missing bridge and denied access explain the actual required extension and policy', async () => {
  const missing = setup({assets:{}}); await missing.controller.ready;
  assert.match(missing.root.textContent,/host extension is required/); missing.controller.unmount();
  const denied = setup({assets:{history:async()=>{throw {status:403,message:'Forbidden'};}}}); await denied.controller.ready;
  assert.match(denied.root.textContent,/workspace administrator/); denied.controller.unmount();
});

test('the manager opens deleted IDs and every operation is read-only', async () => {
  const calls = [], writes = noWrites();
  const fixture = setup({assets:{list:async()=>[{id:12,name:'Current computer'}],history:async(id,query)=>{calls.push({id,query});return result([row('deleted',{op:'D',diff:[{field:'name',old:'Removed asset',new:null,old_present:true,new_present:false}]})]);},update:writes.update},storage:{set:writes.set,delete:writes.delete}}, {component:{slot:'nav.item'}});
  await fixture.controller.ready;
  const idInput = fixture.root.querySelector('input[type=number]'); idInput.value='93'; fixture.button('Open history').click(); await tick();
  assert.equal(calls[0].id,93); assert.equal(calls[0].query.include_category_changes,false);
  assert.match(fixture.root.textContent,/Removed asset/); assert.match(fixture.root.textContent,/Not present/);
  fixture.button('Refresh').click(); await tick(); fixture.button('Show JSON for copying').click();
  assert.equal(calls.length,2); fixture.controller.unmount();
});

test('unmount cancels DOM effects of pending reads and renders values as text', async () => {
  const pending = deferred(), fixture = setup({assets:{history:()=>pending.promise}});
  fixture.controller.unmount(); pending.resolve(result([row('late')])); await fixture.controller.ready;
  assert.equal(fixture.root.childNodes.length,0);
  const escaped = setup({assets:{history:async()=>result([row('unsafe',{diff:[{field:'notes',old:null,new:'<img src=x onerror=alert(1)>',old_present:false,new_present:true}]})])}});
  await escaped.controller.ready; assert.equal(escaped.root.querySelectorAll('img').length,0); assert.match(escaped.root.textContent,/<img src=x/);
  escaped.controller.unmount();
});
