import fs from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type {ImportRow} from '../../src/types';
import {checkArchive,constantHyperlink,httpUrl,limits} from './spreadsheet-safety';
export async function parseFile(file:string,sheet?:string){
 if((await fs.stat(file)).size>limits.file)throw Error('文件超过20MB，请拆分后导入');
 const bytes=await fs.readFile(file);if(bytes.length>limits.file)throw Error('文件超过20MB');
 const validate=(rows:ImportRow[])=>{if(rows.length>limits.rows)throw Error('工作表超过10000行');for(const r of rows){if(Object.keys(r).length>limits.columns||Object.values(r).some(v=>String(v??'').length>limits.cell))throw Error('列数或单元格长度超限');}return rows;};
 if(path.extname(file).toLowerCase()==='.csv'){const parsed=Papa.parse<ImportRow>(bytes.toString('utf8').replace(/^\uFEFF/,''),{header:true,skipEmptyLines:'greedy'});const errors=parsed.errors.filter(e=>e.code!=='UndetectableDelimiter');if(errors.length)throw Error(`CSV格式错误：第${(errors[0].row??0)+1}行`);return{rows:validate(parsed.data),sheets:['CSV'],sheet:'CSV'};}
 if(bytes.length<4)throw Error('空白或无效工作簿');checkArchive(bytes);
 const book=XLSX.read(bytes,{type:'buffer',cellDates:false,cellFormula:true,bookVBA:false});
 for(const name of book.SheetNames){const ws=book.Sheets[name];if(!ws['!ref'])continue;const range=XLSX.utils.decode_range(ws['!ref']);if(range.e.r>=limits.rows+2||range.e.c>=limits.columns)throw Error('工作表行列数超限');for(const [address,cell] of Object.entries(ws)){if(address.startsWith('!'))continue;if(String(cell.v??'').length>limits.cell||String(cell.f??'').length>limits.cell)throw Error('单元格长度超限');}}
 const selected=sheet||book.SheetNames.find(n=>XLSX.utils.sheet_to_json(book.Sheets[n]).length>0)||book.SheetNames[0];if(!book.Sheets[selected])throw Error('工作表不存在');
 const ws=book.Sheets[selected],grid=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,defval:null,raw:true});
 const placeholder=grid[0]?.filter(v=>v!==null).every(v=>/^Column\d+$/i.test(String(v)));
 const header=placeholder&&grid[1]?.some(v=>['公司名称','企业'].includes(String(v)))?1:0;
 const headers=grid[header]||[],warnings:string[]=[];
 const rows=grid.slice(header+1).flatMap((values,index)=>{
  if(values.every(v=>v===null||v===''))return[];
  const row:ImportRow={};headers.forEach((key,col)=>{if(key===null)return;const cell=ws[XLSX.utils.encode_cell({r:index+header+1,c:col})];let value=values[col]??null;
   const formula=constantHyperlink(cell?.f),native=httpUrl(cell?.l?.Target),url=native||httpUrl(formula?.url)||httpUrl(value);
   if(native&&formula&&native!==formula.url)warnings.push(`第${index+header+2}行链接来源冲突，优先原生超链接`);
   if(cell?.f&&!formula)warnings.push(`第${index+header+2}行含未执行公式，保留缓存值`);
   if(url)value=url;row[String(key)]=value;
  });return[row];
 });
 return{rows:validate(rows),sheets:book.SheetNames,sheet:selected,headerRow:header+1,warnings};
}
export function exportRows(rows:ImportRow[],kind:'csv'|'xlsx'){
 const flat=rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='object'&&v!==null?JSON.stringify(v):v])));
 if(kind==='csv')return Buffer.from('\uFEFF'+Papa.unparse(flat,{escapeFormulae:true}),'utf8');
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(flat),'岗位明细');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
