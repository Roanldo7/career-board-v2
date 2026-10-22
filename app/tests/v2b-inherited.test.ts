import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {paginate,projection,filtered,keyOf,toggleSelection,selectedScope,assessmentDone,scopedExport,tableExport} from '../src/presentation';
import {resolveURL} from '../src/url';
import {Board} from '../electron/services/board';
import {Storage} from '../electron/services/storage';
// @ts-expect-error JavaScript fixture has no declarations; values are synthetic only.
import {syntheticData} from './v2b-fixtures.mjs';

const base=process.env.V2B_TEST_WORK;
if(!base||!path.isAbsolute(base))throw Error('V2B_TEST_WORK absolute isolated directory is required');
await fs.mkdir(base,{recursive:true});
async function setup(){const dir=await fs.mkdtemp(path.join(base!,'inherited-'));await fs.writeFile(path.join(dir,'career-board.json'),JSON.stringify(syntheticData()));const storage=new Storage(dir),board=new Board(storage);await board.load();return {dir,storage,board,send:(c:any)=>board.execute({id:randomUUID(),...c})};}

test('INH01: original pagination, serial numbering, typed selection and export scope',()=>{
 const d=syntheticData(),rows=filtered(d,projection(d,'杭州'),{}),page=paginate(d,rows,{},false,1);
 assert.equal(page.parts.length,4);assert.equal(page.pageRows.length,5);assert.equal(page.pages,9);
 const eighth=paginate(d,rows,{},false,8);assert.equal(eighth.current,8);assert.equal(eighth.pageRows.length,4);assert.equal(eighth.serial.get(keyOf(eighth.pageRows[0])),30);
 const flat=paginate(d,rows,{layout:'flat'},false,2);assert.equal(flat.pageRows.length,10);assert.equal(flat.serial.get(keyOf(flat.pageRows[0])),11);
 const applications=paginate(d,projection(d,'applications'),{},true,2);assert.equal(applications.pageRows.length,2);assert.equal(applications.serial.get(keyOf(applications.pageRows[0])),13);
 assert.equal(paginate(d,[],{},false,999).current,1);assert.equal(paginate(d,rows,{},false,999).current,9);
 let selected=toggleSelection([],flat.pageRows);selected=toggleSelection(selected,eighth.pageRows);assert.equal(selected.length,14);assert.equal(selectedScope(rows,selected).length,14);
 assert.notEqual(keyOf({record_kind:'job',id:'same'}),keyOf({record_kind:'lead',id:'same'}));
 const scope=selectedScope(rows,selected),json=scopedExport(d,scope,false);assert.equal(json.jobs.length,14);assert.equal(json.applications.length,0);assert.equal(tableExport(scope,false).length,14);assert.equal((json as any).format,'career-board-table-export');
});

test('INH02: URL normalization preserves original query/token spelling and rejects unsafe schemes',()=>{
 for(const raw of ['www.example.com','careers.example.com/jobs?id=1','//example.com/A?Token=Ab%2f&b=2#X','http://EXAMPLE.com/A?Token=A%2fb&x=1#X','https://例子.中国/路径']){const r=resolveURL(raw);assert.equal(r.valid,true,raw);assert.equal(r.normalized,raw.startsWith('//')?'https:'+raw:/^http/.test(raw)?raw:'https://'+raw);}
 for(const raw of ['1','文字说明','javascript:alert(1)','data:text/plain,1','file:///C:/a','vbscript:x','ftp://example.com','C:\\foo','\\\\server','https://u:p@example.com','https://example.com/\nABC','a..com','-a.com'])assert.equal(resolveURL(raw).valid,false,raw);
});

test('INH03: assessment completion uses explicit status/history, not interview inference',()=>{
 assert.equal(assessmentDone({status:'待一面'}),false);assert.equal(assessmentDone({status:'待一面',next_action:'待测评'}),false);
 assert.equal(assessmentDone({status:'待一面',status_history:[{from:'已测评',to:'待笔试'}]}),true);assert.equal(assessmentDone({status:'已测评'}),true);
});

test('INH04: bulk registration remains atomic, retry/concurrency idempotent and interview fields intact',async()=>{
 const {storage,board,send}=await setup();const initial=(await board.load()).data!;const old=structuredClone(initial.applications[0]);
 const targets=[{kind:'job',record_id:'SYN-J01'},{kind:'job',record_id:'SYN-J15'},{kind:'job',record_id:'SYN-J16'}];
 const before=await fs.readFile(storage.file,'utf8');await send({type:'preview_register_many',targets});assert.equal(await fs.readFile(storage.file,'utf8'),before);
 const save=storage.save.bind(storage);storage.save=async()=>{throw Error('synthetic disk failure');};await assert.rejects(()=>send({type:'register_many',targets}),/synthetic disk failure/);assert.equal(await fs.readFile(storage.file,'utf8'),before);storage.save=save;
 const id=randomUUID(),done=await send({id,type:'register_many',targets});assert.equal(done.results.filter((r:any)=>r.result==='created').length,2);assert.deepEqual(done.data.applications[0],old);
 await board.checkpoint(done.data.revision);await assert.rejects(()=>board.checkpoint(-1));const written=await fs.readFile(storage.file,'utf8');const retry=await send({id,type:'register_many',targets});assert.equal(retry.undo,done.undo);
 const concurrent=await Promise.all([send({type:'register_many',targets}),send({type:'register_many',targets})]);assert.equal(concurrent[0].undo,done.undo);assert.equal(concurrent[1].undo,done.undo);assert.equal(await fs.readFile(storage.file,'utf8'),written);
 await send({type:'undo'});assert.deepEqual((await board.load()).data!.applications,initial.applications);await send({type:'redo'});assert.equal((await board.load()).data!.applications.length,16);
});

test('INH05: source deletion never cascades; recycle restore and purge barrier retained',async()=>{
 const {board,send}=await setup();const old=structuredClone((await board.load()).data!.applications[0]);
 await send({type:'batch',operations:[{collection:'jobs',record_id:'SYN-J01',action:'delete'}]});assert.deepEqual((await board.load()).data!.applications[0],old);
 await send({type:'batch',operations:[{collection:'jobs',record_id:'SYN-J01',action:'restore'}]});assert.ok(!(await board.load()).data!.jobs[0].deleted_at);
 await send({type:'batch',operations:[{collection:'applications',record_id:old.id,action:'delete'}]});await send({type:'batch',operations:[{collection:'applications',record_id:old.id,action:'restore'}]});const restored={...(await board.load()).data!.applications[0]};assert.equal(restored.deleted_at,null);delete restored.deleted_at;assert.deepEqual(restored,old);
 await send({type:'batch',operations:[{collection:'applications',record_id:old.id,action:'delete'}]});const purged=await send({type:'batch',confirm:true,operations:[{collection:'applications',record_id:old.id,action:'purge'}]});assert.equal(purged.undo,0);assert.equal(purged.redo,0);assert.ok(purged.data.tombstones.some((t:any)=>t.id===old.id));
 assert.equal((await send({type:'undo'})).result,'no_change');assert.equal((await send({type:'register',kind:'job',record_id:'SYN-J01'})).result,'in_trash');
});
