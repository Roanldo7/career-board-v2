import test from 'node:test';
import assert from 'node:assert/strict';
import {autoMapping,mapRows,mergeJobs,openStatus,numberOrNull} from '../src/utils';
import {filtered,projection,nextBankMode,isBank,rowTone,salaryBucket,paginate,selectedScope,tableExport,scopedExport,keyOf} from '../src/presentation';
import type {CareerData,Job} from '../src/types';

const job=(id:string,extra:Record<string,unknown>={}):Job=>({id,company_name:'合成企业'+id,job_title:'产品岗位',location_text:'杭州',city_group:'杭州',priority:'A',employer_id:'E'+id,apply_url:'https://example.com/jobs/'+id,...extra});
const data=(jobs:Job[]):CareerData=>({version:2,revision:0,jobs,leads:[],applications:[],employers:jobs.map(j=>({id:j.employer_id,canonical_name:j.company_name,aliases:[]})),tombstones:[],saved_views:[],settings:{stale_days:7,show_expired:false,binhai_salary_ratio:0.9},metadata:{created_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-07T00:00:00Z',seed_version:'synthetic'}});

test('D12 D13 D15: blank/unknown recruiting values stay visible; explicit false stays closed',()=>{
 for(const value of [undefined,null,'','  ','Unknown','待核验','未知'])assert.equal(openStatus(value),undefined);
 for(const value of [false,0,'false','0','否','停止招聘','已截止'])assert.equal(openStatus(value),false);
 for(const value of [true,1,'true','1',' 是 ','在招'])assert.equal(openStatus(value),true);
 const rows=[undefined,null,'','  ','Unknown','待核验',false,0,'否'].map((value,i)=>({'公司名称':'合成'+i,'岗位名称':'数据分析','工作地点':'杭州','apply_url':'https://example.com/'+i,'is_open':value}));
 const mapped=mapRows(rows,autoMapping(Object.keys(rows[0])),'杭州');
 assert.deepEqual(mapped.errors,[]);
 const d=data(mapped.jobs);
 assert.equal(filtered(d,projection(d,'杭州'),{}).length,6);
 assert.equal(filtered(d,projection(d,'杭州'),{search:'合成2'}).length,1);
 assert.equal(filtered(d,projection(d,'杭州'),{showClosed:true}).length,9);
 assert.equal(mapped.jobs[1].is_open,null);
 assert.equal(Object.hasOwn(mapped.jobs[2],'is_open'),false);
});

test('D15 S01 S02: minimal import succeeds; numeric salary keeps Unknown evidence, invalid numbers do not bucket',()=>{
 const mapped=mapRows([{company_name:'合成公司',job_title:'运营',location_text:'南京',apply_url:'www.example.com/jobs',salary_confidence:'Unknown',monthly_low:'12000'}],autoMapping(['company_name','job_title','location_text','apply_url','salary_confidence','monthly_low']),'南京');
 assert.deepEqual(mapped.errors,[]);assert.equal(mapped.jobs[0].salary_confidence,'Unknown');
 assert.match(salaryBucket(mapped.jobs[0]),/月薪下限 1–1.5万/);
 assert.match(salaryBucket({annual_total_low:180000,salary_confidence:'Unknown'}),/年包下限 15–25万/);
 for(const v of ['',null,undefined,NaN,Infinity,'bad','9'.repeat(400),-3,0])assert.equal(salaryBucket({monthly_low:v}),'未披露');
 assert.equal(numberOrNull('9'.repeat(400)),null);
 assert.notEqual(salaryBucket({monthly_low:12000,currency:'CNY'}),salaryBucket({monthly_low:12000,currency:'USD'}));
 assert.equal(salaryBucket({salary_text:'面议，项目奖金另计'}),'仅文字披露');
});

test('BDEV09: ordinary missing consideration input cannot erase author deferred; explicit input is honored',()=>{
 const original=job('X',{consideration_status:'deferred',notes:'原有备注'});
 const incoming=job('X',{notes:'导入新备注'});
 for(const strategy of ['overwrite','merge'] as const){
  assert.equal(mergeJobs([original],[incoming],strategy).jobs[0].consideration_status,'deferred');
  assert.equal(mergeJobs([original],[{...incoming,consideration_status:'active'}],strategy).jobs[0].consideration_status,'active');
 }
 assert.deepEqual(mergeJobs([original],[incoming],'skip').jobs,[original]);
 const mapping=autoMapping(['company_name','job_title','location_text','consideration_status']);
 assert.equal(mapping.consideration_status,'consideration_status');
 const blank=mapRows([{...incoming,consideration_status:' '}],mapping,'杭州').jobs[0];
 assert.equal(Object.hasOwn(blank,'consideration_status'),false);
 assert.equal(mergeJobs([original],[{...blank,id:'X'}],'overwrite').jobs[0].consideration_status,'deferred');
});

test('I06 I07: single bank cycle and alias match use the same AND-filtered export/selection population',()=>{
 const d=data([job('1',{company_name:'合成银行',job_title:'数据'}),job('2',{company_name:'合成科技',job_title:'数据',notes:'服务银行行业'}),job('3',{company_name:'合成简称',job_title:'产品'})]);
 d.employers[2].aliases=['合成城市银行'];
 assert.equal(nextBankMode('all'),'exclude');assert.equal(nextBankMode('exclude'),'only');assert.equal(nextBankMode('only'),'exclude');
 const all=projection(d,'杭州');assert.equal(isBank(d,all[1]),false);assert.equal(isBank(d,all[2]),true);
 assert.equal(filtered(d,all,{}).length,3);
 assert.equal(filtered(d,all,{bankMode:'exclude'}).length,1);
 const banks=filtered(d,all,{bankMode:'only',search:'数据'});
 assert.equal(banks.length,1);assert.equal(banks[0].id,'1');
 assert.equal(tableExport(selectedScope(banks,[]),false).length,1);
 assert.equal(scopedExport(d,banks,false).jobs.length,1);
 assert.equal(filtered(d,all,{bankMode:'exclude',conditions:[{field:'job_title',op:'equal',value:'产品'}],logic:'OR'}).length,0);
 d.employers[1].display_name='合成展示银行';
 assert.equal(isBank(d,all[1]),true);
 assert.equal(filtered(d,all,{bankMode:'only'}).length,3);
});

test('I01 I02 I04: deferred tone wins over an explicit application; restore does not remove that application',()=>{
 const d=data([job('1'),job('2',{employer_id:'E1'}),job('3')]);
 d.applications=[{id:'A1',company_name:'合成企业1',job_title:'产品岗位',status:'待一面',applied_date:'2026-10-07',created_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-07T00:00:00Z',source_job_id:'1',employer_id:'E1'}];
 let rows=projection(d,'杭州');
 assert.equal(rowTone(d,rows[0]),'registered');assert.equal(rowTone(d,rows[1]),'default');
 d.jobs[0].consideration_status='deferred';rows=projection(d,'杭州');assert.equal(rowTone(d,rows[0]),'deferred');
 d.jobs[0].consideration_status='active';rows=projection(d,'杭州');assert.equal(rowTone(d,rows[0]),'registered');assert.equal(d.applications[0].status,'待一面');
 d.jobs[2].consideration_status='deferred';assert.equal(rowTone(d,projection(d,'杭州')[2]),'deferred');
 d.jobs[2].consideration_status='active';assert.equal(rowTone(d,projection(d,'杭州')[2]),'default');
});

test('I04 I14: shared opportunity ID has one persistent consideration value across city projections',()=>{
 const d=data([job('shared',{eligible_city_groups:['杭州','南京'],consideration_status:'deferred'}),job('sibling')]);
 assert.equal(projection(d,'南京').length,1);
 assert.equal(keyOf(projection(d,'杭州')[0]),keyOf(projection(d,'南京')[0]));
 assert.equal(rowTone(d,projection(d,'南京')[0]),'deferred');assert.equal(rowTone(d,projection(d,'杭州')[1]),'default');
});

test('I09 I10 I14: eighth company page clamps only when needed; ID selection and all-page export retained',()=>{
 const d=data(Array.from({length:36},(_,i)=>job(String(i))));
 const rows=projection(d,'杭州');const eighth=paginate(d,rows,{},false,8);
 assert.equal(eighth.current,8);assert.equal(eighth.parts.length,4);assert.equal(eighth.serial.get(keyOf(eighth.pageRows[0])),29);
 assert.equal(paginate(d,rows.slice(0,25),{},false,8).current,7);
 assert.equal(paginate(d,rows,{layout:'flat'},false,2).pageRows.length,10);
 assert.equal(paginate(d,rows,{},true,2).pageRows.length,12);
 const selected=[keyOf(eighth.pageRows[0]),keyOf(rows[0])];
 assert.equal(selectedScope(rows,selected).length,2);assert.equal(selectedScope(rows,[]).length,36);
});

test('BDEV04: new range JSON identifies itself and never claims to be a full backup',()=>{
 const d=data([job('1'),job('2')]);const output=scopedExport(d,projection(d,'杭州').slice(0,1),false);
 assert.equal(output.format,'career-board-table-export');assert.equal(output.format_version,1);
 assert.equal(output.export_scope,'current_filtered_results');assert.equal(output.jobs.length,1);
 assert.deepEqual(output.tombstones,[]);assert.equal(d.jobs.length,2);
});
