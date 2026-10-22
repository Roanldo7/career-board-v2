import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ReadingPreferences} from '../../src/preference-types';
const entries=['杭州','南京','滨海新区','其他强推','applications'];
const modes=['表格','看板'];
const operators=['contains','not_contains','equal','not_equal','empty','not_empty','before','after','date_equal','range','gte','lte','number_equal','any','all'];
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const optionalType=(value:Record<string,unknown>,key:string,type:string)=>value[key]===undefined||typeof value[key]===type;
function validateQuery(value:unknown){
 if(!object(value))throw Error('筛选偏好内容损坏');
 for(const key of ['search','group'])if(!optionalType(value,key,'string'))throw Error('筛选文字偏好损坏');
 for(const key of ['showClosed','groupDesc','adjacent'])if(!optionalType(value,key,'boolean'))throw Error('筛选开关偏好损坏');
 for(const [key,allowed] of [['logic',['AND','OR']],['bankMode',['all','exclude','only']],['layout',['flat','companySections']]] as const){
  if(value[key]!==undefined&&(typeof value[key]!=='string'||!allowed.includes(value[key] as never)))throw Error('筛选模式偏好损坏');
 }
 if(value.conditions!==undefined){
  if(!Array.isArray(value.conditions))throw Error('筛选条件偏好损坏');
  for(const condition of value.conditions){
   if(!object(condition)||typeof condition.field!=='string'||!condition.field||typeof condition.op!=='string'||!operators.includes(condition.op)||typeof condition.value!=='string'||!optionalType(condition,'end','string'))throw Error('筛选条件内容损坏');
  }
 }
 if(value.sort!==undefined){
  if(!Array.isArray(value.sort))throw Error('排序偏好损坏');
  for(const rule of value.sort)if(!object(rule)||typeof rule.field!=='string'||!rule.field||typeof rule.desc!=='boolean')throw Error('排序条件内容损坏');
 }
}
export const defaultPreferences=():ReadingPreferences=>({version:1,activeEntry:'杭州',entries:{}});
export function validatePreferences(value:unknown):ReadingPreferences {
 if(!object(value)||value.version!==1||typeof value.activeEntry!=='string'||!entries.includes(value.activeEntry)||!object(value.entries))throw Error('阅读偏好格式不支持');
 const v=value as ReadingPreferences;
 const result=defaultPreferences();result.activeEntry=v.activeEntry;
 for(const key of entries){
  const e=v.entries[key];if(e===undefined)continue;
  if(!object(e)||!Number.isSafeInteger(e.page)||e.page<1||!modes.includes(e.mode)||!object(e.scroll))throw Error('阅读偏好内容损坏');
  validateQuery(e.query);
  for(const n of Object.values(e.scroll))if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw Error('阅读位置损坏');
  result.entries[key]=structuredClone(e);
 }
 return result;
}
export class Preferences {
 readonly file:string;private queue:Promise<unknown>=Promise.resolve();private failure:unknown=null;
 private protectionPending=false;
 constructor(readonly dir:string){this.file=path.join(dir,'ui-preferences.json');}
 private async protectOriginal(){
  await fs.copyFile(this.file,path.join(this.dir,`ui-preferences.corrupt-${Date.now()}-${randomUUID()}.json`));
  this.protectionPending=false;
 }
 async load(){
  try{return{preferences:validatePreferences(JSON.parse(await fs.readFile(this.file,'utf8')))}}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{preferences:defaultPreferences()};
   // Preserve the exact unreadable original; only preferences fall back.
   this.protectionPending=true;
   try{await this.protectOriginal();}catch{
    return{preferences:defaultPreferences(),warning:'阅读偏好无法读取，诊断副本未能保存；已使用默认视图，原文件保留且业务数据不受影响'};
   }
   return{preferences:defaultPreferences(),warning:'阅读偏好无法读取，已使用默认视图；业务数据不受影响'};
  }
 }
 save(value:unknown){
  const snapshot=validatePreferences(value);
  const task=this.queue.catch(()=>{}).then(async()=>{
   const tmp=this.file+'.'+randomUUID()+'.tmp';
   try{
    // Do not replace an invalid original until its diagnostic copy is saved.
    // Retrying only the preference save can recover from a transient copy error.
    if(this.protectionPending)await this.protectOriginal();
    await fs.mkdir(this.dir,{recursive:true});const h=await fs.open(tmp,'wx');try{await h.writeFile(JSON.stringify(snapshot,null,2));await h.sync();}finally{await h.close();}await fs.rename(tmp,this.file);this.failure=null;
   }
   catch(e){this.failure=e;await fs.unlink(tmp).catch(()=>{});throw Error('阅读位置未保存；业务数据不受影响');}
  });this.queue=task;return task;
 }
 async flush(){await this.queue;if(this.failure)throw this.failure;}
}
