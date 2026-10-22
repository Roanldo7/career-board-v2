import test from 'node:test';
import assert from 'node:assert/strict';
import {commandBackupReason,displayBackupReason} from '../src/backup-reason';
import type {Command} from '../src/types';

const batch=(operations:any[]):Command=>({id:'synthetic-command',type:'batch',operations});
test('HF-U01 known field and action reasons are Chinese, before-state and never embed private values',()=>{
 const secret='synthetic-private-note https://example.com/?token=synthetic-only';
 const phase=batch([{collection:'applications',action:'patch',record_id:'application-secret',fields:{status:'待一面'},expected:{status:'已投递'}}]);
 assert.equal(commandBackupReason(phase),'修改投递阶段前');
 assert.equal(commandBackupReason(batch([{collection:'jobs',action:'patch',record_id:'secret',fields:{notes:secret}}])),'修改岗位备注前');
 assert.equal(commandBackupReason(batch([{collection:'jobs',action:'delete',record_id:'j1'},{collection:'jobs',action:'delete',record_id:'j2'}])),'批量删除岗位前');
 assert.equal(commandBackupReason(batch([{collection:'jobs',action:'delete',record_id:'j1'},{collection:'applications',action:'delete',record_id:'a1'}])),'批量删除前');
 for(const type of ['register','register_many','link','unlink','undo','redo','settings','set_consideration']){const reason=commandBackupReason({id:'test',type,notes:secret,value:'deferred'});assert.match(reason,/前$/);assert.doesNotMatch(reason,/secret|synthetic|https|token=/);assert.notEqual(reason,type);}
});

test('HF-U01 mixed or uncertain operation sets keep an accurate broad reason',()=>{
 const patch={collection:'jobs',action:'patch',record_id:'j1',fields:{notes:'synthetic'}};
 assert.equal(commandBackupReason(batch([patch,{collection:'jobs',action:'delete',record_id:'j2'}])),'批量业务变更前');
 assert.equal(commandBackupReason(batch([patch,{...patch,fields:{priority:'A'}}])),'批量业务变更前');
 assert.equal(commandBackupReason(batch([{...patch,fields:{notes:'synthetic',priority:'A'}}])),'批量业务变更前');
 assert.equal(commandBackupReason(batch([{...patch,fields:{unrecognized:'synthetic'}}])),'批量业务变更前');
 assert.equal(commandBackupReason(batch([])),'批量业务变更前');
});

test('HF-U02 historic batch is display-only unspecified; legacy and manual semantics stay truthful',()=>{
 const old={kind:'auto' as const,reason:'batch'},bytes=JSON.stringify(old);
 assert.equal(displayBackupReason(old),'业务变更前（旧记录未细分）');assert.equal(JSON.stringify(old),bytes);
 assert.equal(displayBackupReason({kind:'legacy_unknown',reason:'batch'}),'旧版备份（类型未记录）');
 assert.equal(displayBackupReason({kind:'auto',reason:'修改岗位备注前'}),'修改岗位备注前');
 assert.equal(displayBackupReason({kind:'manual',reason:'手动备份'}),'手动备份');
 assert.equal(displayBackupReason({kind:'pre_restore',reason:'恢复前保护'}),'恢复前保护');
});
