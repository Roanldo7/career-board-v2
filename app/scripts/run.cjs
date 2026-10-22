const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const commands={typecheck:['node_modules/typescript/bin/tsc','--noEmit'],build:['scripts/build.mjs'],test:['node_modules/tsx/dist/cli.mjs','--test',...fs.readdirSync(path.join(root,'tests')).filter(n=>/^v2b-.*\.test\.ts$/.test(n)).map(n=>'tests/'+n)],'preview-v2':['scripts/preview-v2.cjs'],'dist-v2':['../tools/package-v2.cjs',...process.argv.slice(3)]};
const args=commands[process.argv[2]];if(!args)throw Error('未授权或不存在的V2命令');
const env={...process.env};if(process.argv[2]==='test'){env.CAREER_TEST_ROOT ||= path.resolve(root,'../work/V2B_20261007_232020/module-tests');env.V2B_TEST_WORK ||= path.join(env.CAREER_TEST_ROOT,'inherited');}delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error('启动失败',e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
