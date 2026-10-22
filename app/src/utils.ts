import {resolveURL} from './url';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import schema from '../resources/schema.json';
import columns from '../resources/xlsx_columns.json';
import {groups,type Job,type Group,type ImportRow,type ImportMapping,type CareerData} from './types';
dayjs.extend(customParseFormat);
export const statusColors:Record<string,string>=schema.status_colors;
export const labels:Record<string,string>={...Object.fromEntries(columns.map(c=>[c.field,c.label])),consideration_status:'考虑状态'};
export const text=(v:unknown):string=> v==null?'':Array.isArray(v)?v.join('；'):typeof v==='object'?JSON.stringify(v):String(v);
export const numberOrNull=(v:unknown)=>{if(v===null||v===undefined||text(v).trim()==='')return null;const s=text(v).trim();const n=typeof v==='number'?v:/^-?\d+(\.\d+)?$/.test(s)?Number(s):NaN;return Number.isFinite(n)?n:null;};
export const score=(v:unknown)=>numberOrNull(v)===null?'—':String(numberOrNull(v));
export const salary=(j:Job)=>j.salary_confidence==='Unknown'||!j.salary_text?.trim()?'待核验':j.salary_text;
export const annual=(j:Job)=>numberOrNull(j.annual_total_low)!==null&&numberOrNull(j.annual_total_high)!==null?`${j.annual_total_low! / 10000}–${j.annual_total_high! / 10000}万元（条件口径）`:'待核验';
export const normalize=(v:unknown)=>text(v).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu,'');
export const jobKey=(j:Partial<Job>)=>[j.company_name,j.job_title,j.location_text,j.apply_url,j.recruitment_batch].map(normalize).join('|');
export const validDate=(v:unknown):string|null=>{
 if(v===null||v===undefined||v==='')return null;
 if(typeof v==='number'&&v>0&&v<2958466)return dayjs('1899-12-30').add(Math.floor(v),'day').format('YYYY-MM-DD');
 const s=text(v).trim(); for(const f of ['YYYY-MM-DD','YYYY/M/D','YYYY/MM/DD','YYYY/MM/D','YYYY/M/DD','YYYY.MM.DD','YYYY年M月D日','YYYY年MM月DD日','YYYY年MM月D日','YYYY年M月DD日','YYYY-MM-DDTHH:mm:ss.SSS[Z]']){const d=dayjs(s,f,true);if(d.isValid())return d.format('YYYY-MM-DD');}return null;
};
export const expired=(j:Job,today=dayjs().format('YYYY-MM-DD'))=>!!validDate(j.deadline)&&j.deadline!<today;
export const soon=(j:Job,today=dayjs().format('YYYY-MM-DD'))=>!!validDate(j.deadline)&&!expired(j,today)&&dayjs(j.deadline).diff(dayjs(today),'day')<=3;
export const stale=(j:Job,days=7,today=dayjs().format('YYYY-MM-DD'))=>!validDate(j.verified_at)||dayjs(today).diff(dayjs(j.verified_at),'day')>days;
export const jobSort=(a:Job,b:Job)=>'SABC'.indexOf(a.priority)-'SABC'.indexOf(b.priority)||(b.fit_score??-1)-(a.fit_score??-1)||(validDate(a.deadline)||'9999').localeCompare(validDate(b.deadline)||'9999');
export const aliases:Record<string,string>={...schema.legacy_aliases,...Object.fromEntries(columns.map(c=>[c.label,c.field])),公司:'company_name',职位名称:'job_title',工作地点:'location_text',薪资:'salary_text',月薪:'salary_text',年包:'annual_total_text',匹配度:'fit_score',核验日期:'verified_at'};
export const autoMapping=(headers:string[]):ImportMapping=>Object.fromEntries(headers.map(h=>[h,aliases[h]||(['consideration_status','考虑状态'].includes(h)?'consideration_status':'')||columns.find(c=>c.field===h)?.field||'']));
// An empty recruiting-status cell is unknown, not a closed vacancy.
export function openStatus(v:unknown):boolean|undefined {
 if(v===true||v===1)return true;if(v===false||v===0)return false;
 const s=text(v).trim().toLowerCase();
 if(['true','1','是','在招','招聘中','开放'].includes(s))return true;
 if(['false','0','否','不在招','停止招聘','已关闭','停止','已截止'].includes(s))return false;
 return undefined;
}
export function mapRows(rows:ImportRow[],mapping:ImportMapping,group:Group){
 const errors:string[]=[],warnings:string[]=[];
 const jobs=rows.map((row,i)=>{
  const v:ImportRow={};for(const [h,k]of Object.entries(mapping))if(k&&!['序号','serial','row_number'].includes(k)&&row[h]!==undefined)v[k]=row[h];
  for(const k of ['matched_points','gaps','hard_risks','eligible_city_groups','evidence_urls'])if(v[k]!=null){try{const a=JSON.parse(text(v[k]));v[k]=Array.isArray(a)?a:[text(v[k])]}catch{v[k]=text(v[k]).split(/[;；\n]/).filter(Boolean)}}
  for(const k of ['fit_score','opportunity_score','compensation_score','monthly_low','monthly_high','salary_months','annual_total_low','annual_total_high'])if(k in v){const n=numberOrNull(v[k]);if(n===null&&text(v[k]).trim())warnings.push(`第${i+1}行：${labels[k]||k}无法识别，原值已保留到备注`);if(n===null&&text(v[k]).trim())v.notes=`${text(v.notes)}；${k}原值：${text(v[k])}`;v[k]=n;}
  for(const k of ['posted_at','deadline','verified_at'])if(v[k]!=null&&v[k]!==''){const d=validDate(v[k]);if(!d){warnings.push(`第${i+1}行：${k}日期无法解析，保留原值`);v[`${k}_raw`]=v[k];}v[k]=d;}
  for(const k of ['apply_url','source_url','salary_source_url'])if(v[k]&&!resolveURL(v[k]).valid)errors.push(`第${i+1}行：${labels[k]||k}不是有效网址或域名`);
  const chosen=text(v.city_group)||group;if(!groups.includes(chosen as Group))errors.push(`第${i+1}行：岗位池无效`);
  if(v.city_group&&chosen!==group)warnings.push(`第${i+1}行：保留文件岗位池「${chosen}」`);
  for(const k of ['company_name','job_title','location_text'])if(!text(v[k]).trim())errors.push(`第${i+1}行：缺少${labels[k]||k}`);
  const originalPriority=text(v.priority).trim(); const p=({'优先':'A','关注':'C'} as Record<string,string>)[originalPriority]||originalPriority||'C';if(originalPriority&&p!==originalPriority){v.priority_raw=originalPriority;warnings.push(`第${i+1}行：旧表优先级「${originalPriority}」映射为${p}，原值已保留；这不是重新评分`);}if(!['S','A','B','C'].includes(p))errors.push(`第${i+1}行：优先级必须为S/A/B/C`);
  if('is_favorite'in v)v.is_favorite=v.is_favorite===true||['true','1','是'].includes(text(v.is_favorite).trim().toLowerCase());
  if('is_open'in v){const parsed=openStatus(v.is_open);if(parsed===undefined){if(v.is_open!==null&&text(v.is_open).trim()&&!['unknown','待核验','未知'].includes(text(v.is_open).trim().toLowerCase()))warnings.push(`第${i+1}行：核验时在招无法识别，按未知保留`);if(v.is_open!==null)delete v.is_open;}else v.is_open=parsed;}
  if('consideration_status'in v){const value=text(v.consideration_status).trim();if(!value)delete v.consideration_status;else if(!['active','deferred'].includes(value))errors.push(`第${i+1}行：考虑状态必须为active/deferred`);}
  return {...v,id:text(v.id)||crypto.randomUUID(),company_name:text(v.company_name).trim(),job_title:text(v.job_title).trim(),location_text:text(v.location_text).trim(),city_group:chosen,priority:p,salary_confidence:text(v.salary_confidence)||'Unknown',updated_at:new Date().toISOString()} as Job;
 });return{jobs,errors,warnings};
}
export type Strategy='skip'|'overwrite'|'merge';
export function mergeJobs(existing:Job[],incoming:Job[],strategy:Strategy,overrides:Record<string,Strategy>={}){
 const result=structuredClone(existing);let conflicts=0;
 incoming.forEach((job,i)=>{const index=result.findIndex(e=>e.id===job.id||jobKey(e)===jobKey(job));if(index<0){result.push(job);return}conflicts++;const how=overrides[String(i)]||strategy;if(how==='skip')return;
 const old=result[index];const fields=how==='merge'?Object.fromEntries(Object.entries(job).filter(([,v])=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length))):job;
 result[index]={...(how==='merge'?old:{}),...fields,id:old.id,...(!Object.hasOwn(job,'consideration_status')&&Object.hasOwn(old,'consideration_status')?{consideration_status:old.consideration_status}:{})} as Job;
 });return{jobs:result,conflicts};
}
export function assertData(v:unknown):asserts v is CareerData {
 if(!v||typeof v!=='object')throw Error('数据文件格式不正确');const d=v as CareerData;
 if(![1,2].includes(d.version)||!Array.isArray(d.jobs)||!Array.isArray(d.applications)||!d.settings||!d.metadata)throw Error('数据版本或结构不兼容');
 if(!Number.isFinite(d.settings.stale_days)||d.settings.stale_days<0||!Number.isFinite(d.settings.binhai_salary_ratio)||d.settings.binhai_salary_ratio<=0||typeof d.settings.show_expired!=='boolean')throw Error('设置数据不正确');
 if(d.version===2){
  for(const key of ['employers','leads','tombstones','saved_views'])if(d[key]!=null&&!Array.isArray(d[key]))throw Error('扩展集合结构不正确');
  for(const key of ['employers','leads']){const seen=new Set<string>();for(const r of d[key]||[]){if(!r||typeof r.id!=='string'||!r.id||seen.has(r.id))throw Error('扩展记录ID无效或重复');seen.add(r.id);}}
  for(const a of d.applications)if(a.opportunity_refs!=null&&(!Array.isArray(a.opportunity_refs)||a.opportunity_refs.some((r:any)=>!r||!['job','lead'].includes(r.kind)||typeof r.record_id!=='string')))throw Error('申请关联结构不正确');
 }
 const ids=new Set<string>();for(const j of d.jobs){if(!j||typeof j.id!=='string'||!j.id||ids.has(j.id)||typeof j.company_name!=='string'||!j.company_name.trim()||typeof j.job_title!=='string'||!j.job_title.trim()||typeof j.location_text!=='string'||!j.location_text.trim()||!groups.includes(j.city_group)||!['S','A','B','C'].includes(j.priority))throw Error('岗位字段无效或ID重复');ids.add(j.id);}
 for(const j of d.jobs){for(const k of ['matched_points','gaps','hard_risks','eligible_city_groups','evidence_urls']){const a=j[k];if(a!=null&&a!==''&&(!Array.isArray(a)||a.some(v=>typeof v!=='string')))throw Error('岗位列表字段格式不正确');}for(const k of ['salary_text','company_nature','industry','notes','apply_url','source_url'])if(j[k]!=null&&typeof j[k]!=='string')throw Error('岗位文本字段格式不正确');}
 const apps=new Set<string>();for(const a of d.applications){if(!a||!a.id||apps.has(a.id)||!a.company_name?.trim()||!a.job_title?.trim()||!(a.status in statusColors)||!validDate(a.applied_date))throw Error('投递记录格式不正确');apps.add(a.id);}
}
