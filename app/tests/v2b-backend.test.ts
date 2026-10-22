import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Storage} from '../electron/services/storage';
import {Board} from '../electron/services/board';
import {emptyData,prepareMigrationV2} from '../electron/services/migration-v2';
import {parseFullBackup} from '../electron/services/full-backup';
import {preparePersonalDirectory} from '../electron/services/personal-profile';
import type {CareerData} from '../src/types';
const base=path.resolve(process.env.CAREER_TEST_ROOT||'../work/v2b-backend-tests');
await fs.mkdir(base,{recursive:true});
export function fixture():CareerData{
 const d=emptyData();d.employers=[{id:'E1',canonical_name:'合成公司',display_name:'合成公司',aliases:[]}];
 d.jobs=[0,1,2].map(i=>({id:'J'+i,employer_id:'E1',company_name:'合成公司',job_title:'合成岗位'+i,location_text:i===1?'南京':'杭州',city_group:i===1?'南京':'杭州',priority:'A',canonical_opportunity_id:i<2?'OP-shared':'OP-sibling',apply_url:'https://example.com/jobs/'+i}));
 d.leads=[{id:'L1',employer_id:'E1',company_name:'合成公司',job_title:'合成方向',location_text:'天津',city_group:'滨海新区'}];
 d.extension={preserve:['x',null,0,false,{unknown:'kept'}]};return d;
}
async function setup(data?:CareerData){const dir=await fs.mkdtemp(path.join(base,'profile-'));if(data)await fs.writeFile(path.join(dir,'career-board.json'),JSON.stringify(data));const s=new Storage(dir),b=new Board(s);await b.load();return{s,b,dir,send:(c:any)=>b.execute({id:randomUUID(),...c})};}
test('BDEV02 empty factory, existing data and ownership never read seed',async()=>{
 const {b}=await setup();const d=(await b.load()).data!;for(const k of ['jobs','leads','applications','employers','tombstones'])assert.equal(d[k].length,0);
 const own=await fs.mkdtemp(path.join(base,'owned-'));preparePersonalDirectory(own);preparePersonalDirectory(own);
 assert.equal(JSON.parse(await fs.readFile(path.join(own,'career-board-owner.json'),'utf8')).appId,'cn.personal.careerboard.v2');
 const alien=await fs.mkdtemp(path.join(base,'alien-'));await fs.writeFile(path.join(alien,'career-board.json'),JSON.stringify(fixture()));assert.throws(()=>preparePersonalDirectory(alien),/归属/);
});
test('BDEV03/04 exact field preservation, idempotent migration, envelope and two-target restore',async()=>{
 const source=fixture();source.extra_missing_null=null;source.jobs[0].is_open=null as any;source.jobs[0].consideration_status='deferred';
 assert.deepEqual(prepareMigrationV2(source).data,source);assert.deepEqual(prepareMigrationV2(prepareMigrationV2(source).data).data,source);
 const first=await setup(),p=await first.b.previewRestore(JSON.stringify(source),'legacy.json');assert.equal(p.source_format,'legacy_raw');assert.ok(p.warnings.length);
 assert.deepEqual(await first.b.confirmRestore(p.token,p.target_revision),source);
 const reloaded=new Board(new Storage(first.dir));assert.deepEqual((await reloaded.load()).data,source);
 const envelope=await reloaded.fullBackup('合成备份');assert.deepEqual(envelope.data,source);assert.equal(envelope.backup.kind,'manual');assert.equal(envelope.backup.snapshot_relation,'after_flush');
 const second=await setup(),p2=await second.b.previewRestore(JSON.stringify(envelope),'full.json');assert.equal(p2.source_format,'full_backup');assert.deepEqual(await second.b.confirmRestore(p2.token,p2.target_revision),source);
 assert.throws(()=>parseFullBackup('[]'),/岗位导入/);assert.throws(()=>parseFullBackup(JSON.stringify({...source,export_scope:'filtered'})),/岗位导入/);
});
test('BDEV05 invalid JSON, future schema, invalid references preserve target',async()=>{
 const {b,s}=await setup(fixture()),before=await fs.readFile(s.file,'utf8');
 for(const bytes of ['{bad',JSON.stringify({...fixture(),version:999}),JSON.stringify({...fixture(),revision:-1})])await assert.rejects(()=>b.previewRestore(bytes,'bad.json'));
 const bad=fixture();bad.jobs[0].employer_id='MISSING';await assert.rejects(()=>b.previewRestore(JSON.stringify(bad),'bad-ref.json'),/引用/);
 const badKind=fixture();badKind.applications=[{id:'AP1',employer_id:'E1',company_name:'合成公司',job_title:'合成岗位',status:'已投递',applied_date:'2026-10-01',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',opportunity_refs:[{kind:'led',record_id:'L1'}]}];await assert.rejects(()=>b.previewRestore(JSON.stringify(badKind),'bad-kind.json'),/关联结构/);
 assert.equal(await fs.readFile(s.file,'utf8'),before);
});
test('BDEV05 fixed source bytes and revision conflict require repreview',async()=>{
 const {b,send}=await setup(fixture()),source=fixture();source.jobs[0].notes='fixed';const p=await b.previewRestore(JSON.stringify(source),'fixed.json');source.jobs[0].notes='changed outside';
 await send({type:'settings',fields:{stale_days:9}});await assert.rejects(()=>b.confirmRestore(p.token,p.target_revision),/目标数据已变化/);
 const refreshed=await b.refreshRestorePreview(p.token);const restored=await b.confirmRestore(refreshed.token,refreshed.target_revision);assert.equal(restored.jobs[0].notes,'fixed');
 assert.equal((await send({type:'undo'})).result,'no_change');
});
test('BDEV05 protection failure, rename failure and readback failure retain original disk/memory',async()=>{
 const {b,s}=await setup(fixture()),source=fixture();source.jobs[0].notes='replacement';const before=await fs.readFile(s.file,'utf8');
 let p=await b.previewRestore(JSON.stringify(source),'s.json');const write=(s as any).writeEnvelope;(s as any).writeEnvelope=async()=>{throw Error('synthetic protect failure');};await assert.rejects(()=>b.confirmRestore(p.token,p.target_revision),/保护未完成/);(s as any).writeEnvelope=write;
 assert.equal(await fs.readFile(s.file,'utf8'),before);
 const rename=fs.rename;let once=true;fs.rename=async(a,b)=>{if(once&&String(a)===s.file+'.tmp'){once=false;throw Error('synthetic rename failure');}return rename(a,b);};
 try{await assert.rejects(()=>b.confirmRestore(p.token,p.target_revision),/已恢复操作前/);}finally{fs.rename=rename;}
 assert.deepEqual(JSON.parse(await fs.readFile(s.file,'utf8')),JSON.parse(before));
 p=await b.refreshRestorePreview(p.token);const read=s.readExact.bind(s);let calls=0;s.readExact=async()=>{calls++;if(calls===2)throw Error('synthetic readback failure');return read();};
 await assert.rejects(()=>b.confirmRestore(p.token,p.target_revision),/已恢复操作前/);s.readExact=read;
 assert.deepEqual((await b.load()).data,JSON.parse(before));assert.deepEqual(await s.readExact(),JSON.parse(before));
});
test('BDEV05 unconfirmed rollback locks further writes',async()=>{
 const {b,s,send}=await setup(fixture()),p=await b.previewRestore(JSON.stringify(fixture()),'s.json'),read=s.readExact.bind(s);let calls=0;
 s.readExact=async()=>{if(++calls>=2)throw Error('synthetic repeated read failure');return read();};
 await assert.rejects(()=>b.confirmRestore(p.token,p.target_revision),/已锁定/);s.readExact=read;
 await assert.rejects(()=>send({type:'settings',fields:{stale_days:44}}),/已锁定/);
});
test('B01-B04/BDEV06 auto before, manual after-flush, protected and legacy outlive rotation',async()=>{
 const {b,s,send}=await setup(fixture());await send({type:'settings',fields:{stale_days:8}});const manual=await b.backup('合成手工备注'),manualData=parseFullBackup(await s.readBackup(manual.name)).data;assert.equal(manualData.settings.stale_days,8);
 const p=await b.previewRestore(JSON.stringify(fixture()),'s.json');await b.confirmRestore(p.token,p.target_revision);
 const legacy='career-board_2026-10-07T13-06-37-477Z_abcdef12.json';await fs.writeFile(path.join(s.backups,legacy),JSON.stringify(fixture()));
 for(let i=0;i<14;i++)await send({type:'settings',fields:{stale_days:20+i}});
 const entries=await s.listDetails();assert.equal(entries.filter(e=>e.kind==='auto').length,10);assert.equal(entries.filter(e=>e.kind==='manual').length,1);assert.ok(entries.some(e=>e.kind==='pre_restore'));assert.ok(entries.some(e=>e.name===legacy&&e.kind==='legacy_unknown'&&e.snapshot_relation==='unknown'));
 const auto=entries.find(e=>e.kind==='auto')!;assert.equal(parseFullBackup(await s.readBackup(auto.name)).data.settings.stale_days,32);assert.equal(auto.snapshot_relation,'before');
 const count=entries.length;await b.checkpoint((await b.load()).data!.revision);assert.equal((await s.list()).length,count);assert.equal(new Set(entries.map(e=>e.name)).size,entries.length);
});
test('I01-I05/BDEV09 consideration scoped atomic persistent undo and repeat no-op',async()=>{
 const {b,s,send}=await setup(fixture());let r=await send({type:'set_consideration',targets:[{kind:'job',record_id:'J0'}],value:'deferred'});assert.equal(r.data.jobs[0].consideration_status,'deferred');assert.equal(r.data.jobs[1].consideration_status,'deferred');assert.equal(r.data.jobs[2].consideration_status,undefined);
 const noop=await send({type:'set_consideration',targets:[{kind:'job',record_id:'J1'}],value:'deferred'});assert.equal(noop.result,'no_change');assert.equal(noop.undo,r.undo);
 await assert.rejects(()=>send({type:'set_consideration',targets:[{kind:'job',record_id:'J2'},{kind:'job',record_id:'bad'}],value:'deferred'}));assert.equal((await b.load()).data!.jobs[2].consideration_status,undefined);
 assert.equal((await send({type:'register',record_id:'J0'})).result,'needs_consideration_confirmation');
 const app=await send({type:'register',record_id:'J0',confirm_consideration:true});assert.equal(app.result,'created');assert.equal(app.data.jobs[0].consideration_status,'active');
 await send({type:'batch',operations:[{action:'patch',collection:'applications',record_id:app.application_id,fields:{status:'待一面',notes:'合成原备注'}}]});
 await send({type:'set_consideration',targets:[{kind:'job',record_id:'J0'}],value:'deferred'});const old=(await b.load()).data!,bytes=await fs.readFile(s.file,'utf8');
 await Promise.all([send({type:'register',record_id:'J0',confirm_consideration:true}),send({type:'register',record_id:'J1',confirm_consideration:true})]);assert.equal(await fs.readFile(s.file,'utf8'),bytes);assert.deepEqual((await b.load()).data,old);
 const restored=await send({type:'set_consideration',targets:[{kind:'job',record_id:'J0'}],value:'active'});assert.deepEqual(restored.data.applications,old.applications);
 await send({type:'undo'});assert.equal((await b.load()).data!.jobs[0].consideration_status,'deferred');await send({type:'redo'});assert.equal((await new Board(new Storage(s.dir)).load()).data!.jobs[0].consideration_status,'active');
});
test('BDEV09 batch registration activates only newly created confirmed rows',async()=>{
 const {b,send}=await setup(fixture());await send({type:'register',record_id:'J0'});await send({type:'set_consideration',targets:[{kind:'job',record_id:'J0'},{kind:'job',record_id:'J2'}],value:'deferred'});
 const r=await send({type:'register_many',targets:[{kind:'job',record_id:'J0'},{kind:'job',record_id:'J2'}],confirm_consideration:true});assert.equal(r.data.jobs[0].consideration_status,'deferred');assert.equal(r.data.jobs[2].consideration_status,'active');assert.equal(r.data.applications.length,2);
});
test('BDEV09 explicit imported consideration value uses one transaction and shared identity',async()=>{
 const {b,send}=await setup(fixture());await send({type:'set_consideration',targets:[{kind:'job',record_id:'J0'}],value:'deferred'});
 const patched=await send({type:'batch',operations:[{collection:'jobs',action:'patch',record_id:'J0',fields:{notes:'合成导入字段'}}]});assert.equal(patched.data.jobs[0].consideration_status,'deferred');
 const changed=await send({type:'batch',operations:[{collection:'jobs',action:'patch',record_id:'J0',fields:{consideration_status:'active'}}]});assert.equal(changed.data.jobs[0].consideration_status,'active');assert.equal(changed.data.jobs[1].consideration_status,'active');assert.equal(changed.data.jobs[2].consideration_status,undefined);
 await assert.rejects(()=>send({type:'batch',operations:[{collection:'jobs',action:'patch',record_id:'J0',fields:{consideration_status:'invalid'}}]}),/考虑状态/);
 await send({type:'undo'});assert.equal((await b.load()).data!.jobs[0].consideration_status,'deferred');
});
