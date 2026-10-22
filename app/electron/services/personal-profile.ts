import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const personalAppId='cn.personal.careerboard.v2';
export function assertSafePath(input:string){
 const resolved=path.resolve(input);
 for(let p=resolved;;p=path.dirname(p)){try{if(fs.lstatSync(p).isSymbolicLink())throw Error('数据路径含链接，请先确认目录归属：'+p);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}
 return resolved;
}
export function assertOwnedDirectory(dir:string){
 const resolved=assertSafePath(dir),marker=assertSafePath(path.join(resolved,'career-board-owner.json'));
 const bytes=fs.readFileSync(marker);const owner=JSON.parse(bytes.toString('utf8'));
 if(owner.appId!==personalAppId||owner.format!==1)throw Error('目录归属冲突，未覆盖：'+resolved);
 return createHash('sha256').update(bytes).digest('hex');
}
export function preparePersonalDirectory(dir:string){
 const resolved=assertSafePath(dir);
 const marker=path.join(resolved,'career-board-owner.json');
 if(fs.existsSync(resolved)){
  if(fs.existsSync(marker)){
   assertOwnedDirectory(resolved);assertSafePath(path.join(resolved,'career-board.json'));
   // An owned missing target is diagnosed by Storage.load without inventing a new database.
   return;
  }
  if(fs.readdirSync(resolved).length)throw Error('已有目录归属不明，未写入：'+resolved);
 }else fs.mkdirSync(resolved,{recursive:true});
 fs.writeFileSync(marker,JSON.stringify({appId:personalAppId,format:1},null,2),{flag:'wx'});
}
