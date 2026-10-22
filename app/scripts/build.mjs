import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
await viteBuild();
for(const name of ['main','preload']){
 const result=await build({entryPoints:[`electron/${name}.ts`],bundle:true,platform:'node',external:['electron'],outfile:`dist-electron/${name}.cjs`,metafile:true});
 if(process.env.CAREER_BUILD_EVIDENCE){await fs.mkdir(process.env.CAREER_BUILD_EVIDENCE,{recursive:true});await fs.writeFile(path.join(process.env.CAREER_BUILD_EVIDENCE,`${name}-metafile.json`),JSON.stringify(result.metafile,null,2));}
}
