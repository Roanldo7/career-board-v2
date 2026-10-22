import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Storage} from '../electron/services/storage';
import {Board} from '../electron/services/board';
import {emptyData} from '../electron/services/migration-v2';
import {fullBackup} from '../electron/services/full-backup';
import {preparePersonalDirectory} from '../electron/services/personal-profile';

const root=process.env.CAREER_TEST_ROOT;
if(!root||!/(?:V2B_HF01_|V2C_)\d{8}_\d{6}/.test(path.resolve(root)))throw Error('HF01 recovery tests require this run synthetic CAREER_TEST_ROOT');
const base=path.join(root,'recovery-tests');await fs.mkdir(base,{recursive:true});
const broken=Buffer.from('{synthetic malformed\n\u0000raw bytes');
function source(){const d=emptyData();d.extension={null_value:null,false_value:false,zero:0,list:['synthetic',{}]};return d;}
async function setup(mode:'corrupt'|'missing'|'normal'='corrupt'){
 const dir=await fs.mkdtemp(path.join(base,'owned-'));preparePersonalDirectory(dir);
 await fs.mkdir(path.join(dir,'backups'));const value=source();await fs.writeFile(path.join(dir,'backups','career-board_good.json'),JSON.stringify(value));
 if(mode==='corrupt')await fs.writeFile(path.join(dir,'career-board.json'),broken);
 if(mode==='normal')await fs.writeFile(path.join(dir,'career-board.json'),JSON.stringify(value));
 preparePersonalDirectory(dir);const storage=new Storage(dir),board=new Board(storage),loaded=await board.load();return{dir,storage,board,loaded,value};
}
async function raw(file:string){return fs.readFile(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});}
test('HF-R01 corrupt target local and external backups preserve raw evidence and restore exact fields',async()=>{
 for(const kind of ['local','external']){
  const x=await setup();assert.equal(x.loaded.data,null);assert.equal(x.loaded.recovery?.kind,'corrupt');assert.equal(x.loaded.recovery?.canRestore,true);
  assert.deepEqual(await raw(x.storage.file),broken);assert.deepEqual((await fs.readdir(x.dir)).sort(),['backups','career-board-owner.json','career-board.json']);
  const preview=kind==='local'?await x.board.previewBackup('career-board_good.json'):await x.board.previewRestore(JSON.stringify(fullBackup(x.value,'manual')),'external.json');
  assert.equal(preview.target_kind,'corrupt');assert.equal(preview.target_revision,-1);assert.equal(preview.target_summary,null);
  assert.deepEqual(await x.board.confirmRestore(preview.token,-1),x.value);assert.deepEqual((await new Board(new Storage(x.dir)).load()).data,x.value);
  const evidence=await fs.readdir(path.join(x.dir,'recovery-evidence'));assert.equal(evidence.length,2);assert.deepEqual(await fs.readFile(path.join(x.dir,'recovery-evidence',evidence.find(n=>n.endsWith('.bin'))!)),broken);
  assert.ok((await x.storage.listDetails()).every(e=>!e.name.includes('recovery-')));await assert.rejects(()=>x.board.assertRecoveryExit(),/正常保存退出/);
 }
});
test('HF-R02 missing owned target with material never initializes empty; missing evidence and source survive',async()=>{
 const x=await setup('missing');assert.equal(x.loaded.data,null);assert.equal(x.loaded.recovery?.kind,'missing');assert.equal(await raw(x.storage.file),null);
 const preview=await x.board.previewBackup('career-board_good.json');assert.equal(preview.target_kind,'missing');assert.deepEqual(await x.board.confirmRestore(preview.token,-1),x.value);
 const evidence=await fs.readdir(path.join(x.dir,'recovery-evidence'));assert.equal(evidence.length,1);const meta=JSON.parse(await fs.readFile(path.join(x.dir,'recovery-evidence',evidence[0]),'utf8'));assert.equal(meta.target.exists,false);assert.equal(meta.raw_file,null);assert.equal(meta.not_a_business_backup,true);
 assert.deepEqual(JSON.parse(await x.storage.readBackup('career-board_good.json')),x.value);
});
test('HF-R02 fresh empty target and normal target keep original initialization/revision barriers',async()=>{
 const dir=await fs.mkdtemp(path.join(base,'fresh-'));preparePersonalDirectory(dir);const board=new Board(new Storage(dir)),loaded=await board.load();assert.equal(loaded.data?.jobs.length,0);assert.equal(loaded.recovery,undefined);
 const p=await board.previewRestore(JSON.stringify(source()),'valid.json');assert.equal(p.target_kind,'normal');assert.ok(p.target_summary);
 await board.execute({id:randomUUID(),type:'settings',fields:{stale_days:9}});await assert.rejects(()=>board.confirmRestore(p.token,p.target_revision),/目标数据已变化/);
 const re=await board.refreshRestorePreview(p.token);await board.confirmRestore(re.token,re.target_revision);
});
test('HF-R02 unknown ownership and future target refuse overwrite; blocked diagnostic can safely exit',async()=>{
 const alien=await fs.mkdtemp(path.join(base,'alien-'));await fs.writeFile(path.join(alien,'career-board.json'),broken);assert.throws(()=>preparePersonalDirectory(alien),/归属/);
 const ab=new Board(new Storage(alien));assert.equal((await ab.load()).recovery?.canRestore,false);await assert.rejects(()=>ab.previewRestore(JSON.stringify(source()),'valid.json'),/不允许/);assert.deepEqual(await raw(path.join(alien,'career-board.json')),broken);await ab.assertRecoveryExit();
 const x=await setup();const future=Buffer.from(JSON.stringify({...source(),version:999}));await fs.writeFile(x.storage.file,future);const b=new Board(x.storage);assert.equal((await b.load()).recovery?.kind,'blocked');await assert.rejects(()=>b.previewRestore(JSON.stringify(source()),'valid.json'),/不允许/);assert.deepEqual(await raw(x.storage.file),future);await b.assertRecoveryExit();
 const invalid=source();invalid.jobs=[{id:'J-bad',employer_id:'E-missing',company_name:'合成公司',job_title:'合成岗位',location_text:'杭州',city_group:'杭州',priority:'A'}];const bytes=Buffer.from(JSON.stringify(invalid));await fs.writeFile(x.storage.file,bytes);const invalidBoard=new Board(x.storage);assert.equal((await invalidBoard.load()).recovery?.kind,'blocked');await invalidBoard.assertRecoveryExit();assert.deepEqual(await raw(x.storage.file),bytes);
});
test('HF-R02 main/backup links and read denial remain protected, not recoverable corruption',async(t)=>{
 const x=await setup(),outside=await fs.mkdtemp(path.join(base,'link-target-'));const linked=path.join(x.dir,'linked');await fs.symlink(outside,linked,'junction');
 assert.throws(()=>preparePersonalDirectory(linked),/链接/);
 const y=await setup();await t.test('backup file symlink is refused when local privilege permits creating fixture',async(sub)=>{const backupLink=path.join(y.storage.backups,'career-board_link.json');try{await fs.symlink(path.join(y.storage.backups,'career-board_good.json'),backupLink,'file');}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM'){sub.skip('Windows file-symlink fixture unavailable; directory junction boundary is tested above');return;}throw e;}await assert.rejects(()=>y.storage.readBackup('career-board_link.json'),/链接/);});
 const read=fs.readFile;fs.readFile=(async(file:any,...args:any[])=>{if(String(file)===x.storage.file)throw Object.assign(Error('synthetic denied'),{code:'EACCES'});return(read as any)(file,...args);}) as typeof fs.readFile;
 try{const result=await new Board(x.storage).load();assert.equal(result.recovery?.kind,'blocked');assert.equal(result.recovery?.canRestore,false);}finally{fs.readFile=read;}
 assert.deepEqual(await raw(x.storage.file),broken);
});
test('HF-R04 cancel and invalid source do not touch corrupt target or create protection snapshots',async()=>{
 const x=await setup();await x.board.previewBackup('career-board_good.json'); // cancellation = no confirm request
 for(const bytes of ['{bad',JSON.stringify({...source(),version:999}),JSON.stringify({...source(),revision:-1})])await assert.rejects(()=>x.board.previewRestore(bytes,'bad.json'));
 assert.deepEqual(await raw(x.storage.file),broken);assert.equal(await fs.access(path.join(x.dir,'recovery-evidence')).then(()=>true,()=>false),false);await x.board.assertRecoveryExit();
});
test('HF-R04 changed bytes, missing-state or owner require fresh preview and never overwrite',async()=>{
 for(const mode of ['bytes','missing','owner']){
  const x=await setup(mode==='missing'?'missing':'corrupt'),p=await x.board.previewBackup('career-board_good.json');
  if(mode==='owner')await fs.writeFile(path.join(x.dir,'career-board-owner.json'),JSON.stringify({appId:'other',format:1}));else await fs.writeFile(x.storage.file,mode==='missing'?JSON.stringify(source()):'{new synthetic edit');
  const current=await raw(x.storage.file);await assert.rejects(()=>x.board.confirmRestore(p.token,-1),/已变化/);assert.deepEqual(await raw(x.storage.file),current);
  if(mode==='bytes'){const fresh=await x.board.refreshRestorePreview(p.token);assert.deepEqual(await x.board.confirmRestore(fresh.token,-1),x.value);}
 }
});
test('HF-R04 protection failure and changes during protection preserve original or new external bytes',async()=>{
 const x=await setup(),p=await x.board.previewBackup('career-board_good.json'),protect=(x.storage as any).protectRecovery;
 (x.storage as any).protectRecovery=async()=>{throw Error('synthetic protection denied');};await assert.rejects(()=>x.board.confirmRestore(p.token,-1),/保护未完成/);assert.deepEqual(await raw(x.storage.file),broken);
 (x.storage as any).protectRecovery=async(...args:any[])=>{const result=await protect.apply(x.storage,args);await fs.writeFile(x.storage.file,'{external changed during protection');return result;};
 await assert.rejects(()=>x.board.confirmRestore(p.token,-1),/已变化/);assert.equal((await raw(x.storage.file))?.toString(),'{external changed during protection');
 (x.storage as any).protectRecovery=protect;
});
test('HF-R04 rename and readback failures roll back exact corrupt bytes or absence',async()=>{
 for(const mode of ['corrupt','missing'] as const)for(const fault of ['rename','readback']){
  const x=await setup(mode),p=await x.board.previewBackup('career-board_good.json'),rename=fs.rename,read=x.storage.readExact.bind(x.storage);let once=true;
  if(fault==='rename')fs.rename=async(from,to)=>{if(once&&String(from)===x.storage.file+'.tmp'){once=false;throw Error('synthetic rename failure');}return rename(from,to);};
  else x.storage.readExact=async()=>{if(once){once=false;throw Error('synthetic readback failure');}return read();};
  try{await assert.rejects(()=>x.board.confirmRestore(p.token,-1),/已恢复操作前原字节或缺失状态/);}finally{fs.rename=rename;x.storage.readExact=read;}
  assert.deepEqual(await raw(x.storage.file),mode==='corrupt'?broken:null);assert.equal((await x.board.load()).data,null);
  const retry=await x.board.previewBackup('career-board_good.json');assert.deepEqual(await x.board.confirmRestore(retry.token,-1),x.value);
 }
});
test('HF-R04 rollback refuses foreign changed contents and locks further writes',async()=>{
 const x=await setup(),p=await x.board.previewBackup('career-board_good.json'),read=x.storage.readExact.bind(x.storage);
 x.storage.readExact=async()=>{await fs.writeFile(x.storage.file,'{foreign new content');throw Error('synthetic readback conflict');};
 await assert.rejects(()=>x.board.confirmRestore(p.token,-1),/已锁定/);x.storage.readExact=read;assert.equal((await raw(x.storage.file))?.toString(),'{foreign new content');await assert.rejects(()=>x.board.previewBackup('career-board_good.json'),/已锁定/);
});
test('HF-R03 no-write exit only after diagnostic load and outside queued or running restore',async()=>{
 const x=await setup();await x.board.assertRecoveryExit();const unopened=new Board(new Storage(x.dir));await assert.rejects(()=>unopened.assertRecoveryExit(),/正常保存退出/);
 const p=await x.board.previewBackup('career-board_good.json'),commit=x.storage.commitRestore.bind(x.storage);let release!:()=>void;const pause=new Promise<void>(r=>{release=r;});x.storage.commitRestore=async(...args)=>{await pause;return commit(...args);};
 const pending=x.board.confirmRestore(p.token,-1);await assert.rejects(()=>x.board.assertRecoveryExit(),/正常保存退出/);release();await pending;await assert.rejects(()=>x.board.assertRecoveryExit(),/正常保存退出/);
});
test('HF-R03 schema1 migration save failure remains blocked with no-write exit and original bytes',async()=>{
 const x=await setup('normal'),legacy=source();legacy.version=1;const before=Buffer.from(JSON.stringify(legacy));await fs.writeFile(x.storage.file,before);
 x.storage.save=async()=>{throw Error('synthetic migration save denied');};const board=new Board(x.storage),loaded=await board.load();assert.equal(loaded.data,null);assert.equal(loaded.recovery?.kind,'blocked');assert.equal(loaded.recovery?.canRestore,false);assert.match(loaded.recovery?.message||'',/兼容载入写入未完成/);await board.assertRecoveryExit();assert.deepEqual(await raw(x.storage.file),before);
});
test('HF-U02 raw recovery evidence survives ordinary auto backup rotation',async()=>{
 const x=await setup(),p=await x.board.previewBackup('career-board_good.json');await x.board.confirmRestore(p.token,-1);const files=await fs.readdir(path.join(x.dir,'recovery-evidence'));
 for(let i=0;i<14;i++)await x.board.execute({id:randomUUID(),type:'settings',fields:{stale_days:20+i}});
 assert.deepEqual(await fs.readdir(path.join(x.dir,'recovery-evidence')),files);assert.equal((await x.storage.listDetails()).filter(e=>e.kind==='auto').length,10);assert.deepEqual(await fs.readFile(path.join(x.dir,'recovery-evidence',files.find(n=>n.endsWith('.bin'))!)),broken);
});
