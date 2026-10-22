import {resolveURL} from './url';
import type {CareerData} from './types';
import {active,jobState,linked,localToday,poolRows,type Row} from './domain';
import {text,validDate,statusColors,numberOrNull} from './utils';
export type Condition={field:string;op:string;value:string;end?:string};
export type BankMode='all'|'exclude'|'only';
export type Query={search?:string;conditions?:Condition[];logic?:'AND'|'OR';showClosed?:boolean;group?:string;groupDesc?:boolean;sort?:{field:string;desc:boolean}[];adjacent?:boolean;layout?:'flat'|'companySections';bankMode?:BankMode};
export const nextBankMode=(mode:BankMode='all'):BankMode=>mode==='exclude'?'only':'exclude';
export function isBank(d:CareerData,r:Row){
 const employer=(d.employers||[]).find((e:Row)=>e.id===r.employer_id);
 const names=[r.company_name,employer?.display_name,employer?.canonical_name,...(Array.isArray(employer?.aliases)?employer.aliases:[])];
 return names.some(n=>typeof n==='string'&&n.includes('银行'));
}
export const consideration=(r:Row)=>r.consideration_status==='deferred'?'deferred':'active';
export function rowTone(d:CareerData,r:Row){return consideration(r)==='deferred'?'deferred':registered(d,r)?'registered':'default';}
const collator=new Intl.Collator('zh-CN',{numeric:true});
export const keyOf=(r:Row)=>`${r.record_kind}:${r.id}`;
export const companyKey=(r:Row)=>r.employer_id||r.company_name;
export function safeURL(r:Row){for(const raw of [r.apply_url,r.source_url]){const u=resolveURL(raw);if(u.valid)return u.normalized;}return '';}
export const registered=(d:CareerData,r:Row)=>['registered','in_trash','deleted'].includes(jobState(d,r,r.record_kind).state);
export function salary(d:CareerData,r:Row){
 if(r.record_kind!=='application')return text(r.salary_text)||'—';
 if(Object.hasOwn(r,'salary_text'))return text(r.salary_text)||'—';
 const sources=[...d.jobs.map(j=>({...j,record_kind:'job'})),...d.leads.map((l:Row)=>({...l,record_kind:'lead'}))].filter(j=>linked(r as any,j,j.record_kind));
 const snap=r.source_snapshot;
 if(sources.length===1){const s=snap?.id===sources[0].id?snap:sources[0];if(s.salary_text&&['A','B','C'].includes(s.salary_confidence))return text(s.salary_text);}
 return '—';
}
export function projection(d:CareerData,page:string):Row[]{return (page==='applications'?d.applications.filter(active).map(a=>({...a,record_kind:'application',location_text:a.city||''})):poolRows(d,page)).map(r=>({...r,display_salary:salary(d,r),company_sort_name:d.employers?.find((e:Row)=>e.id===r.employer_id)?.canonical_name||r.company_name}));}
export function briefLocation(r:Row,page:string){const raw=text(r.location_text);const pieces=[...new Set(raw.split(/[、,，;；/\s]+/).filter(Boolean))];const i=pieces.findIndex(p=>p===page||p===page+'市');if(i>0)pieces.unshift(...pieces.splice(i,1));return pieces.length>2?pieces.slice(0,2).join(' / ')+` +${pieces.length-2}`:raw||'—';}
function fieldValue(d:CareerData,r:Row,f:string):any{
 if(f==='registration')return jobState(d,r,r.record_kind).state;
 if(f==='company_history')return d.applications.some(a=>a.employer_id===r.employer_id)||d.tombstones?.some((a:Row)=>a.collection==='applications'&&a.employer_id===r.employer_id)?'有':'无';
 if(f==='month')return validDate(r.applied_date)?r.applied_date.slice(0,7):'';
 if(f==='salary_known')return !r.display_salary||['—','待核验','未知'].includes(r.display_salary)?'未披露':'已披露';
 if(f==='analysis_salary')return salaryBucket(r);
 if(f==='analysis_fit')return r.fit_score==null?'未评估':Number(r.fit_score)>=80?'80分及以上':Number(r.fit_score)>=60?'60–79分':'60分以下';
 return r[f];
}
export function salaryBucket(r:Row){const tag=r.salary_confidence==='D'?'（估算）':'';const annual=numberOrNull(r.annual_total_low),monthly=numberOrNull(r.monthly_low);const basis=r.currency&&r.currency!=='CNY'?` · ${text(r.currency)}`:'';if(annual!==null&&annual>0)return `年包下限 ${annual<150000?'低于15万':annual<250000?'15–25万':'25万及以上'}${tag}${basis}`;if(monthly!==null&&monthly>0)return `月薪下限 ${monthly<10000?'低于1万':monthly<15000?'1–1.5万':'1.5万及以上'}${tag}${basis}`;return !r.salary_text||/待核验|未知/.test(r.salary_text)?'未披露':'仅文字披露'+tag;}
export const effective=(c:Condition)=>['empty','not_empty'].includes(c.op)||!!c.value?.trim();
export function matches(d:CareerData,r:Row,c:Condition){
 const v=fieldValue(d,r,c.field),s=text(v).toLowerCase(),needle=(c.value||'').toLowerCase();
 if(c.op==='empty')return v==null||s==='';if(c.op==='not_empty')return v!=null&&s!=='';
 if(['before','after','date_equal','range'].includes(c.op)){const date=validDate(v),start=validDate(c.value),end=validDate(c.end);if(!date||!start)return false;if(c.op==='range')return !!end&&date>=start&&date<=end;return c.op==='before'?date<start:c.op==='after'?date>start:date===start;}
 if(['gte','lte','number_equal'].includes(c.op)){if(v==null||v===''||!Number.isFinite(Number(v))||!Number.isFinite(Number(c.value)))return false;return c.op==='gte'?Number(v)>=Number(c.value):c.op==='lte'?Number(v)<=Number(c.value):Number(v)===Number(c.value);}
 if(['any','all'].includes(c.op)){const parts=s.split(c.field==='resume_family'?/[^a-f]+/:/[、,，;；/\s]+/).filter(Boolean).map(x=>x.replace(/市$/,''));const wanted=needle.split(/[、,，;；/\s]+/).filter(Boolean).map(x=>x.replace(/市$/,''));return c.op==='all'?wanted.every(x=>parts.includes(x)):wanted.some(x=>parts.includes(x));}
 return c.op==='equal'?s===needle:c.op==='not_equal'?s!==needle:c.op==='not_contains'?!s.includes(needle):s.includes(needle);
}
export function filtered(d:CareerData,rows:Row[],q:Query){const conditions=(q.conditions||[]).filter(effective);return rows.filter(r=>{
 if(q.bankMode==='exclude'&&isBank(d,r)||q.bankMode==='only'&&!isBank(d,r))return false;
 if(r.record_kind!=='application'&&!q.showClosed&&(r.verification_status==='conflict'||r.is_open===false||(validDate(r.deadline)&&r.deadline<localToday())))return false;
 if(q.search&&!['company_name','job_title','industry','location_text','notes','apply_url'].some(k=>text(r[k]).toLowerCase().includes(q.search!.toLowerCase())))return false;
 return !conditions.length||(q.logic==='OR'?conditions.some(c=>matches(d,r,c)):conditions.every(c=>matches(d,r,c)));
});}
function cmpValue(a:any,b:any,field:string,desc=false){const empty=(v:any)=>v==null||v==='';if(empty(a)||empty(b))return empty(a)?empty(b)?0:1:-1;const c=field==='status'?Object.keys(statusColors).indexOf(a)-Object.keys(statusColors).indexOf(b):field==='priority'?('SABC'.includes(a)?'SABC'.indexOf(a):4)-('SABC'.includes(b)?'SABC'.indexOf(b):4):typeof a==='number'&&typeof b==='number'?a-b:collator.compare(text(a),text(b));return desc?-c:c;}
export function sorted(rows:Row[],q:Query,apps=false){const rules=q.sort?.length?q.sort:apps?[{field:'applied_date',desc:false}]:[{field:'priority',desc:false},{field:'job_title',desc:false}];const compare=(a:Row,b:Row)=>{for(const x of rules){const c=cmpValue(x.field==='applied_date'?validDate(a[x.field]):a[x.field],x.field==='applied_date'?validDate(b[x.field]):b[x.field],x.field,x.desc);if(c)return c;}return (apps?cmpValue(a.created_at,b.created_at,'created_at'):0)||collator.compare(keyOf(a),keyOf(b));};if(q.adjacent===false||(apps&&q.adjacent!==true))return [...rows].sort(compare);const blocks=new Map<string,Row[]>();for(const r of rows){const key=companyKey(r);blocks.set(key,[...(blocks.get(key)||[]),r]);}const lists=[...blocks.values()].map(b=>b.sort(compare));return lists.sort((a,b)=>{for(const rule of rules.slice(0,q.sort?.length?3:1)){const c=cmpValue(a[0][rule.field],b[0][rule.field],rule.field,rule.desc);if(c)return c;}return collator.compare(a[0].company_sort_name||a[0].company_name,b[0].company_sort_name||b[0].company_name)||collator.compare(companyKey(a[0]),companyKey(b[0]));}).flat();}
export function sections(d:CareerData,rows:Row[],q:Query,apps=false){if(!q.group)return [{name:'',rows:sorted(rows,q,apps)}];const m=new Map<string,Row[]>();for(const r of rows){const name=q.group==='company_name'?companyKey(r):text(fieldValue(d,r,q.group))||'未填写';m.set(name,[...(m.get(name)||[]),r]);}return [...m].sort(([a],[b])=>a==='未填写'?b==='未填写'?0:1:b==='未填写'?-1:cmpValue(a,b,q.group!,q.groupDesc)).map(([name,rs])=>({name:q.group==='company_name'?(rs[0].company_sort_name||rs[0].company_name):name,rows:sorted(rs,q,apps)}));}
export function scopedExport(d:CareerData,rows:Row[],apps:boolean){
 const keys=new Set(rows.map(keyOf));const applications=apps?rows.filter(r=>r.record_kind==='application').map(r=>d.applications.find(a=>a.id===r.id)!).filter(Boolean):[];
 const refs=new Set(applications.flatMap(a=>[...(a.opportunity_refs||[]).map((x:Row)=>x.kind+':'+x.record_id),...(a.source_job_id?['job:'+a.source_job_id]:[])]));
 const jobs=[...rows.filter(r=>r.record_kind==='job').map(r=>d.jobs.find(j=>j.id===r.id)!).filter(Boolean),...d.jobs.filter(j=>!keys.has('job:'+j.id)&&refs.has('job:'+j.id))];const leads=[...rows.filter(r=>r.record_kind==='lead').map(r=>d.leads.find((l:Row)=>l.id===r.id)).filter(Boolean),...d.leads.filter((l:Row)=>!keys.has('lead:'+l.id)&&refs.has('lead:'+l.id))];const employers=new Set([...jobs,...leads,...applications].map(r=>r.employer_id));
 return {format:'career-board-table-export',format_version:1,version:d.version,jobs,leads,applications,employers:d.employers.filter((e:Row)=>employers.has(e.id)),settings:d.settings,metadata:d.metadata,export_scope:'current_filtered_results',tombstones:[]} as CareerData;
}
export function tableExport(rows:Row[],apps:boolean){return rows.map(r=>apps?{'公司名称':r.company_name,'岗位名称':r.job_title,'阶段':r.status,'投递时间':r.applied_date,'工作地点':r.location_text,'薪资':r.display_salary,'备注':r.notes||''}:{'公司名称':r.company_name,'岗位名称':r.job_title,'优先级':r.priority,'推荐简历':r.resume_family||'','工作地点':r.location_text,'薪资':r.display_salary,'备注':r.notes||''});}

