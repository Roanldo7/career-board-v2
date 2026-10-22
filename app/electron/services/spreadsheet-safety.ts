import {inflateRawSync} from 'node:zlib';

export const limits={file:20*1024*1024,expanded:80*1024*1024,entry:24*1024*1024,rows:10000,columns:100,cell:32767};
// Validate and bounded-inflate ZIP members in memory; never extract to disk.
export function checkArchive(bytes:Buffer){
 if(bytes.length>limits.file)throw Error('文件超过20MB');
 if(bytes.readUInt16LE(0)!==0x4b50)return;
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
 if(end<0)throw Error('无效ZIP目录');
 const count=bytes.readUInt16LE(end+10);let p=bytes.readUInt32LE(end+16),total=0;
 if(count>4096||count===65535||bytes.readUInt16LE(end+4)!==0)throw Error('工作簿ZIP结构超限');
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||bytes.readUInt32LE(p)!==0x02014b50)throw Error('无效ZIP条目');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),packed=bytes.readUInt32LE(p+20),size=bytes.readUInt32LE(p+24),local=bytes.readUInt32LE(p+42);
  if(flags&1||size>limits.entry||(total+=size)>limits.expanded||local+30>bytes.length)throw Error('压缩工作簿过大或加密');
  if(bytes.readUInt32LE(local)!==0x04034b50)throw Error('ZIP目录不一致');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
  if(start+packed>bytes.length)throw Error('ZIP数据不完整');
  const data=bytes.subarray(start,start+packed);
  const unpacked=method===0?data:method===8?inflateRawSync(data,{maxOutputLength:limits.entry}):null;
  if(!unpacked||unpacked.length!==size)throw Error('ZIP压缩方式或尺寸不一致');
  p+=46+bytes.readUInt16LE(p+28)+bytes.readUInt16LE(p+30)+bytes.readUInt16LE(p+32);
 }
}
export function constantHyperlink(formula:string|undefined){
 if(!formula)return null;
 const m=/^\s*=?HYPERLINK\s*\(\s*"((?:[^"]|"")*)"\s*(?:[,;]\s*"((?:[^"]|"")*)"\s*)?\)\s*$/i.exec(formula);
 return m?{url:m[1].replace(/""/g,'"'),label:(m[2]||'').replace(/""/g,'"')}:null;
}
export function httpUrl(value:unknown){
 if(typeof value!=='string')return null;
 try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}
}
