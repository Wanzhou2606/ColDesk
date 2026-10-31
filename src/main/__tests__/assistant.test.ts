import {strict as assert} from 'node:assert';
import {describe,it} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAssistantService,readAssistantConfig} from '../assistant';

const config={httpPort:3000,token:'fixture-only',reconnectTask:'Fixture-Task'};
const response=(data:unknown,retcode=0)=>new Response(JSON.stringify({retcode,data}),{headers:{'Content-Type':'application/json'}});
describe('本机助手配置与连接',()=>{
 it('配置缺失不联网、不运行重连任务',async()=>{
  const service=createAssistantService({config:()=>null,request:async()=>{throw Error('must not fetch');},start:async()=>{throw Error('must not run');}});
  assert.deepEqual(await service.status(),{configured:false,online:false,nickname:''});assert.deepEqual(await service.reconnect(),{ok:false,reason:'not_configured'});
 });
 it('配置仅本机读取，拒绝无效端口和换行凭证',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coldesk-assistant-')),file=join(dir,'assistant.local.json');try{
   assert.equal(readAssistantConfig(file),null);writeFileSync(file,JSON.stringify(config));assert.deepEqual(readAssistantConfig(file),config);
   writeFileSync(file,JSON.stringify({...config,httpPort:99999}));assert.equal(readAssistantConfig(file),null);writeFileSync(file,JSON.stringify({...config,token:'invalid\nvalue'}));assert.equal(readAssistantConfig(file),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('端口可访问但QQ未登录时显示离线；不泄漏配置或凭证',async()=>{
  const urls:string[]=[];const service=createAssistantService({config:()=>config,request:async(url,init)=>{
   urls.push(String(url));assert.equal((init?.headers as any).Authorization,'Bearer fixture-only');return String(url).endsWith('get_status')?response({online:false,good:true}):response({nickname:'示例昵称'});
  }});assert.deepEqual(await service.status(),{configured:true,online:false,nickname:''});assert.ok(urls.every(url=>url.startsWith('http://127.0.0.1:3000/')));
 });
 it('只有真实登录成功才显示昵称；接口错误视为离线',async()=>{
  const service=createAssistantService({config:()=>config,request:async url=>String(url).endsWith('get_status')?response({online:true,good:true}):response({nickname:'示例昵称'})});assert.deepEqual(await service.status(),{configured:true,online:true,nickname:'示例昵称'});
  const bad=createAssistantService({config:()=>config,request:async()=>response({},1403)});assert.equal((await bad.status()).online,false);
 });
 it('重连并发共享一次启动，启动失败立即返回',async()=>{
  let starts=0;const service=createAssistantService({config:()=>config,start:async()=>{starts++;return true;},pause:async()=>{},request:async url=>String(url).endsWith('get_status')?response({online:true}):response({nickname:'示例昵称'})});
  const first=service.reconnect(),second=service.reconnect();assert.equal(first,second);assert.equal((await first).ok,true);assert.equal(starts,1);
  const failed=createAssistantService({config:()=>config,start:async()=>false,pause:async()=>{throw Error('must not wait');}});assert.deepEqual(await failed.reconnect(),{ok:false,reason:'start_failed'});
 });
});
