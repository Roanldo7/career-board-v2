import {create} from 'zustand';
import type {CareerData,LoadResult,Command,CommandResult} from './types';
interface State{data:CareerData|null;load:LoadResult|null;busy:boolean;undo:number;redo:number;init:()=>Promise<void>;command:(c:Omit<Command,'id'>)=>Promise<CommandResult>;update:(fn:(d:CareerData)=>CareerData)=>Promise<void>;replace:(d:CareerData)=>void}
let pending:Promise<unknown>=Promise.resolve();
const serial=<T,>(fn:()=>Promise<T>)=>{const p=pending.then(fn,fn);pending=p.catch(()=>{});return p;};
export const waitForWrites=()=>pending;
export const useStore=create<State>((set,get)=>({data:null,load:null,busy:false,undo:0,redo:0,init:async()=>{const load=await window.careerAPI.loadData();set({load,data:load.data});},replace:data=>set({data,undo:0,redo:0}),
 command:c=>serial(async()=>{set({busy:true});try{const result=await window.careerAPI.command({...c,id:c.id||crypto.randomUUID(),revision:get().data?.revision} as Command);set({data:result.data,undo:result.undo,redo:result.redo});return result;}finally{set({busy:false});}}),
 update:fn=>serial(async()=>{
  const old=get().data;if(!old)throw Error('数据尚未载入');const next=fn(structuredClone(old));const operations:any[]=[];
  for(const collection of ['jobs','leads','applications','employers']){
   const previous=old[collection]||[],current=next[collection]||[];
   for(const row of current){const base=previous.find((x:any)=>x.id===row.id);if(!base){operations.push({collection,action:'add',value:row});continue;}
    const fields=Object.fromEntries(Object.entries(row).filter(([k,v])=>!['id','created_at','updated_at'].includes(k)&&JSON.stringify(base[k])!==JSON.stringify(v)));
    if(Object.keys(fields).length)operations.push({collection,action:'patch',record_id:row.id,fields,expected:Object.fromEntries(Object.keys(fields).map(k=>[k,base[k]]))});
   }
   for(const row of previous)if(!current.some((x:any)=>x.id===row.id))operations.push({collection,action:'delete',record_id:row.id});
  }
  set({busy:true});try{const result=await window.careerAPI.command({id:crypto.randomUUID(),type:'batch',operations,revision:old.revision});set({data:result.data,undo:result.undo,redo:result.redo});}finally{set({busy:false});}
 })
}));
