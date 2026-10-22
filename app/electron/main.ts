import {preparePersonalDirectory} from './services/personal-profile';
import {resolveURL} from '../src/url';
import {app,BrowserWindow,ipcMain,dialog,shell,Menu} from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import {Preferences} from './services/preferences';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Storage} from './services/storage';
import {Board} from './services/board';
import {parseFile,exportRows} from './services/import';
import {assertData} from '../src/utils';
import type {CareerData,Job} from '../src/types';
const root=path.join(__dirname,'..');
// Development launches must name a controlled profile; never fall through to V1 or formal V2.
if(!app.isPackaged&&!process.env.CAREER_TEST_DATA)throw Error('V2试用必须使用独立profile，请从启动V2试用.cmd打开');
const profile=path.resolve(process.env.CAREER_TEST_DATA||path.join(app.getPath('appData'),'CareerBoardV2'));
preparePersonalDirectory(profile);
app.setPath('userData',profile);
const isolated={sessionData:path.join(profile,'session'),logs:path.join(profile,'logs'),crashDumps:path.join(profile,'crash'),temp:process.env.CAREER_TEST_TEMP||path.join(profile,'temp')};
for(const [key,dir] of Object.entries(isolated)){fsSync.mkdirSync(dir,{recursive:true});app.setPath(key as 'logs',dir);}
app.commandLine.appendSwitch('disk-cache-dir',path.join(isolated.sessionData,'Cache'));
app.setName('秋招求职看板V2');
app.setAppUserModelId('cn.personal.careerboard.v2');
let win:BrowserWindow;
const launchLog=(message:string)=>{if(process.env.CAREER_LAUNCH_LOG)console.log(`${new Date().toISOString()} [gui] ${message}`);};
launchLog(`main pid=${process.pid} ppid=${process.ppid} runtime=${process.execPath} electron=${process.versions.electron} node=${process.versions.node} profile=${app.getPath('userData')}`);
async function reportReady(stage:string){
 if(!win||win.isDestroyed())return;
 const ui=await win.webContents.executeJavaScript("({menus:[...document.querySelectorAll('[role=menuitem]')].map(x=>x.textContent),dataReady:!!document.querySelector('[data-career-ready]'),recoveryReady:!!document.querySelector('[data-recovery-ready]')})");
 if(win.isVisible()&&!win.isMinimized()&&ui.recoveryReady){launchLog(`RECOVERY_READY window=${win.id} visible=true recoveryReady=true; business data not loaded`);return 'recovery' as const;}
 if(win.isVisible()&&!win.isMinimized()&&ui.menus.length===5&&ui.dataReady){launchLog(`${stage} window=${win.id} visible=true bounds=${JSON.stringify(win.getBounds())} menus=${JSON.stringify(ui.menus)} dataReady=true`);return true;}return false;
}
const primary=app.requestSingleInstanceLock({launchLog:process.env.CAREER_LAUNCH_LOG});
if(!primary){launchLog('HANDOFF requested to existing profile instance; readiness is recorded in its original log');app.quit();}
app.on('second-instance',async(_event,_argv,_cwd,additional)=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();try{const state=await reportReady('EXISTING_WINDOW_READY');if(state){const target=String((additional as {launchLog?:unknown})?.launchLog||'');if([isolated.logs,path.resolve(profile,'../launch-logs')].includes(path.dirname(target))&&/^preview-\d+-\d+\.log$/.test(path.basename(target)))await fs.appendFile(target,`${new Date().toISOString()} [gui] ${state==='recovery'?'RECOVERY_READY':'EXISTING_WINDOW_READY'} pid=${process.pid} visible=true ${state==='recovery'?'recoveryReady=true':'dataReady=true'}\n`);}}catch(e){launchLog(`handoff check failed: ${String(e)}`);}}});
if(primary)app.whenReady().then(async()=>{
 const storage=new Storage(profile);const board=new Board(storage);const preferences=new Preferences(profile);const files=new Map<string,string>();
 win=new BrowserWindow({width:1440,height:900,minWidth:1180,minHeight:720,show:false,icon:path.join(app.isPackaged?process.resourcesPath:root,'build-resources/app-icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.on('context-menu',(_event,params)=>{if(params.isEditable)Menu.buildFromTemplate([{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]).popup({window:win});});
 win.removeMenu();win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 launchLog(`BrowserWindow created id=${win.id}`);
 win.webContents.on('did-fail-load',(_event,code,description)=>launchLog(`LOAD_FAILED ${code} ${description}`));
 win.webContents.on('render-process-gone',(_event,details)=>launchLog(`RENDERER_EXIT ${details.reason} ${details.exitCode}`));
 win.webContents.on('will-navigate',(e)=>e.preventDefault());
 const handle=(name:string,fn:(...args:unknown[])=>Promise<unknown>)=>ipcMain.handle(name,async(event,...args:unknown[])=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('请求来源无效');try{return await fn(...args);}catch(e){console.error(name,e);throw Error(e instanceof Error?e.message:'操作失败，请重试');}});
 handle('load',()=>board.load());handle('save',async()=>{throw Error('已禁止整库覆盖，请使用事务');});
 handle('command',c=>board.execute(c as import('../src/types').Command));
 handle('backup',note=>board.backup(String(note||'')));handle('backups',()=>storage.listDetails());
 handle('restore',async()=>{throw Error('请先预览并确认完整恢复');});
 handle('restore-choose',async()=>{const selected=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'完整JSON备份',extensions:['json']}]});if(selected.canceled)return null;const file=selected.filePaths[0];if(path.extname(file).toLowerCase()!=='.json')throw Error('请选择JSON完整备份');return board.previewRestore(await fs.readFile(file,'utf8'),path.basename(file));});
 handle('restore-preview',name=>board.previewBackup(String(name)));
 handle('restore-refresh',token=>board.refreshRestorePreview(String(token)));
 handle('restore-confirm',(token,revision)=>board.confirmRestore(String(token),Number(revision)));
 handle('backup-export',async note=>{const value=await board.fullBackup(String(note||''));const selected=await dialog.showSaveDialog(win,{defaultPath:`秋招求职看板_完整备份_${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'完整JSON备份',extensions:['json']}]});if(selected.canceled||!selected.filePath)return null;const out=selected.filePath;if(path.resolve(out)===path.resolve(storage.file)||path.resolve(out).startsWith(path.resolve(storage.backups)+path.sep))throw Error('完整备份另存请选择业务库与备份目录以外的位置');await fs.writeFile(out,JSON.stringify(value,null,2));return out;});
 handle('preferences-get',()=>preferences.load());handle('preferences-save',value=>preferences.save(value));handle('preferences-flush',()=>preferences.flush());
 handle('reset',async()=>{throw Error('初始化清空已停用；已有用户数据仅做幂等升级');});
 let canClose=false,confirmedRevision:number|null=null;win.on('close',e=>{if(!canClose){e.preventDefault();confirmedRevision=null;win.webContents.send('before-close');}});
 handle('confirm-saved',async revision=>{const result=await board.checkpoint(Number(revision));confirmedRevision=result.revision;return result;});
 handle('request-close',async revision=>{await board.checkpoint(Number(revision));canClose=true;win.close();});
 handle('request-recovery-close',async()=>{await board.assertRecoveryExit();canClose=true;win.close();});
 handle('close-ready',async ok=>{if(ok===true){if(confirmedRevision===null)throw Error('正常退出前尚未确认保存');await board.checkpoint(confirmedRevision);canClose=true;win.close();}});
 handle('choose',async()=>{const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'岗位数据',extensions:['csv','xlsx','xls']}]});if(result.canceled)return null;const file=result.filePaths[0];if(!['.csv','.xlsx','.xls'].includes(path.extname(file).toLowerCase()))throw Error('不支持的文件类型');const token=randomUUID();files.clear();files.set(token,file);return{name:path.basename(file),token,...await parseFile(file)};});
 handle('read',async(token,sheet)=>{const file=files.get(String(token));if(!file)throw Error('请重新选择文件');return{name:path.basename(file),token,...await parseFile(file,String(sheet))};});
 handle('export',async(kind,data)=>{if(!['csv','xlsx','json'].includes(String(kind)))throw Error('导出类型无效');let bytes:Buffer;if(kind==='json'){assertData(data);bytes=Buffer.from(JSON.stringify(data,null,2));}else{if(!Array.isArray(data))throw Error('导出数据无效');bytes=exportRows(data,String(kind) as 'csv'|'xlsx');}const result=await dialog.showSaveDialog(win,{defaultPath:`秋招求职看板_${new Date().toISOString().slice(0,10)}.${kind}`,filters:[{name:'数据文件',extensions:[String(kind)]}]});if(result.canceled||!result.filePath)return null;await fs.writeFile(result.filePath,bytes);return result.filePath;});
 handle('external',async value=>{const u=resolveURL(value);if(!u.valid)throw Error(u.reason);await shell.openExternal(u.normalized);});
 handle('folder',async()=>{const error=await shell.openPath(storage.dir);if(error)throw Error('无法打开数据目录');});
 if(!app.isPackaged&&process.env.CAREER_DEV_URL)await win.loadURL(process.env.CAREER_DEV_URL);else await win.loadFile(path.join(root,'dist/index.html'));
 win.show();
 launchLog(`loadFile complete; show requested; visible=${win.isVisible()}`);
 if(process.env.CAREER_LAUNCH_LOG){const started=Date.now();const check=async()=>{try{if(await reportReady('READY'))return;if(Date.now()-started<25000&&!win.isDestroyed())setTimeout(check,250);else launchLog('NOT_READY: window or rendered data not ready');}catch(e){launchLog(`READY_CHECK_FAILED ${String(e)}`);}};void check();}
}).catch(error=>{console.error(`[gui] STARTUP_FAILED ${error.stack||error}`);app.exit(1);});
app.on('window-all-closed',()=>app.quit());

