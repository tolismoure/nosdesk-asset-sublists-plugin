import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssignmentCard from '@/components/assets/AssetSublistAssignment.vue';
const state = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), refresh: vi.fn() }));
vi.mock('@/composables/useAssetCategoryPlugin', async () => {
 const { ref } = await import('vue');
 return { useAssetCategoryPlugin: () => ({api:ref(true),categories:ref([{id:'laptops',name:'Laptops',assetGroupId:7,children:[{id:'students',name:'Students',assetGroupId:8}]}]),refresh:state.refresh,readStorage:state.read,writeAssignment:state.write}) };
});
const create = (editable=true) => mount(AssignmentCard,{props:{assetId:5,groups:[{id:7,name:'Loan laptops'}],editable},global:{stubs:{SectionCard:{template:'<section><slot name="title"/><slot/></section>'},Button:{props:['disabled','loading'],template:'<button :disabled="disabled||loading"><slot/></button>'}}}});
describe('asset rail assignment',()=>{
 beforeEach(()=>{vi.clearAllMocks();state.read.mockResolvedValue({category:'laptops',subcategory:'students'});state.write.mockResolvedValue(undefined);state.refresh.mockResolvedValue(undefined);});
 it('loads existing assignment and saves the manual dropdown choices',async()=>{
  const view=create();await flushPromises();expect(view.findAll('select')[0].element.value).toBe('laptops');expect(view.findAll('select')[1].element.value).toBe('students');
  await view.findAll('select')[1].setValue('');await view.find('button').trigger('click');await flushPromises();expect(state.write).toHaveBeenCalledWith(5,{category:'laptops',subcategory:''});view.unmount();
 });
 it('clearing manual selection keeps independent group inclusion visible',async()=>{
  const view=create();await flushPromises();await view.find('select').setValue('');await view.find('button').trigger('click');await flushPromises();expect(state.write).toHaveBeenCalledWith(5,{category:'',subcategory:''});expect(view.text()).toContain('Included through asset groups: Laptops');await view.setProps({groups:[]});expect(view.text()).not.toContain('Included through asset groups');view.unmount();
 });
 it('does not overwrite an unreadable assignment',async()=>{
  state.read.mockRejectedValue(new Error('Storage unavailable'));const view=create();await flushPromises();expect(view.find('button').attributes('disabled')).toBeDefined();expect(view.text()).toContain('Storage unavailable');await view.find('button').trigger('click');expect(state.write).not.toHaveBeenCalled();view.unmount();
 });
 it('read-only assets cannot save an assignment',async()=>{
  const view=create(false);await flushPromises();expect(view.find('button').exists()).toBe(false);expect(view.find('select').attributes('disabled')).toBeDefined();view.unmount();
 });
});
