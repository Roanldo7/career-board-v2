import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Preferences,defaultPreferences} from '../electron/services/preferences';
const base=path.resolve(process.env.CAREER_TEST_ROOT||'../work/v2b-preferences-tests');
test('PREF01 independent atomic preferences roundtrip and business no-touch',async()=>{
 const dir=path.join(base,randomUUID());await fs.mkdir(dir,{recursive:true});const business='synthetic-business-unchanged';await fs.writeFile(path.join(dir,'career-board.json'),business);
 const p=new Preferences(dir);assert.deepEqual((await p.load()).preferences,defaultPreferences());
 const value=defaultPreferences();value.entries['杭州']={page:8,mode:'表格',scroll:{'表格':215},query:{search:'合成',bankMode:'only',layout:'flat',sort:[{field:'priority',desc:false}]}};
 await p.save(value);await p.flush();assert.deepEqual((await new Preferences(dir).load()).preferences,value);assert.equal(await fs.readFile(path.join(dir,'career-board.json'),'utf8'),business);assert.equal((await fs.readdir(dir)).includes('backups'),false);
});
test('PREF02 corrupt preference preserves bytes and falls back without touching business',async()=>{
 const dir=path.join(base,randomUUID());await fs.mkdir(dir,{recursive:true});const p=new Preferences(dir);await fs.writeFile(p.file,'{broken');const result=await p.load();assert.ok(result.warning);assert.deepEqual(result.preferences,defaultPreferences());assert.equal(await fs.readFile(p.file,'utf8'),'{broken');assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('ui-preferences.corrupt-')).length,1);
});
test('PREF03 failed preference commit retains prior preferences, retry recovers',async()=>{
 const dir=path.join(base,randomUUID());await fs.mkdir(dir,{recursive:true});const p=new Preferences(dir);const initial=defaultPreferences();await p.save(initial);
 const rename=fs.rename;try{fs.rename=async()=>{throw Error('synthetic preference rename failure');};await assert.rejects(p.save({...initial,activeEntry:'applications'}),/阅读位置未保存/);await assert.rejects(p.flush());assert.deepEqual((await p.load()).preferences,initial);}finally{fs.rename=rename;}
 await p.save({...initial,activeEntry:'applications'});await p.flush();assert.equal((await p.load()).preferences.activeEntry,'applications');
});
