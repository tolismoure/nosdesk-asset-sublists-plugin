import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('production bundle exposes the supported DOM mount contract without host framework imports', async () => {
  const source = await readFile(new URL('../payload/bundle.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s*["'](?:vue|@nosdesk|\.\/)/);
  const {default: plugin} = await import('../payload/bundle.js');
  assert.equal(typeof plugin.mount,'function');
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const record = Object.freeze({id:'audit:12', table_name:'assets', op:'U', pk_text:'12', occurred_at:'2026-10-13T00:00:00Z', source:'asset', scope:'asset', diff:Object.freeze([Object.freeze({field:'quantity',old:1,new:0,old_present:true,new_present:true})])});
  const api = {assets:{history:async()=>({rows:Object.freeze([record]),next_cursor:null})}};
  const controller = plugin.mount(root,api,{asset:{id:12,name:'Computer'},component:{slot:'asset.info.panel'}});
  assert.equal(typeof controller.update,'function'); assert.equal(typeof controller.unmount,'function');
  await controller.ready; assert.match(root.textContent,/quantity/); assert.match(root.textContent,/Asset #12/);
  assert.equal(record.diff[0].new,0);
  controller.unmount(); assert.equal(root.childNodes.length,0);
});

test('manifest requests only asset reads and the dedicated history consent', async () => {
  const manifest = JSON.parse(await readFile(new URL('../payload/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['asset:read','asset:history:read']);
  assert.equal(manifest.engines.nosdesk,'=1.1.0');
  assert.equal(manifest.components.AssetHistory.slot,'asset.info.panel');
  assert.equal(manifest.components.HistoryBrowser.slot,'nav.item');
  assert.deepEqual(manifest.events,[]);
});
