/** Validate without serializing URL: preserve signed query strings and path spelling. */
export function resolveURL(value:unknown){
 const raw=typeof value==='string'?value:'';const s=raw.trim();
 const fail=(reason:string)=>({raw,normalized:'',valid:false,reason});
 if(!s||s.length>4096||/[\x00-\x20\x7f\\]/.test(s))return fail('链接为空或包含非法字符');
 let normalized=s;
 if(/^https?:\/\//i.test(s)){}else if(s.startsWith('//'))normalized='https:'+s;
 else if(/^[a-z][a-z\d+.-]*:/i.test(s))return fail('只支持HTTP/HTTPS网页');
 else normalized='https://'+s;
 if(!normalized.replace(/^https?:\/\//i,'').split(/[/?#]/)[0].includes('.'))return fail('请输入完整域名');
 try{const u=new URL(normalized);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return fail('不支持的协议或凭据');
 const host=u.hostname;if(!host.includes('.')||host.split('.').some(x=>!x||x.length>63||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i.test(x)))return fail('请输入合法域名');
 return {raw,normalized,valid:true,reason:''};}catch{return fail('请输入合法网址');}
}
