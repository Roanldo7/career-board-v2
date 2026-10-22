import fs from 'node:fs/promises';
import {resolveURL} from '../../src/url';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import type {RestorePreview,BackupEntry} from '../../src/backup-types';
import {fullBackup,parseFullBackup,summarize} from './full-backup';
import type {CareerData,Command,CommandResult,Application,LoadResult} from '../../src/types';
import {active,candidates,identity,linked,localToday,type Row} from '../../src/domain';
import {assertData,validDate,statusColors} from '../../src/utils';
import {Storage,type RecoveryTarget} from './storage';
import {prepareMigrationV2} from './migration-v2';
import {commandBackupReason} from '../../src/backup-reason';
const collections=['jobs','leads','applications','employers'];
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const forbidden=new Set(['id','employer_id','source_raw','source_refs','source_import_key','opportunity_refs','canonical_opportunity_id','source_job_id','is_applied','created_at','updated_at','deleted_at','status_history','consideration_status']);
export class Board {
 private queue:Promise<unknown>=Promise.resolve();private data:CareerData|null=null;
 private pending=0;private recovery:LoadResult['recovery'];
 private undo:CareerData[]=[];private redo:CareerData[]=[];private lastSession='';
 private previews=new Map<string,{candidate:CareerData;preview:RestorePreview;targetHash:string;recoveryTarget?:RecoveryTarget}>();
 constructor(readonly storage:Storage,readonly seed?:CareerData,readonly personalSnapshot=false){}
 private serial<T>(fn:()=>Promise<T>){this.pending++;const next=this.queue.then(fn,fn).finally(()=>{this.pending--;});this.queue=next.catch(()=>{});return next;}
 idle(){return this.queue;}
 async assertRecoveryExit(){if(this.data||!this.recovery||this.pending)throw Error('当前不是可无写退出的恢复状态；请等待操作完成并使用正常保存退出');}
 checkpoint(revision:number){return this.serial(async()=>{this.storage.assertWritable();if(!this.data||this.data.revision!==revision)throw Error('保存版本已变化，请重试');const disk=JSON.parse(await fs.readFile(this.storage.file,'utf8'));if(!equal(disk,this.data))throw Error('磁盘内容未确认，请保留草稿并重试');return {revision:disk.revision};});}
 private employer(d:CareerData,name:string){let e=(d.employers||[]).find((e:Row)=>[e.canonical_name,e.display_name,...e.aliases||[]].includes(name));if(!e){e={id:'EMP-'+randomUUID(),canonical_name:name,display_name:name,aliases:[]};d.employers.push(e);}return e.id;}
 private migrate(d:CareerData){return prepareMigrationV2(d);}
 private normalize(d:CareerData){return d;}
 load(){return this.serial(async()=>{if(this.data)return {data:structuredClone(this.data),dataPath:this.storage.file};let loaded:LoadResult;try{loaded=await this.storage.load();}catch(e){this.recovery={kind:'blocked',canRestore:false,backups:[],message:'数据访问失败，未载入业务；请保留原目录：'+(e instanceof Error?e.message:String(e))};return{data:null,dataPath:this.storage.file,recovery:this.recovery};}this.recovery=loaded.recovery;if(!loaded.data)return loaded;
  let d:CareerData;try{const migrated=this.migrate(loaded.data);d=this.normalize(migrated.data as CareerData);assertData(d);}catch(e){this.recovery={kind:'blocked',canRestore:false,backups:[],message:'现有数据结构或引用不兼容，未写入或覆盖：'+(e instanceof Error?e.message:String(e))};return{data:null,dataPath:this.storage.file,recovery:this.recovery};}
  try{if(!equal(d,loaded.data))this.data=await this.storage.save(d);else this.data=d;}catch(e){this.recovery={kind:'blocked',canRestore:false,backups:[],message:'兼容载入写入未完成，未载入业务；请保留原目录：'+(e instanceof Error?e.message:String(e))};return{data:null,dataPath:this.storage.file,recovery:this.recovery};}
  return {...loaded,data:structuredClone(this.data)};
 });}
 backup(note=''){return this.serial(async()=>{await this.currentOnDisk();return this.storage.backup(note);});}
 private async currentOnDisk(){this.storage.assertWritable();if(!this.data)throw Error('请先载入数据');const disk=await this.storage.readExact();if(!equal(disk,this.data))throw Error('磁盘内容已变化，请重新载入后操作');return disk;}
 fullBackup(note=''){return this.serial(async()=>fullBackup(await this.currentOnDisk(),'manual',note,'另存完整备份'));}
 private async previewTarget(){
  if(this.data){const current=await this.currentOnDisk();return{current,target_kind:'normal' as const,target_revision:current.revision??0,targetHash:createHash('sha256').update(JSON.stringify(current)).digest('hex'),recoveryTarget:undefined};}
  this.storage.assertWritable();if(!this.recovery?.canRestore)throw Error('当前目标不允许覆盖恢复，请先处理诊断信息');
  const recoveryTarget=await this.storage.recoveryTarget();return{current:null,target_kind:recoveryTarget.kind,target_revision:-1,targetHash:createHash('sha256').update(JSON.stringify(recoveryTarget)).digest('hex'),recoveryTarget};
 }
 private async preparePreview(bytes:string,sourceName:string){
  const parsed=parseFullBackup(bytes),target=await this.previewTarget(),token=randomUUID();
  const preview:RestorePreview={token,source_name:path.basename(sourceName),source_hash:createHash('sha256').update(bytes).digest('hex'),source_format:parsed.source_format,target_kind:target.target_kind,target_revision:target.target_revision,source_summary:summarize(parsed.data),target_summary:target.current?summarize(target.current):null,warnings:[...parsed.warnings,target.current?'整库替换：不会合并或保留目标库在源快照之后的独有修改。':'目标当前未载入业务；确认后先保留原始损坏字节或缺失状态，再恢复完整备份。']};
  this.previews.set(token,{candidate:parsed.data,preview,targetHash:target.targetHash,recoveryTarget:target.recoveryTarget});
  while(this.previews.size>8)this.previews.delete(this.previews.keys().next().value!);
  return structuredClone(preview);
 }
 previewRestore(bytes:string,sourceName:string){return this.serial(()=>this.preparePreview(bytes,sourceName));}
 previewBackup(name:string){return this.serial(async()=>this.preparePreview(await this.storage.readBackup(name),name));}
 refreshRestorePreview(token:string){return this.serial(async()=>{
  const item=this.previews.get(token);if(!item)throw Error('恢复预览已失效，请重新选择备份');const target=await this.previewTarget();
  item.preview.target_revision=target.target_revision;item.preview.target_kind=target.target_kind;item.preview.target_summary=target.current?summarize(target.current):null;item.targetHash=target.targetHash;item.recoveryTarget=target.recoveryTarget;return structuredClone(item.preview);
 });}
 confirmRestore(token:string,expectedRevision:number){return this.serial(async()=>{
  const item=this.previews.get(token);if(!item)throw Error('恢复预览已失效，请重新选择备份');let target:Awaited<ReturnType<Board['previewTarget']>>;
  try{target=await this.previewTarget();}catch{throw Error('目标数据或目录归属已变化，请重新预览并确认，未执行恢复');}
  if(expectedRevision!==item.preview.target_revision||target.target_revision!==expectedRevision||target.targetHash!==item.targetHash)throw Error('目标数据已变化，请重新预览并确认，未执行恢复');
  const saved=await this.storage.commitRestore(item.candidate,item.recoveryTarget);this.data=saved;this.recovery=undefined;this.undo=[];this.redo=[];this.lastSession='';this.previews.clear();return structuredClone(saved);
 });}
 // Legacy service helper for existing tests; UI uses preview + explicit confirm.
 async restore(name:string|BackupEntry){const preview=await this.previewBackup(typeof name==='string'?name:name.name);return this.confirmRestore(preview.token,preview.target_revision);}
 private consideration(d:CareerData,kind:string,r:Row,value:'active'|'deferred'){
  const rows:Row[]=kind==='lead'?d.leads:d.jobs;
  for(const item of rows)if(item.id===r.id||(kind==='job'&&r.canonical_opportunity_id&&item.employer_id===r.employer_id&&item.canonical_opportunity_id===r.canonical_opportunity_id)){
   if((item.consideration_status??'active')!==value)item.consideration_status=value;
  }
 }
 private answer(result:string,extra:Row={}):CommandResult{return{data:structuredClone(this.data!),result,undo:this.undo.length,redo:this.redo.length,...extra};}
 private registration(d:CareerData,c:Command,now:string):Row{const outcome=(result:string,extra:Row={})=>({result,...extra});
   const kind=c.kind==='lead'?'lead':'job';const r=(kind==='job'?d.jobs:d.leads).find((r:Row)=>r.id===c.record_id);if(!r||!active(r))throw Error('来源不存在或已在回收站');
   const existing=d.applications.find(a=>linked(a,r,kind));if(existing)return outcome(existing.deleted_at?'in_trash':'already_exists',{application_id:existing.id});
   if(d.tombstones.some((t:Row)=>t.collection==='applications'&&linked(t as Application,r,kind)))return outcome('in_trash',{permanently_deleted:true});
   if(c.type==='link'){
    const a=d.applications.find(a=>a.id===c.application_id&&active(a));if(!a)throw Error('申请不存在');if(a.employer_id!==r.employer_id&&!c.confirm_employer)throw Error('雇主不同，请先确认雇主关联');
    // Only relation metadata changes: even updated_at of the existing application is preserved.
    a.opportunity_refs=[...(a.opportunity_refs||[]),{kind,record_id:r.id,canonical_opportunity_id:kind==='job'?r.canonical_opportunity_id:undefined,method:'user_confirmed',confirmed_at:now}];a.link_state='confirmed';return {result:'linked',application_id:a.id};
   }else{
    const possible=candidates(d,r);if(kind==='job'&&possible.length&&!c.confirm_distinct)return outcome('possible_match',{candidates:possible.map(a=>a.id)});
    if(kind==='lead'&&!String(c.details?.job_title||'').trim())return outcome('needs_details');
    if(r.consideration_status==='deferred'&&!c.confirm_consideration)return outcome('needs_consideration_confirmation');
    const title=kind==='lead'?String(c.details.job_title).trim():r.job_title;
    const a:Application={id:'APP-'+randomUUID(),employer_id:r.employer_id,company_name:r.company_name,job_title:title,city:kind==='lead'?String(c.details?.city||r.location_text||r.actual_city||''):r.location_text,status:'已投递',applied_date:localToday(),apply_url:r.apply_url||r.source_url||'',resume_version:r.resume_family||'',recruitment_batch:c.details?.recruitment_batch||r.recruitment_batch||'',notes:'',next_action:'待测评',created_at:now,updated_at:now,opportunity_refs:[{kind,record_id:r.id,canonical_opportunity_id:kind==='job'?r.canonical_opportunity_id:undefined,method:'explicit',confirmed_at:now}],link_state:'confirmed',source_snapshot:structuredClone(r)};
    a.company_nature=r.company_nature||'';a.industry=r.industry||'';a.deadline=r.deadline||null;d.applications.push(a);if(c.confirm_consideration)this.consideration(d,kind,r,'active');return {result:'created',application_id:a.id};
   }

 }
 execute(c:Command){return this.serial(async()=>{
  this.storage.assertWritable();if(!this.data)throw Error('请先载入数据');if(!c||typeof c.id!=='string'||!c.id||typeof c.type!=='string')throw Error('事务格式无效');
  const before=this.data;
  if(c.type==='undo'||c.type==='redo'){
   if(c.revision!==undefined&&c.revision!==before.revision)throw Error('撤销版本冲突，请刷新后重试');
   const src=c.type==='undo'?this.undo:this.redo,dst=c.type==='undo'?this.redo:this.undo;if(!src.length)return this.answer('no_change');
   const target=structuredClone(src[src.length-1]);target.revision=before.revision+1;const saved=await this.storage.save(target,commandBackupReason(c));src.pop();dst.push(structuredClone(before));this.data=saved;this.lastSession='';return this.answer(c.type);
  }
  const receipt=(before.command_receipts||[]).find((r:Row)=>r.id===c.id);if(receipt)return this.answer(receipt.application_id?'already_exists':'no_change',{application_id:receipt.application_id,results:receipt.results});
  // Registration and explicit association always re-check the latest record in this queue.
  if(c.revision!==undefined&&c.revision!==before.revision&&!['register','link','register_many','preview_register_many'].includes(c.type))throw Error('数据版本已更新，请刷新后重试；输入尚未清除');
  const d=structuredClone(before);let result='saved',extra:Row={};const now=new Date().toISOString();
  if(c.type==='register_many'||c.type==='preview_register_many'){
   if(!Array.isArray(c.targets)||c.targets.length>10000)throw Error('登记范围无效');
   const results:Row[]=[];const seen=new Set<string>();for(const t of c.targets){const key=t.kind+':'+t.record_id;if(seen.has(key))continue;seen.add(key);try{results.push({key,...this.registration(d,{id:c.id,type:'register',kind:t.kind,record_id:t.record_id,confirm_consideration:c.confirm_consideration,confirm_distinct:t.confirm_distinct,details:t.details},now)});}catch{results.push({key,result:'unavailable'});}}
   extra={results};result='registered_batch';if(c.type==='preview_register_many')return this.answer('preview',extra);
  }else if(c.type==='set_consideration'){
   if(!['active','deferred'].includes(c.value)||!Array.isArray(c.targets)||c.targets.length>10000)throw Error('考虑状态事务无效');
   for(const t of c.targets){if(!['job','lead'].includes(t.kind))throw Error('机会类型无效');const r=(t.kind==='job'?d.jobs:d.leads).find((r:Row)=>r.id===t.record_id&&active(r));if(!r)throw Error('来源不存在或已删除');this.consideration(d,t.kind,r,c.value);}
  }else if(c.type==='register'||c.type==='link'){
   const out=this.registration(d,c,now);result=out.result;extra={...out};delete extra.result;
  }else if(c.type==='unlink'){
   const a=d.applications.find(a=>a.id===c.application_id);if(!a)throw Error('申请不存在');a.opportunity_refs=(a.opportunity_refs||[]).filter((ref:Row)=>ref.record_id!==c.record_id);if(a.source_job_id===c.record_id)delete a.source_job_id;const source=d.jobs.find(j=>j.id===c.record_id);if(source?.canonical_opportunity_id===a.canonical_opportunity_id)delete a.canonical_opportunity_id;a.link_state=a.opportunity_refs.length?'confirmed':'company_only';
  }else if(c.type==='batch'){
   if(!Array.isArray(c.operations)||c.operations.length>10000)throw Error('批量事务无效');
   for(const op of c.operations){
    if(!collections.includes(op.collection))throw Error('集合无效');const rows:Row[]=d[op.collection];const r=rows.find(r=>r.id===op.record_id);
    if(op.action==='add'){
     if(rows.some(r=>r.id===op.value?.id))continue;const value:Row=structuredClone(op.value);if(!value.id)throw Error('缺少稳定ID');delete value.is_applied;if(value.consideration_status!==undefined&&!['active','deferred'].includes(value.consideration_status))throw Error('考虑状态无效');
     if(op.collection!=='employers')value.employer_id=this.employer(d,value.company_name);
     if(op.collection==='applications'){
      const refs=value.opportunity_refs||[];if(value.source_job_id&&!refs.length)refs.push({kind:'job',record_id:value.source_job_id,method:'explicit',confirmed_at:now});
      if(refs.some((ref:Row)=>d.applications.some(a=>linked(a,{id:ref.record_id},ref.kind))))throw Error('该来源已有申请，请查看已有记录');
      if(!Object.hasOwn(value,'next_action'))value.next_action='待测评';
      value.opportunity_refs=refs;value.created_at??=now;value.updated_at??=now;
     }
     for(const k of ['apply_url','source_url','salary_source_url'])if(value[k]&&!resolveURL(value[k]).valid)throw Error('请输入合法HTTP/HTTPS网址或域名');
     rows.push(value);continue;
    }
    if(!r)throw Error('记录不存在');
    if(op.action==='patch'){
     for(const [key,value] of Object.entries(op.fields||{})){
      if(key==='consideration_status'){if(!['jobs','leads'].includes(op.collection)||!['active','deferred'].includes(String(value)))throw Error('考虑状态无效');if(op.expected&&key in op.expected&&!equal(r[key],op.expected[key]))throw Error('同一字段已经改变，请检查后重试');this.consideration(d,op.collection==='leads'?'lead':'job',r,value as 'active'|'deferred');continue;}
      if(forbidden.has(key)||['__proto__','constructor','prototype'].includes(key))throw Error(`字段${key}不可直接编辑`);
      if(op.expected&&key in op.expected&&!equal(r[key],op.expected[key]))throw Error('同一字段已经改变，请检查后重试');
      if(['applied_date','next_action_date','deadline'].includes(key)&&value&&!validDate(value))throw Error('日期应为YYYY-MM-DD');
      if(op.collection==='applications'&&key==='status'&&!(String(value) in statusColors))throw Error('无效投递阶段');
      if(['company_name','job_title','applied_date'].includes(key)&&!String(value??'').trim())throw Error('必填字段不可为空');
      if(['apply_url','source_url','salary_source_url'].includes(key)&&value&&!resolveURL(value).valid)throw Error('请输入合法HTTP/HTTPS网址或域名');
      if(!equal(r[key],value)){if(op.collection==='applications'&&key==='status')r.status_history=[...(r.status_history||[]),{from:r.status,to:value,at:now,source:'user_edit'}];r[key]=value;r.updated_at=now;}
     }
    }else if(op.action==='delete'){if(!r.deleted_at)r.deleted_at=now;}
    else if(op.action==='restore'){r.deleted_at=null;}
    else if(op.action==='purge'){if(!c.confirm||!r.deleted_at)throw Error('仅能确认清除回收站记录');d.tombstones.push({collection:op.collection,id:r.id,source_import_key:r.source_import_key,opportunity_refs:r.opportunity_refs,source_job_id:r.source_job_id,canonical_opportunity_id:r.canonical_opportunity_id,employer_id:r.employer_id});rows.splice(rows.indexOf(r),1);}
    else throw Error('操作无效');
   }
  }else if(c.type==='settings'){d.settings={...d.settings,...c.fields};}
  else if(c.type==='save_view'){if(!c.name||!c.query)throw Error('视图格式无效');d.saved_views=[...d.saved_views.filter((v:Row)=>v.name!==c.name),{name:c.name,query:c.query}];}
  else throw Error('未知事务');
  if(equal(d,before))return this.answer(result==='saved'?'no_change':result,extra);
  d.revision=before.revision+1;d.command_receipts=[...(d.command_receipts||[]),{id:c.id,...extra}].slice(-100);assertData(d);
  const saved=await this.storage.save(d,commandBackupReason(c)); // No in-memory success or history mutation before durable write.
  if(c.type==='batch'&&c.operations.some((op:Row)=>op.action==='purge')){this.undo=[];this.redo=[];}
  else if(!c.edit_session||c.edit_session!==this.lastSession){this.undo.push(structuredClone(before));if(this.undo.length>50)this.undo.shift();}
  this.redo=[];this.lastSession=c.edit_session||'';this.data=saved;return this.answer(result,extra);
 });}
}
