import type {BackupEntry,RestorePreview} from './backup-types';
import type {ReadingPreferences} from './preference-types';
export const groups=['杭州','南京','滨海新区','其他强推'] as const;
export type Group=typeof groups[number];
export type Priority='S'|'A'|'B'|'C';
export type Cell=string|number|boolean|null|undefined;
export type ImportRow=Record<string,unknown>;
export type ImportMapping=Record<string,string>;
export interface Job {
 id:string; company_name:string; job_title:string; location_text:string; city_group:Group;
 priority:Priority; company_nature?:string; industry?:string; job_family?:string; recruitment_type?:string;
 eligible_city_groups?:string[]; location_city?:string; location_district?:string|null;
 salary_text?:string|null; salary_confidence?:string; monthly_low?:number|null; monthly_high?:number|null;
 salary_months?:number|null; annual_total_low?:number|null; annual_total_high?:number|null;
 benefits_summary?:string; salary_basis?:string; salary_source_url?:string|null;
 fit_score?:number|null; fit_label?:string; opportunity_score?:number|null; opportunity_confidence?:string;
 compensation_score?:number|null; compensation_assessment?:string; priority_reason?:string;
 platform_growth_notes?:string; matched_points?:string[]; gaps?:string[]; hard_risks?:string[];
 resume_family?:string; recommendation_reason?:string; posted_at?:string|null; deadline?:string|null;
 verified_at?:string|null; apply_url?:string; source_url?:string; source_type?:string; evidence_urls?:string[];
 apply_url_check?:string; review_phase?:string; is_open?:boolean|null; consideration_status?:'active'|'deferred'; is_favorite?:boolean; notes?:string;
 updated_at?:string; manual_priority_override?:boolean;
 [key:string]:unknown;
}
export interface Application {
 [key:string]:any;
 id:string; company_name:string; job_title:string; company_nature?:string; industry?:string;
 apply_url?:string; job_description?:string; city?:string; status:string; applied_date:string;
 deadline?:string|null; resume_version?:string; source_job_id?:string; referral_code?:string;
 next_action?:string; next_action_date?:string|null; notes?:string; created_at:string; updated_at:string;
}
export interface Settings {binhai_salary_ratio:number;show_expired:boolean;stale_days:number;[key:string]:any}
export interface CareerData {version:1|2;jobs:Job[];applications:Application[];settings:Settings;metadata:{created_at:string;updated_at:string;seed_version:string};[key:string]:any}
export interface Command {id:string;type:string;revision?:number;[key:string]:any}
export interface CommandResult {[key:string]:any;data:CareerData;result:string;application_id?:string;candidates?:string[];permanently_deleted?:boolean;undo:number;redo:number}
export interface LoadResult {data:CareerData|null; dataPath:string; recovery?:{message:string;backups:string[];kind:'corrupt'|'missing'|'blocked';canRestore:boolean}}
export interface ImportFile {name:string;rows:ImportRow[];sheets:string[];sheet:string;token:string}
export interface CareerAPI {
 confirmSaved(revision:number):Promise<{revision:number}>; requestClose(revision:number):Promise<void>;
 requestRecoveryClose():Promise<void>;
 command(command:Command):Promise<CommandResult>; onBeforeClose(fn:()=>Promise<boolean>):()=>void;
 loadData():Promise<LoadResult>; saveData(data:CareerData):Promise<CareerData>;
 backupData(note?:string):Promise<BackupEntry>; listBackups():Promise<BackupEntry[]>; restoreBackup(name:string):Promise<CareerData>;
 chooseRestoreFile():Promise<RestorePreview|null>; previewBackup(name:string):Promise<RestorePreview>;
 refreshRestorePreview(token:string):Promise<RestorePreview>; confirmRestore(token:string,revision:number):Promise<CareerData>;
 exportFullBackup(note?:string):Promise<string|null>;
 getPreferences():Promise<{preferences:ReadingPreferences;warning?:string}>;
 savePreferences(value:ReadingPreferences):Promise<void>;flushPreferences():Promise<void>;
 reinitialize():Promise<CareerData>; chooseImportFile():Promise<ImportFile|null>; readImportFile(token:string,sheet:string):Promise<ImportFile>;
 exportFile(kind:'csv'|'xlsx'|'json',rows:ImportRow[]|CareerData):Promise<string|null>;
 openExternal(url:string):Promise<void>; openDataFolder():Promise<void>;
}
declare global {interface Window {careerAPI:CareerAPI}}
