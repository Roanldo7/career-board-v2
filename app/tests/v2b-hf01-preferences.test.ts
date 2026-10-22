import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Preferences,defaultPreferences,validatePreferences} from '../electron/services/preferences';
import {filtered,projection,sorted} from '../src/presentation';
import {emptyData} from '../electron/services/migration-v2';

const base=process.env.CAREER_TEST_ROOT;
if(!base)throw Error('HF01 preference tests require explicit isolated CAREER_TEST_ROOT');
const valid=():any=>({version:1,activeEntry:'杭州',entries:{'杭州':{page:8,mode:'看板',scroll:{'表格':240,'看板':420},query:{search:'合成',conditions:[{field:'company_name',op:'contains',value:'合成'}],logic:'AND',showClosed:false,group:'priority',groupDesc:false,sort:[{field:'priority',desc:true}],adjacent:true,layout:'flat',bankMode:'all'}}}});
async function fixture(){const dir=path.join(base!,'hf01-preferences',randomUUID());await fs.mkdir(dir,{recursive:true});return{dir,p:new Preferences(dir)};}

test('HF-P01 original valid-JSON counterexamples now preserve bytes, warn and safely filter with full modules',async()=>{
 for(const bad of [null,{field:'company_name',op:'contains',value:123}]){
  const {dir,p}=await fixture(),v=valid();v.entries['杭州'].query.conditions=[bad];
  const bytes=JSON.stringify(v,null,2),business=JSON.stringify(emptyData(),null,2);await fs.writeFile(p.file,bytes);await fs.writeFile(path.join(dir,'career-board.json'),business);
  const result=await p.load();assert.ok(result.warning);assert.deepEqual(result.preferences,defaultPreferences());
  assert.doesNotThrow(()=>filtered(emptyData(),projection(emptyData(),'杭州'),result.preferences.entries['杭州']?.query||{}));
  assert.equal(await fs.readFile(p.file,'utf8'),bytes);const copies=(await fs.readdir(dir)).filter(n=>n.startsWith('ui-preferences.corrupt-'));assert.equal(copies.length,1);assert.equal(await fs.readFile(path.join(dir,copies[0]),'utf8'),bytes);
  assert.equal(await fs.readFile(path.join(dir,'career-board.json'),'utf8'),business);assert.equal((await fs.readdir(dir)).includes('backups'),false);
 }
});

test('HF-P01 all Query and nested Condition/Sort/Scroll field types and enum boundaries are validated',()=>{
 const changes:[string,(v:any)=>void][]=[
  ['entries scalar',v=>v.entries='oops'],['entry null',v=>v.entries['杭州']=null],['query null',v=>v.entries['杭州'].query=null],['query array',v=>v.entries['杭州'].query=[]],
  ['conditions object',v=>v.entries['杭州'].query.conditions={}],['condition array',v=>v.entries['杭州'].query.conditions=[[]]],['field number',v=>v.entries['杭州'].query.conditions[0].field=3],['empty field',v=>v.entries['杭州'].query.conditions[0].field=''],['op boolean',v=>v.entries['杭州'].query.conditions[0].op=false],['unknown op',v=>v.entries['杭州'].query.conditions[0].op='exec'],['end number',v=>v.entries['杭州'].query.conditions[0].end=4],
  ['sort scalar',v=>v.entries['杭州'].query.sort='priority'],['sort null element',v=>v.entries['杭州'].query.sort=[null]],['sort array element',v=>v.entries['杭州'].query.sort=[[]]],['sort numeric field',v=>v.entries['杭州'].query.sort[0].field=3],['sort desc string',v=>v.entries['杭州'].query.sort[0].desc='false'],
  ['search number',v=>v.entries['杭州'].query.search=4],['group object',v=>v.entries['杭州'].query.group={}],['showClosed string',v=>v.entries['杭州'].query.showClosed='false'],['groupDesc number',v=>v.entries['杭州'].query.groupDesc=0],['adjacent null',v=>v.entries['杭州'].query.adjacent=null],['invalid logic',v=>v.entries['杭州'].query.logic='and'],['empty bank mode',v=>v.entries['杭州'].query.bankMode=''],['invalid layout',v=>v.entries['杭州'].query.layout='tree'],
  ['scroll null',v=>v.entries['杭州'].scroll=null],['scroll array',v=>v.entries['杭州'].scroll=[]],['scroll numeric string',v=>v.entries['杭州'].scroll['表格']='42'],['negative scroll',v=>v.entries['杭州'].scroll['表格']=-1],['infinite scroll',v=>v.entries['杭州'].scroll['表格']=Infinity],['NaN scroll',v=>v.entries['杭州'].scroll['表格']=NaN],['invalid mode',v=>v.entries['杭州'].mode='table'],['invalid page',v=>v.entries['杭州'].page=0],['fraction page',v=>v.entries['杭州'].page=1.5],['unsafe page',v=>v.entries['杭州'].page=Number.MAX_SAFE_INTEGER+1],['unknown active entry',v=>v.activeEntry='other']
 ];
 for(const [name,change] of changes){const v=valid();change(v);assert.throws(()=>validatePreferences(v),Error,name);}
 for(const root of [null,[],false,'{}',{version:1,activeEntry:'杭州',entries:null}])assert.throws(()=>validatePreferences(root));
});

