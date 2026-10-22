import {useEffect,useState} from 'react';
import {Alert,App,Button,Card,Drawer,Input,Modal,Pagination,Space,Tabs,Typography} from 'antd';
import type {BackupEntry,DataSummary,RestorePreview} from './backup-types';
import type {CareerData} from './types';
import {flushEdits} from './InlineCell';
import {useStore} from './store';
import {displayBackupReason} from './backup-reason';

const localTime=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'时间未记录';
const kindLabel={auto:'自动备份 · 操作前',manual:'人工备份 · 保存后',pre_restore:'恢复前保护 · 长期保留',legacy_unknown:'旧版备份 · 类型未记录'};
const summary=(s:DataSummary)=>`公司 ${s.employers} · 岗位 ${s.jobs} · 企业信息 ${s.leads} · 活动申请 ${s.active_applications} · 已删除申请 ${s.deleted_applications} · 删除保护 ${s.tombstones}`;

export default function BackupPanel({open,onClose,onRestored,onReset,recoveryMode=false}:{open:boolean;onClose:()=>void;onRestored:(data:CareerData)=>void;onReset:()=>void;recoveryMode?:boolean}){
 const {message}=App.useApp();const [entries,setEntries]=useState<BackupEntry[]>([]),[tab,setTab]=useState('auto'),[page,setPage]=useState(1),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<RestorePreview|null>(null),[error,setError]=useState(''),[restored,setRestored]=useState<CareerData|null>(null);
 const barrier=async()=>{if(recoveryMode&&!useStore.getState().data)return;await flushEdits();const data=useStore.getState().data;if(!data)throw Error('业务数据尚未加载');await window.careerAPI.confirmSaved(data.revision);};
 const reload=async()=>{setEntries(await window.careerAPI.listBackups());};
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError(String(e));message.error(String(e));}finally{setBusy(false);}};
 useEffect(()=>{if(open)void run(reload);},[open]);
 const visible=entries.filter(e=>tab==='manual'?e.kind==='manual':e.kind!=='manual').sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
 const pages=Math.max(1,Math.ceil(visible.length/8)),current=Math.min(page,pages);
 const begin=async(name?:string)=>run(async()=>{
  await barrier();const source=name?await window.careerAPI.previewBackup(name):await window.careerAPI.chooseRestoreFile();
  if(source){setPreview(source);setRestored(null);}
 });
 const confirm=async()=>run(async()=>{
  if(!preview)return;await barrier();
  const revision=useStore.getState().data?.revision??preview.target_revision;
  if(revision!==preview.target_revision){
   setPreview(await window.careerAPI.refreshRestorePreview(preview.token));
   setError('预览后数据发生变化，已刷新差异。请重新检查并再次确认。');return;
  }
  try{
   const result=await window.careerAPI.confirmRestore(preview.token,revision);
   onRestored(result);setRestored(result);setPreview(null);await reload();message.success('完整恢复成功，已重新读取核对');
  }catch(e){
   // A queued write may win the race after the renderer revision check.
   // Keep the pinned source and force a fresh explicit confirmation.
   try{const refreshed=await window.careerAPI.refreshRestorePreview(preview.token);setPreview(refreshed);}catch{}
   throw e;
  }
 });
 return <Drawer title="完整备份与恢复" width={860} open={open} onClose={()=>{if(!busy)onClose();}} maskClosable={!busy} closable={!busy}>
  <Alert type="info" message="完整备份包含全部业务数据，不受当前筛选和所选行影响。" description="表格导出用于岗位或申请清单；不能代替完整备份。恢复采用源文件时点，整库替换，不合并后续修改。"/>
  {recoveryMode&&<Alert type="warning" message="当前为只读恢复模式" description="业务库尚未正常载入，不会自动创建空库。确认恢复前会独立保留原损坏字节或主文件缺失记录。" style={{marginTop:12}}/>}
  <Space wrap className="backup-actions">{!recoveryMode&&<><Input aria-label="人工备份备注" placeholder="人工备份简短备注（可选）" value={note} maxLength={160} onChange={e=>setNote(e.target.value)} style={{width:240}}/><Button loading={busy} onClick={()=>void run(async()=>{await barrier();await window.careerAPI.backupData(note);await reload();setTab('manual');setPage(1);message.success('人工完整备份已保存');})}>创建人工备份</Button><Button loading={busy} onClick={()=>void run(async()=>{await barrier();const saved=await window.careerAPI.exportFullBackup(note);if(saved)message.success('完整备份已另存');})}>另存完整备份</Button></>}<Button type="primary" loading={busy} onClick={()=>void begin()}>从外部完整 JSON 恢复</Button></Space>
  {error&&<Alert role="alert" type="error" message={error} style={{marginTop:12}}/>}
  {restored&&<Alert type="success" message="完整恢复成功" description={<><p>已载入 {restored.jobs.length} 个岗位、{restored.applications.length} 条申请。原筛选和阅读位置仍保留；筛选后为空不代表数据丢失。</p><Button onClick={()=>{onReset();onClose();}}>回默认查看</Button></>}/>}
  <Tabs activeKey={tab} onChange={t=>{setTab(t);setPage(1);}} items={[{key:'auto',label:'自动备份'},{key:'manual',label:'人工备份'}]}/>
  <p className="backup-explanation">{tab==='manual'?'人工备份独立保留，不参与自动10份轮转。':'常规自动保留最近10份；恢复前保护和类型未记录的旧备份另行保留。'}</p>
  {!visible.length&&<p>暂无{tab==='manual'?'人工':'自动'}备份。</p>}
  <div className="backup-list">{visible.slice((current-1)*8,current*8).map(entry=><Card key={entry.name} size="small" data-backup-kind={entry.kind} title={<><span>{localTime(entry.created_at)}</span><span> · {entry.note||displayBackupReason(entry)}</span></>} extra={<Button disabled={busy} onClick={()=>void begin(entry.name)}>预览恢复</Button>}>
   <Typography.Text strong>{kindLabel[entry.kind]}</Typography.Text>
   <p>{displayBackupReason(entry)} · 内容时点 {localTime(entry.snapshot_updated_at)} · 数据版本 {entry.data_revision??'未记录'}</p>
   {entry.time_source!=='metadata'&&<small>{entry.time_source==='filesystem'?'创建时间来自文件系统，不代表原快照时间。':'创建时间来自旧文件名；类型及原因未记录。'}</small>}
   <details><summary>文件详情</summary><p className="backup-filename">{entry.name}</p><p>软件版本 {entry.app_version||'未记录'} · 数据格式 {entry.data_schema??'未记录'}</p></details>
  </Card>)}</div>
  <Pagination aria-label="备份分页" current={current} total={visible.length} pageSize={8} showSizeChanger={false} onChange={setPage}/>
  <Modal open={!!preview} title="确认完整恢复" okText="确认整库恢复" cancelText="取消" confirmLoading={busy} maskClosable={!busy} onCancel={()=>{if(!busy)setPreview(null);}} onOk={()=>void confirm()} width={740}>
   {preview&&<><Alert type="warning" message="整库替换，不合并" description={preview.target_kind==='normal'?'恢复后以源快照为准，不保留该时点之后目标库独有的修改。执行前将保存当前目标的受保护完整备份。':'恢复后以源快照为准。执行前将独立保护原损坏字节或缺失状态；它们不是可选的有效整库备份，也不参与自动轮转。'}/><p>源文件：{preview.source_name}</p><p>源快照：{summary(preview.source_summary)}</p><p>当前库：{preview.target_summary?summary(preview.target_summary):preview.target_kind==='missing'?'主文件缺失，未创建空库':'JSON 损坏，无法统计；原始字节将保留'}</p>{preview.warnings.map((w,i)=><Alert type="warning" message={w} key={i} style={{marginBottom:8}}/>)}{preview.source_format==='legacy_raw'&&<p>旧版原始 JSON：结构可读，但程序不能单凭字段证明其来源是完整备份；请核对来源和数量。</p>}{error&&<Alert type="error" message={error}/>}</>}
  </Modal>
 </Drawer>;
}
