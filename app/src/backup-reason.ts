import type {Command} from './types';
import type {BackupEntry} from './backup-types';

const targets:Record<string,string>={jobs:'岗位',leads:'岗位信息',applications:'投递记录',employers:'公司信息'};
const fields:Record<string,string>={notes:'备注',status:'阶段',priority:'优先级',resume_family:'推荐简历',applied_date:'日期',next_action:'下一步动作',next_action_date:'下一步日期',salary_text:'薪资说明',location_text:'工作地点',city:'工作地点',apply_url:'链接',source_url:'来源链接',deadline:'截止日期',consideration_status:'考虑状态'};

// Only command kinds and field names are used. Values, names, URLs and note
// bodies never become backup reasons, and every reason describes a before-state.
export function commandBackupReason(command:Command):string {
 const direct:Record<string,string>={register:'登记投递前',register_many:'批量登记投递前',link:'关联投递前',unlink:'解除投递关联前',undo:'撤销操作前',redo:'重做操作前',settings:'修改设置前',save_view:'保存视图前',set_consideration:'修改考虑状态前'};
 if(command.type!=='batch')return direct[command.type]||'业务变更前';
 const ops=command.operations;
 if(!Array.isArray(ops)||!ops.length)return '批量业务变更前';
 if(ops.some(op=>!op||typeof op!=='object'||Array.isArray(op)))return '批量业务变更前';
 const first=ops[0],sameAction=ops.every(op=>op.action===first.action),sameCollection=ops.every(op=>op.collection===first.collection),many=ops.length>1;
 if(!sameAction)return '批量业务变更前';
 if(first.action==='delete'&&!sameCollection)return '批量删除前';
 if(!sameCollection||!targets[first.collection])return '批量业务变更前';
 const target=targets[first.collection],batch=many?'批量':'';
 const actions:Record<string,string>={add:'新增',delete:'删除',restore:'恢复',purge:'永久删除'};
 if(actions[first.action])return `${batch}${actions[first.action]}${target}前`;
 if(first.action!=='patch')return '批量业务变更前';
 const keys=Object.keys(first.fields||{});
 if(keys.length!==1||!fields[keys[0]]||!ops.every(op=>Object.keys(op.fields||{}).length===1&&Object.hasOwn(op.fields,keys[0])))return '批量业务变更前';
 const field=keys[0],subject=first.collection==='applications'?'投递':first.collection==='employers'?'公司':'岗位';
 return `${batch}修改${subject}${fields[field]}前`;
}

// Old metadata remains byte-for-byte untouched. A historic batch cannot tell us
// which fields changed; a legacy raw file cannot tell us its backup type.
export function displayBackupReason(entry:Pick<BackupEntry,'kind'|'reason'>):string {
 if(entry.kind==='legacy_unknown')return '旧版备份（类型未记录）';
 if(entry.kind==='manual')return entry.reason||'手动备份';
 if(entry.kind==='pre_restore')return entry.reason||'恢复前保护';
 const old:Record<string,string>={batch:'业务变更前（旧记录未细分）','业务变更':'业务变更前（旧记录未细分）',register:'登记投递前',register_many:'批量登记投递前',link:'关联投递前',unlink:'解除投递关联前',undo:'撤销操作前',redo:'重做操作前',settings:'修改设置前',save_view:'保存视图前',set_consideration:'修改考虑状态前'};
 return old[entry.reason]||(/[^\x00-\x7f]/.test(entry.reason)?entry.reason:'业务变更前（旧记录未细分）');
}