export function paginate(d:CareerData,input:Row[],q:Query,apps:boolean,page:number){
 const company=!apps&&q.layout!=='flat'&&!q.group;
 let allParts:{name:string;rows:Row[]}[];
 if(company){const ordered=sorted(input,{...q,adjacent:true});const groups=new Map<string,Row[]>();for(const r of ordered){const k=companyKey(r);groups.set(k,[...(groups.get(k)||[]),r]);}allParts=[...groups.values()].map(rows=>({name:rows[0].company_sort_name||rows[0].company_name,rows}));}
 else allParts=sections(d,input,{...q,adjacent:apps?false:q.sort?.length?false:true},apps);
 const ordered=allParts.flatMap(p=>p.rows);const serial=new Map(ordered.map((r,i)=>[keyOf(r),i+1]));
 const size=company?4:apps?12:10,total=company?allParts.length:ordered.length,pages=Math.max(1,Math.ceil(total/size)),current=Math.min(Math.max(1,page),pages);
 const chosen=company?allParts.slice((current-1)*size,current*size):allParts.map(p=>({...p,rows:p.rows.filter(r=>{const n=serial.get(keyOf(r))!-1;return n>=(current-1)*size&&n<current*size;})})).filter(p=>p.rows.length);
 return {ordered,parts:chosen.length?chosen:[{name:'',rows:[]}],pageRows:chosen.flatMap(p=>p.rows),serial,total,pages,current,size,company};
}
export function selectedScope(ordered:Row[],selected:React.Key[]){const keys=new Set(selected);return keys.size?ordered.filter(r=>keys.has(keyOf(r))):ordered;}
export function toggleSelection(selected:React.Key[],target:Row[]){const keys=target.map(keyOf),set=new Set(selected);const remove=keys.every(k=>set.has(k));for(const k of keys)remove?set.delete(k):set.add(k);return [...set];}
export function assessmentDone(r:Row){return r.status==='已测评'||(r.status_history||[]).some((h:Row)=>h.to==='已测评'||h.status==='已测评'||h.from==='已测评');}
