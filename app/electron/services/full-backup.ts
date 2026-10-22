import appPackage from '../../package.json';
import {randomUUID} from 'node:crypto';
import type {CareerData} from '../../src/types';
import type {FullBackup,DataSummary} from '../../src/backup-types';
import {prepareMigrationV2,validateRelations} from './migration-v2';
export const backupFormat='career-board-full-backup';
export function summarize(d:CareerData):DataSummary{return{jobs:d.jobs.length,leads:(d.leads||[]).length,employers:(d.employers||[]).length,applications:d.applications.length,active_applications:d.applications.filter(a=>!a.deleted_at).length,deleted_applications:d.applications.filter(a=>!!a.deleted_at).length,tombstones:(d.tombstones||[]).length,revision:d.revision??0,statuses:d.applications.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{} as Record<string,number>)};}
export function fullBackup(d:CareerData,kind:FullBackup['backup']['kind'],note='',reason='手动备份'):FullBackup {
 validateRelations(d);
 return{format:backupFormat,format_version:1,backup:{id:randomUUID(),kind,created_at:new Date().toISOString(),snapshot_updated_at:d.metadata?.updated_at??null,snapshot_relation:kind==='auto'?'before':kind==='pre_restore'?'before_restore':'after_flush',reason,note:String(note).slice(0,160),app_version:appPackage.version,data_schema:d.version,data_revision:d.revision??0},data:structuredClone(d)};
}
export function parseFullBackup(bytes:string){
 let raw:any;try{raw=JSON.parse(bytes);}catch{throw Error('JSON 无法解析，原数据未修改');}
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.export_scope||raw.format==='career-board-scoped-export')throw Error('这是表格范围导出，请使用岗位导入；整库恢复需要完整备份');
 const envelope=raw.format===backupFormat;
 if(raw.format&&!envelope)throw Error('无法识别的备份格式');
 if(envelope&&(raw.format_version!==1||!raw.backup||!['auto','manual','pre_restore'].includes(raw.backup.kind)))throw Error('完整备份版本或元信息不兼容');
 const input=envelope?raw.data:raw;
 const data=prepareMigrationV2(input).data;
 validateRelations(data);
 return{data,source_format:(envelope?'full_backup':'legacy_raw') as 'full_backup'|'legacy_raw',warnings:envelope?[]:['旧版 JSON 结构可读，但仅凭内容不能认证它未被裁剪。请确认来自完整备份；恢复将整库替换。']};
}
