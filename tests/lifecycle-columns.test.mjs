import test from 'node:test';
import assert from 'node:assert/strict';
import { latestLifecycleEvent, lifecycleSummary } from '../frontend-extension/frontend/src/utils/assetLifecycleColumns.mjs';
const row = (id,time,reason=null)=>({id,occurred_at:time,from_status:'in_service',to_status:'on_loan',reason});
test('selects latest timestamp regardless of array order and uses record ID for ties',()=>{
 const older=row(9,'2026-10-13T10:00:00Z'),newer=row(2,'2026-10-14T10:00:00Z');
 assert.equal(latestLifecycleEvent([newer,older]),newer);
 assert.equal(latestLifecycleEvent([older,newer]),newer);
 const same=row(3,'2026-10-14T10:00:00Z');assert.equal(latestLifecycleEvent([same,newer]),same);
});
test('compares actual instants including timezone offsets',()=>{
 const earlier=row(1,'2026-10-14T10:00:00+11:00'),later=row(2,'2026-10-14T00:00:00Z');
 assert.equal(latestLifecycleEvent([earlier,later]),later);
});
test('empty timelines do not invent a lifecycle entry',()=>{
 assert.equal(latestLifecycleEvent([]),null);assert.equal(latestLifecycleEvent([row(1,'invalid')]),null);assert.equal(lifecycleSummary(null),'—');
});
test('renders readable transition and reason without requiring a source status',()=>{
 assert.equal(lifecycleSummary(row(1,'2026-10-14T00:00:00Z',' Temporary loan ')),'In service → On loan — Temporary loan');
 assert.equal(lifecycleSummary({...row(1,'2026-10-14T00:00:00Z'),from_status:null}),'On loan');
});
