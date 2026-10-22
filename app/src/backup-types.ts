import type {CareerData} from './types';
export type BackupKind='auto'|'manual'|'pre_restore'|'legacy_unknown';
export interface BackupEntry {
 name:string; kind:BackupKind; created_at:string|null; note:string; reason:string;
 snapshot_relation:'before'|'after_flush'|'before_restore'|'unknown';
 snapshot_updated_at:string|null; data_revision:number|null; time_source:'metadata'|'filename'|'filesystem';
 data_schema:number|null; app_version:string|null;
}
export interface FullBackup {
 format:'career-board-full-backup'; format_version:1;
 backup:{id:string;kind:Exclude<BackupKind,'legacy_unknown'>;created_at:string;snapshot_updated_at:string|null;
 snapshot_relation:'before'|'after_flush'|'before_restore';reason:string;note:string;app_version:string;data_schema:number;data_revision:number};
 data:CareerData;
}
export interface DataSummary {jobs:number;leads:number;employers:number;applications:number;active_applications:number;deleted_applications:number;tombstones:number;revision:number;statuses:Record<string,number>}
export interface RestorePreview {
 token:string;source_name:string;source_hash:string;source_format:'full_backup'|'legacy_raw';
 target_revision:number;target_kind:'normal'|'corrupt'|'missing';source_summary:DataSummary;target_summary:DataSummary|null;warnings:string[];
}
