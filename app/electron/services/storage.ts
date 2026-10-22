import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {assertData} from '../../src/utils';
import type {CareerData,Job,LoadResult} from '../../src/types';
import type {BackupEntry,FullBackup} from '../../src/backup-types';
import {emptyData} from './migration-v2';
import {fullBackup,parseFullBackup,backupFormat} from './full-backup';
import {assertOwnedDirectory,assertSafePath} from './personal-profile';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export interface RecoveryTarget {kind:'corrupt'|'missing';exists:boolean;sha256:string|null;owner_sha256:string}
export class Storage {
 readonly file:string; readonly backups:string; private queue:Promise<unknown>=Promise.resolve();
 private writeLock:string|null=null;
 constructor(readonly dir:string,readonly seed?:Job[]|CareerData){this.file=path.join(dir,'career-board.json');this.backups=path.join(dir,'backups');}
 private run<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 assertWritable(){if(this.writeLock)throw Error(this.writeLock);}
 private initial():CareerData{if(this.seed&&!Array.isArray(this.seed))return structuredClone(this.seed);const data=emptyData();if(Array.isArray(this.seed))data.jobs=structuredClone(this.seed);return data;}
 async list(){assertSafePath(this.backups);let names:string[];try{names=await fs.readdir(this.backups);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}return names.filter(n=>/^career-board_[\w-]+\.json$/.test(n)).sort().reverse();}
 async listDetails():Promise<BackupEntry[]>{
  const entries:BackupEntry[]=[];
  for(const name of await this.list()){
   try{
    const file=assertSafePath(path.join(this.backups,name)),stat=await fs.stat(file),raw=JSON.parse(await fs.readFile(file,'utf8'));
    if(raw.format===backupFormat&&raw.format_version===1&&raw.backup){
     const b=raw.backup;entries.push({name,kind:b.kind,created_at:b.created_at,note:b.note||'',reason:b.reason||'',snapshot_relation:b.snapshot_relation,snapshot_updated_at:b.snapshot_updated_at??null,data_revision:b.data_revision??null,data_schema:b.data_schema??null,app_version:b.app_version??null,time_source:'metadata'});
    }else{
     assertData(raw);const match=name.match(/^career-board_(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3}Z)_/);
     const created=match?`${match[1]}:${match[2]}:${match[3]}.${match[4]}`:stat.mtime.toISOString();
     entries.push({name,kind:'legacy_unknown',created_at:created,note:'旧版备份·类型未记录',reason:'旧格式未记录',snapshot_relation:'unknown',snapshot_updated_at:raw.metadata?.updated_at??null,data_revision:raw.revision??null,data_schema:raw.version,app_version:null,time_source:match?'filename':'filesystem'});
    }
   }catch{/* Malformed files stay untouched and are not offered as valid backups. */}
  }
  return entries.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.name.localeCompare(a.name));
 }
 private async writeEnvelope(value:FullBackup):Promise<BackupEntry>{
  assertSafePath(this.backups);
  await fs.mkdir(this.backups,{recursive:true});
  const b=value.backup,name=`career-board_${b.kind}_${b.created_at.replace(/[:.]/g,'-')}_${b.id}.json`,dest=path.join(this.backups,name),tmp=dest+'.tmp';
  try{const h=await fs.open(tmp,'wx');try{await h.writeFile(JSON.stringify(value,null,2),'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,dest);const checked=JSON.parse(await fs.readFile(dest,'utf8'));if(!equal(checked,value))throw Error('备份读回不一致');}
  catch(e){await fs.unlink(tmp).catch(()=>{});throw e;}
  if(b.kind==='auto'){
   const owned=(await this.listDetails()).filter(e=>e.kind==='auto'&&/^career-board_auto_/.test(e.name));
   for(const entry of owned.slice(10))await fs.unlink(path.join(this.backups,entry.name)).catch(()=>{/* A retained extra backup is safer than undoing a committed save. */});
  }
  return{name,kind:b.kind,created_at:b.created_at,note:b.note,reason:b.reason,snapshot_relation:b.snapshot_relation,snapshot_updated_at:b.snapshot_updated_at,data_revision:b.data_revision,data_schema:b.data_schema,app_version:b.app_version,time_source:'metadata'};
 }
 private async backupInternal(kind:FullBackup['backup']['kind'],note='',reason='手动备份'){
  const raw=JSON.parse(await fs.readFile(this.file,'utf8'));assertData(raw);return this.writeEnvelope(fullBackup(raw,kind,note,reason));
 }
 backup(note=''){return this.run(()=>{this.assertWritable();return this.backupInternal('manual',note);});}
 private async write(d:CareerData,backup=true,reason='业务变更',beforeRename?:()=>Promise<void>){
  this.assertWritable();assertData(d);assertSafePath(this.file);await fs.mkdir(this.dir,{recursive:true});const tmp=assertSafePath(this.file+'.tmp');
  try{const h=await fs.open(tmp,'w');try{await h.writeFile(JSON.stringify(d,null,2),'utf8');await h.sync();}finally{await h.close();}if(backup)await this.backupInternal('auto','',reason);if(beforeRename)await beforeRename();await fs.rename(tmp,this.file);}
  catch(e){await fs.unlink(tmp).catch(()=>{});throw e;}return d;
 }
 save(d:CareerData,reason='业务变更'){return this.run(()=>this.write({...d,metadata:{...d.metadata,updated_at:new Date().toISOString()}},true,reason));}
 async readExact(){assertSafePath(this.file);const data:unknown=JSON.parse(await fs.readFile(this.file,'utf8'));assertData(data);return data;}
 async recoveryTarget():Promise<RecoveryTarget>{
  const owner_sha256=assertOwnedDirectory(this.dir);assertSafePath(this.file);
  let bytes:Buffer;try{bytes=await fs.readFile(this.file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{kind:'missing',exists:false,sha256:null,owner_sha256};throw e;}
  try{JSON.parse(bytes.toString('utf8'));}catch(e){if(e instanceof SyntaxError)return{kind:'corrupt',exists:true,sha256:hash(bytes),owner_sha256};throw e;}
  throw Error('目标不是可恢复的语法损坏或缺失状态；请重新载入，不自动覆盖正常或未知版本数据');
 }
 private async verifyRecoveryTarget(expected:RecoveryTarget){
  let actual:RecoveryTarget;try{actual=await this.recoveryTarget();}catch{throw Error('目标数据或目录归属已变化，请重新预览并确认，未执行恢复');}
  if(!equal(actual,expected))throw Error('目标数据或目录归属已变化，请重新预览并确认，未执行恢复');
 }
 async load():Promise<LoadResult>{
  try{
   assertSafePath(this.dir);await fs.mkdir(this.dir,{recursive:true});
   return{data:await this.readExact(),dataPath:this.file};
  }catch(e){
   if((e as NodeJS.ErrnoException).code==='ENOENT'){
    const names=await fs.readdir(this.dir);
    const materials=names.some(n=>n==='backups'||n==='recovery-evidence'||n.startsWith('career-board.corrupt')||n.startsWith('career-board.json.'));
    if(!materials){const data=await this.write(this.initial(),false);return{data,dataPath:this.file};}
   }
   let target:RecoveryTarget;try{target=await this.recoveryTarget();}catch(reason){return{data:null,dataPath:this.file,recovery:{kind:'blocked',canRestore:false,backups:[],message:'数据保持原样，当前情况不能覆盖恢复：'+(reason instanceof Error?reason.message:String(reason))}};}
   const usable:string[]=[];let names:string[];try{names=await this.list();}catch(reason){return{data:null,dataPath:this.file,recovery:{kind:'blocked',canRestore:false,backups:[],message:'恢复资料路径或访问受限，未写入业务数据：'+(reason instanceof Error?reason.message:String(reason))}};}
   for(const name of names){try{parseFullBackup(await this.readBackup(name));usable.push(name);}catch{}}
   return{data:null,dataPath:this.file,recovery:{kind:target.kind,canRestore:true,message:target.kind==='corrupt'?'本地数据语法损坏，原字节保持原样。可选择完整备份，确认后保护原字节再恢复。':'业务文件缺失，已有恢复材料保持原样。可选择完整备份恢复；尚未创建空库。',backups:usable}};
  }
 }
 async readBackup(name:string){if(!(await this.list()).includes(name))throw Error('备份不存在');return fs.readFile(assertSafePath(path.join(this.backups,name)),'utf8');}
 private async protectRecovery(target:RecoveryTarget,bytes:Buffer|null){
  const root=assertSafePath(path.join(this.dir,'recovery-evidence'));await fs.mkdir(root,{recursive:true});
  const id=`recovery-${Date.now()}-${randomUUID()}`,info=path.join(root,id+'.json');
  // Raw evidence is deliberately outside backups and is never a restorable snapshot or auto-rotation candidate.
  if(bytes){const raw=path.join(root,id+'.bin'),h=await fs.open(raw,'wx');try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}if(!Buffer.from(await fs.readFile(raw)).equals(bytes))throw Error('损坏原字节保护读回不一致');}
  const evidence={format:'career-board-raw-recovery-evidence',format_version:1,created_at:new Date().toISOString(),source_file:'career-board.json',target,raw_file:bytes?id+'.bin':null,not_a_business_backup:true};
  const h=await fs.open(info,'wx');try{await h.writeFile(JSON.stringify(evidence,null,2),'utf8');await h.sync();}finally{await h.close();}
  if(!equal(JSON.parse(await fs.readFile(info,'utf8')),evidence))throw Error('缺失/原字节保护信息读回不一致');return id;
 }
 private async commitRecovery(candidate:CareerData,target:RecoveryTarget){
  await this.verifyRecoveryTarget(target);
  const previous=target.exists?await fs.readFile(this.file):null;let protection:string;
  if(previous&&hash(previous)!==target.sha256)throw Error('目标数据已变化，请重新预览并确认，未执行恢复');
  try{protection=await this.protectRecovery(target,previous);}catch(e){throw Error('恢复前原始证据保护未完成，未替换当前数据：'+(e instanceof Error?e.message:String(e)));}
  await this.verifyRecoveryTarget(target);
  const candidateBytes=Buffer.from(JSON.stringify(candidate,null,2),'utf8');
  let renameGuardPassed=false;
  try{await this.write(structuredClone(candidate),false,'恢复',async()=>{await this.verifyRecoveryTarget(target);renameGuardPassed=true;});const checked=await this.readExact();if(!equal(checked,candidate))throw Error('恢复读回与候选内容不一致');return checked;}
  catch(e){
   if(!renameGuardPassed)throw e;
   try{
    if(assertOwnedDirectory(this.dir)!==target.owner_sha256)throw Error('恢复期间目录归属变化');assertSafePath(this.file);
    const current=await fs.readFile(this.file).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    const unchanged=previous?current?.equals(previous):current===null;
    if(!unchanged){
     if(!current?.equals(candidateBytes))throw Error('目标出现非本次候选的新内容，不覆盖');
     if(previous){const tmp=assertSafePath(this.file+'.rollback-'+randomUUID()),h=await fs.open(tmp,'wx');try{await h.writeFile(previous);await h.sync();}finally{await h.close();}await fs.rename(tmp,this.file);}
     else await fs.unlink(this.file);
    }
    const reverted=await fs.readFile(this.file).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    if(previous?!reverted?.equals(previous):reverted!==null)throw Error('原字节/缺失状态回退未确认');
   }catch{this.writeLock=`恢复结果未能确认，后续写入已锁定。原始证据保存在 recovery-evidence/${protection!}；请保留原文件。`;throw Error(this.writeLock);}
   throw Error('恢复未完成；已恢复操作前原字节或缺失状态，未报告成功。'+(e instanceof Error?e.message:String(e)));
  }
 }
 // Called by Board's single queue. Source bytes are already fixed and target revision was checked.
 commitRestore(candidate:CareerData,recoveryTarget?:RecoveryTarget){return this.run(async()=>{
  this.assertWritable();assertData(candidate);
  if(recoveryTarget)return this.commitRecovery(candidate,recoveryTarget);
  const previousBytes=await fs.readFile(this.file,'utf8');let previous:CareerData;let protection:BackupEntry;
  try{previous=JSON.parse(previousBytes);assertData(previous);protection=await this.writeEnvelope(fullBackup(previous,'pre_restore','','恢复前保护'));}
  catch(e){throw Error('恢复前保护未完成，未替换当前数据：'+(e instanceof Error?e.message:'写入失败'));}
  try{
   await this.write(structuredClone(candidate),false);
   const checked=await this.readExact();if(!equal(checked,candidate))throw Error('恢复读回与候选内容不一致');return checked;
  }catch(e){
   try{await this.write(previous!,false);const verified=await this.readExact();if(!equal(verified,previous!))throw Error('回退读回不一致');}
   catch{this.writeLock=`恢复结果未能确认，后续写入已锁定。请保留窗口和恢复前保护：${protection!.name}`;throw Error(this.writeLock);}
   throw Error('恢复未完成；已恢复操作前数据，未报告成功。'+(e instanceof Error?e.message:''));
  }
 });}
 restore(name:string|BackupEntry,prepare:(d:CareerData)=>CareerData=d=>d){return this.readBackup(typeof name==='string'?name:name.name).then(bytes=>this.commitRestore(prepare(parseFullBackup(bytes).data)));}
 reinitialize(){throw Error('V2 不允许覆盖式重新初始化；请从完整备份恢复');}
}
