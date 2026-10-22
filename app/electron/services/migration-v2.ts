import {createHash} from 'node:crypto';
import {assertData} from '../../src/utils';
import type {CareerData} from '../../src/types';
type Row=Record<string,any>;
export interface MigrationConflict {collection:string;seed_id:string;existing_ids:string[];reason:string}
export function emptyData():CareerData {const now=new Date().toISOString();return{version:2,revision:0,employers:[],jobs:[],leads:[],applications:[],tombstones:[],saved_views:[],command_receipts:[],settings:{binhai_salary_ratio:.9,binhai_salary_gate_enabled:false,show_expired:false,stale_days:7},metadata:{created_at:now,updated_at:now,seed_version:'empty-v2'}};}
// Pure structural compatibility only: no source lookup, seed merging or receipt replay.
export function prepareMigrationV2(current:Row|null,_unusedSeed?:Row){
 if(current===null)return{data:emptyData(),conflicts:[] as MigrationConflict[],changed:true};
 assertData(current);const data=structuredClone(current) as CareerData;
 for(const k of ['employers','leads','tombstones','saved_views','command_receipts']){if(!Object.hasOwn(data,k))data[k]=[];else if(!Array.isArray(data[k]))throw Error('集合结构无效：'+k);}
 data.revision??=0;
 if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('数据 revision 无效');
 for(const name of ['jobs','leads','applications'])for(const r of data[name] as Row[]){
  if(!Object.hasOwn(r,'employer_id')){
   let employer=(data.employers as Row[]).find(e=>[e.canonical_name,e.display_name,...(e.aliases||[])].includes(r.company_name));
   if(!employer){const id='EMP-COMPAT-'+createHash('sha256').update(String(r.company_name)).digest('hex').slice(0,24);employer={id,canonical_name:r.company_name,display_name:r.company_name,aliases:[]};data.employers.push(employer);}r.employer_id=employer.id;
  }
 }
 data.version=2;validateRelations(data);
 return{data,conflicts:[] as MigrationConflict[],changed:JSON.stringify(data)!==JSON.stringify(current)};
}
export function validateRelations(d:CareerData){
 assertData(d);
 const employers=new Set((d.employers||[]).map((r:Row)=>r.id));
 const jobs=new Set(d.jobs.map(r=>r.id)),leads=new Set((d.leads||[]).map((r:Row)=>r.id));
 const tombstones:Row[]=d.tombstones||[];
 const known=(kind:string,id:string)=>['job','lead'].includes(kind)&&((kind==='job'?jobs:leads).has(id)||tombstones.some(t=>t.collection===(kind==='job'?'jobs':'leads')&&t.id===id));
 for(const name of ['jobs','leads','applications'])for(const r of d[name]||[]){
  if(r.employer_id&&!employers.has(r.employer_id)&&!tombstones.some(t=>t.collection==='employers'&&t.id===r.employer_id))throw Error('雇主引用不存在');
  if(r.consideration_status!==undefined&&!['active','deferred'].includes(r.consideration_status))throw Error('考虑状态无效');
 }
 for(const a of d.applications){
  for(const ref of a.opportunity_refs||[])if(!known(ref.kind,ref.record_id))throw Error('申请引用的来源不存在，且无删除保护');
  if(a.source_job_id&&!known('job',a.source_job_id))throw Error('旧申请来源引用不存在，且无删除保护');
 }
}
