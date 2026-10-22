import type {CareerData,Application} from './types';
export type Row=Record<string,any>;
export const active=(r:Row)=>!r.deleted_at;
export const localToday=()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;};
export const identity=(r:Row)=>r.canonical_opportunity_id?`${r.employer_id}|${r.canonical_opportunity_id}`:String(r.id);
export function linked(a:Application,r:Row,kind='job'){
 return (kind==='job'&&a.source_job_id===r.id)||(kind==='job'&&a.employer_id===r.employer_id&&!!r.canonical_opportunity_id&&a.canonical_opportunity_id===r.canonical_opportunity_id)||(a.opportunity_refs||[]).some((x:Row)=>x.kind===kind&&(x.record_id===r.id||(kind==='job'&&(x.employer_id||a.employer_id)===r.employer_id&&x.canonical_opportunity_id&&x.canonical_opportunity_id===r.canonical_opportunity_id)));
}
export function candidates(d:CareerData,r:Row){
 return d.applications.filter(a=>active(a)&&!(a.opportunity_refs||[]).length&&!a.source_job_id&&a.employer_id===r.employer_id&&!(a.recruitment_batch&&r.recruitment_batch&&a.recruitment_batch!==r.recruitment_batch)&&((a.candidate_job_ids||[]).includes(r.id)||a.job_title===r.job_title||(a.job_title.length>2&&String(r.job_title).includes(a.job_title))));
}
export function jobState(d:CareerData,r:Row,kind='job'){
 const a=d.applications.find(a=>linked(a,r,kind));
 if(a)return {state:a.deleted_at?'in_trash':'registered',application:a};
 if((d.tombstones||[]).some((t:Row)=>t.collection==='applications'&&linked(t as Application,r,kind)))return {state:'deleted',application:undefined};
 return {state:kind==='job'&&candidates(d,r).length?'pending':'unregistered',application:undefined};
}
export function companyMetrics(d:CareerData,id:string,visible:Row[]){
 const applications=d.applications.filter(a=>a.employer_id===id);const jobs=visible.filter(r=>r.record_kind!=='lead');const unique=[...new Map(jobs.map(r=>[identity(r),r])).values()];
 const registered=unique.filter(r=>jobState(d,r).state==='registered').length;
 return {applications:applications.length,jobs:unique.length,registered,unregistered:unique.filter(r=>jobState(d,r).state==='unregistered').length,pending:unique.filter(r=>jobState(d,r).state==='pending').length,in_trash:unique.filter(r=>jobState(d,r).state==='in_trash').length,leads:visible.length-jobs.length,statuses:applications.reduce((o:Row,a)=>(o[a.status]=(o[a.status]||0)+1,o),{})};
}
export function poolRows(d:CareerData,group:string){return [...d.jobs.map(j=>({...j,record_kind:'job'})),...(d.leads||[]).map((l:Row)=>({...l,record_kind:'lead',job_title:l.job_title||l.job_direction_raw||'待核验企业方向',location_text:l.location_text||[l.actual_city,l.actual_district].filter(Boolean).join('·'),priority:l.priority||''}))].filter(r=>active(r)&&(r.city_group===group||(r.eligible_city_groups||[]).includes(group)));}
export function filterRows(d:CareerData,rows:Row[],q:Row){return rows.filter(r=>{
 if(r.verification_status==='conflict'&&!['all','only'].includes(q.conflicts))return false;if(q.conflicts==='only'&&r.verification_status!=='conflict')return false;
 const s=jobState(d,r,r.record_kind==='lead'?'lead':'job');const history=d.applications.some(a=>a.employer_id===r.employer_id);
 if(q.search&&!`${r.company_name} ${r.job_title} ${r.notes||''}`.toLowerCase().includes(String(q.search).toLowerCase()))return false;
 if(q.quick==='unregistered_jobs'&&(r.record_kind==='lead'||s.state!=='unregistered'))return false;
 if(q.quick==='registered_jobs'&&(r.record_kind==='lead'||s.state!=='registered'))return false;
 if(q.quick==='employers_without_applications'&&history)return false;
 if(q.quick==='pending_links'&&s.state!=='pending')return false;
 if(q.resume&&!String(r.resume_family||'').split(/[^A-F]+/).includes(q.resume))return false;if(q.priority&&r.priority!==q.priority)return false;
 if(q.favorite&&!r.is_favorite)return false;
 if(q.dimension&&q.bucket&&analysisBucket(d,r,q.dimension)!==q.bucket)return false;
 return true;
});}
export function analysisBucket(d:CareerData,r:Row,dimension:string){
 if(dimension==='coverage')return r.record_kind==='lead'?'企业线索（不计岗位覆盖）':({registered:'已投岗位',unregistered:'未投岗位',pending:'待确认关联',in_trash:'申请在回收站',deleted:'申请已永久删除'} as Row)[jobState(d,r).state];
 if(dimension==='salary'){if(r.record_kind==='lead')return '线索薪资（待核验）';if(r.salary_confidence==='Unknown'||!r.salary_text)return '未知薪资';const basis=r.salary_confidence==='D'?'估算':'有来源披露';const year=r.annual_total_low!=null,month=r.monthly_low!=null;const low=Number(year?r.annual_total_low:r.monthly_low);const interval=year?(low<150000?'下限＜15万元':low<250000?'下限15–25万元':'下限≥25万元'):month?(low<10000?'下限＜1万元':low<15000?'下限1–1.5万元':'下限≥1.5万元'):'';return [basis,year?'年包口径':month?'月薪口径':'文本口径',interval,year||month?`${r.currency||'币种待核'} / ${r.tax_basis||'税前税后待核'}`:''].filter(Boolean).join(' · ');}
 if(dimension==='fit')return r.fit_score==null?'匹配待核验':Number(r.fit_score)>=80?'匹配 ≥80':Number(r.fit_score)>=60?'匹配 60–79':'匹配 <60';
 if(dimension==='deadline')return !r.deadline?'期限待核验':r.deadline<localToday()?'已过截止':r.deadline<=new Date(Date.now()+7*86400000).toLocaleDateString('sv-SE')?'七日内截止':'七日后截止';
 return String(r[dimension]||'待核验');
}