test('HF-P02 valid page 8, full query, modes and per-mode scroll survive atomic write/reload without business backup',async()=>{
 const {dir,p}=await fixture(),v=valid();v.entries['南京']={page:2,mode:'表格',scroll:{'表格':80},query:{bankMode:'only',conditions:[{field:'deadline',op:'range',value:'2026-10-01',end:'2026-11-01'}]}};
 const sentinel='synthetic-business-sentinel';await fs.writeFile(path.join(dir,'career-board.json'),sentinel);
 await p.save(v);await p.flush();const reloaded=await new Preferences(dir).load();assert.equal(reloaded.warning,undefined);assert.deepEqual(reloaded.preferences,v);
 const d=emptyData();assert.doesNotThrow(()=>sorted(filtered(d,projection(d,'杭州'),reloaded.preferences.entries['杭州'].query),reloaded.preferences.entries['杭州'].query));
 assert.equal(await fs.readFile(path.join(dir,'career-board.json'),'utf8'),sentinel);assert.equal((await fs.readdir(dir)).includes('backups'),false);
});

test('HF-P01 invalid save rejects before replacing good preferences or creating a temporary/business file',async()=>{
 const {dir,p}=await fixture(),good=valid();await p.save(good);const before=await fs.readFile(p.file,'utf8');const bad=valid();bad.entries['杭州'].query.sort=[{field:'priority',desc:'false'}];assert.throws(()=>p.save(bad));assert.equal(await fs.readFile(p.file,'utf8'),before);assert.deepEqual(await fs.readdir(dir),['ui-preferences.json']);
});

test('HF-P01 diagnostic copy failure blocks preference overwrite until protection succeeds, without blocking business reads',async()=>{
 const {dir,p}=await fixture(),bad=valid();bad.entries['杭州'].query.conditions=[null];
 const raw=JSON.stringify(bad,null,2),business='synthetic-unchanged-business';await fs.writeFile(p.file,raw);await fs.writeFile(path.join(dir,'career-board.json'),business);
 const copy=fs.copyFile;let attempts=0;
 try{
  fs.copyFile=async()=>{attempts++;throw Error('synthetic diagnostic copy failure');};
  const loaded=await p.load();assert.deepEqual(loaded.preferences,defaultPreferences());assert.ok(loaded.warning);
  await assert.rejects(p.save(valid()),/阅读位置未保存/);await assert.rejects(p.flush());
  assert.ok(attempts>=2);assert.equal(await fs.readFile(p.file,'utf8'),raw);assert.equal(await fs.readFile(path.join(dir,'career-board.json'),'utf8'),business);
  assert.match(loaded.warning,/诊断副本未能保存/);assert.equal((await fs.readdir(dir)).includes('backups'),false);
 }finally{fs.copyFile=copy;}
 await p.save(valid());await p.flush();assert.deepEqual((await p.load()).preferences,valid());
 const copies=(await fs.readdir(dir)).filter(n=>n.startsWith('ui-preferences.corrupt-'));assert.equal(copies.length,1);assert.equal(await fs.readFile(path.join(dir,copies[0]),'utf8'),raw);
 assert.equal(await fs.readFile(path.join(dir,'career-board.json'),'utf8'),business);assert.equal((await fs.readdir(dir)).includes('backups'),false);
});
