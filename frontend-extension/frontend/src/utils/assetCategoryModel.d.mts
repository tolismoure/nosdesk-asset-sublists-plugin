export interface Entry {id:string;name:string;selectedAttributes?:string[];assetGroupId?:number|null}
export interface Category extends Entry {children:Entry[]}
export interface Taxonomy {version:1;categories:Category[]}
export interface Field {id:string;label:string;sources:string[]}
export const taxonomyKey:string;
export const fallbackFields:string[];
export function defaults():Taxonomy;
export function assignmentKey(id:number):string;
export function validTaxonomy(value:unknown):value is Taxonomy;
export function validFieldId(value:unknown):boolean;
export function normalizeAssignment(a:unknown,t:Taxonomy):{category:string;subcategory:string};
export function filteredAssets<T>(assets:T[],assignments:Record<number,{category:string;subcategory:string}>,category:string,subcategory:string,query:string,taxonomy?:Taxonomy|null):T[];
export function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>;
export function fieldLabel(id:string):string;
export function attributeCatalog(assets?:unknown[],kinds?:unknown[],saved?:string[]):Field[];
export function selectedFields(category?:Category,childId?:string):string[];
export function attributeValue(asset:unknown,id:string):string;

export function matchesSublist(asset:unknown,assignment:{category:string;subcategory:string}|undefined,category:Category|undefined,childId?:string):boolean;
