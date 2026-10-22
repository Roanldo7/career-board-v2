import {useEffect,useRef,useState} from 'react';
import type {Query} from './presentation';

export type ReadingEntry={query:Query;mode:string;page:number;scroll:Record<string,number>};
export type ReadingPreferences={version:1;activeEntry:string;entries:Record<string,ReadingEntry>};
export const emptyEntry=():ReadingEntry=>({query:{},mode:'表格',page:1,scroll:{}});
const initial=():ReadingPreferences=>({version:1,activeEntry:'杭州',entries:{}});

// Each delayed write holds its own complete device snapshot. It never targets
// the business store, revision, undo stack or automatic business backup queue.
export default function useReadingPreferences(dataReady:boolean){
 const [prefs,setPrefs]=useState<ReadingPreferences>(initial),[ready,setReady]=useState(false),[warning,setWarning]=useState('');
 const value=useRef(prefs),timer=useRef<ReturnType<typeof setTimeout>>(),queue=useRef<Promise<unknown>>(Promise.resolve());
 const contentRef=useRef<HTMLDivElement>(null),restoring=useRef(false),restoredKey=useRef('');
 const readyRef=useRef(false),dirty=useRef(false);
 const saveSnapshot=()=>{
  clearTimeout(timer.current);
  if(!readyRef.current||!dirty.current)return queue.current.then(()=>{});
  const snapshot=structuredClone(value.current);dirty.current=false;
  const write=queue.current.catch(()=>{}).then(()=>window.careerAPI.savePreferences(snapshot));
  queue.current=write;
  return write.then(()=>setWarning(''),e=>{dirty.current=true;setWarning('阅读位置未保存；业务数据不受影响');throw e;});
 };
 const schedule=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{void saveSnapshot().catch(()=>{});},450);};
 const mutate=(fn:(p:ReadingPreferences)=>ReadingPreferences)=>{
  const next=fn(value.current);value.current=next;dirty.current=true;setPrefs(next);schedule();
 };
 const captureScroll=()=>{
  const el=contentRef.current;if(!readyRef.current||!el||restoring.current)return;
  const p=value.current,entry=p.entries[p.activeEntry]||emptyEntry();
  const key=p.activeEntry==='applications'?'表格':entry.mode;
  if(entry.scroll[key]===el.scrollTop)return;
  value.current={...p,entries:{...p.entries,[p.activeEntry]:{...entry,scroll:{...entry.scroll,[key]:el.scrollTop}}}};
  dirty.current=true;schedule();
 };
 const patch=(change:Partial<ReadingEntry>,entryKey=value.current.activeEntry)=>{
  mutate(p=>({...p,entries:{...p.entries,[entryKey]:{...(p.entries[entryKey]||emptyEntry()),...change}}}));
 };
 const changeEntry=(next:string)=>{captureScroll();mutate(p=>({...p,activeEntry:next}));};
 const changeMode=(mode:string)=>{captureScroll();patch({mode});};
 const changePage=(page:number)=>{patch({page,scroll:{...(value.current.entries[value.current.activeEntry]?.scroll||{}),[value.current.entries[value.current.activeEntry]?.mode||'表格']:0}});};
 const changeQuery=(query:Query,entryKey=value.current.activeEntry)=>{patch({query,page:1,scroll:{}},entryKey);};
 const reset=()=>{if(contentRef.current)contentRef.current.scrollTop=0;mutate(p=>({...p,entries:{...p.entries,[p.activeEntry]:emptyEntry()}}));};
 const flush=async()=>{captureScroll();await saveSnapshot();await queue.current;await window.careerAPI.flushPreferences();};
 useEffect(()=>{let live=true;void window.careerAPI.getPreferences().then(result=>{
  if(!live)return;value.current=result.preferences;setPrefs(result.preferences);setWarning(result.warning||'');readyRef.current=true;setReady(true);
 }).catch(()=>{if(live){setWarning('阅读位置无法读取；本次使用默认视图，业务数据不受影响');readyRef.current=true;setReady(true);}});
 return()=>{live=false;clearTimeout(timer.current);};},[]);
 const entry=prefs.entries[prefs.activeEntry]||emptyEntry();
 const layoutKey=JSON.stringify([prefs.activeEntry,entry.mode,entry.page,entry.query]);
 useEffect(()=>{
  if(!ready||!dataReady||restoredKey.current===layoutKey)return;
  restoring.current=true;let frame=0,second=0;
  frame=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
   const current=value.current,e=current.entries[current.activeEntry]||emptyEntry();
   if(contentRef.current)contentRef.current.scrollTop=e.scroll[current.activeEntry==='applications'?'表格':e.mode]||0;
   restoredKey.current=layoutKey;restoring.current=false;
  });});
  return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(second);restoring.current=false;};
 },[ready,dataReady,layoutKey]);
 return {ready,warning,page:prefs.activeEntry,query:entry.query,mode:entry.mode,pageNumber:entry.page,contentRef,captureScroll,changeEntry,changeMode,changePage,changeQuery,patch,reset,flush};
}
