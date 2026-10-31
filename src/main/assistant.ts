import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {getDataDir} from './db';

export interface AssistantConfig {httpPort: number; token: string; reconnectTask: string}
export function readAssistantConfig(file=join(getDataDir(),'assistant.local.json')): AssistantConfig | null {
  try {
    const raw=JSON.parse(readFileSync(file,'utf8'));
    if(!Number.isInteger(raw.httpPort)||raw.httpPort<1||raw.httpPort>65535||typeof raw.token!=='string'||raw.token.length>4096||/[\r\n]/.test(raw.token)||typeof raw.reconnectTask!=='string'||!raw.reconnectTask||raw.reconnectTask.length>256||/[\r\n]/.test(raw.reconnectTask))return null;
    return {httpPort:raw.httpPort,token:raw.token,reconnectTask:raw.reconnectTask};
  }catch{return null;}
}

export function createAssistantService(deps: {
  config?:()=>AssistantConfig|null;
  request?:typeof fetch;
  start?:(task:string)=>Promise<boolean>;
  pause?:(ms:number)=>Promise<void>;
}={}) {
  const config=deps.config??readAssistantConfig,request=deps.request??fetch;
  const start=deps.start??((task:string)=>new Promise<boolean>(resolve=>{
    if(process.platform!=='win32'){resolve(false);return;}
    execFile('schtasks',['/Run','/TN',task],{windowsHide:true,timeout:15000},error=>resolve(!error));
  }));
  const pause=deps.pause??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const statusFor=async(value:AssistantConfig|null)=>{
    if(!value)return {configured:false,online:false,nickname:''};
    try{
      const read=async(endpoint:string)=>{
        const response=await request(`http://127.0.0.1:${value.httpPort}/${endpoint}`,{headers:value.token?{Authorization:'Bearer '+value.token}:{},signal:AbortSignal.timeout(3000)});
        if(!response.ok)throw Error('offline');
        const body=await response.json() as {retcode?:number;data?:{online?:boolean;good?:boolean;nickname?:unknown}};
        if(body.retcode!==undefined&&body.retcode!==0)throw Error('offline');
        return body.data;
      };
      const [connection,account]=await Promise.all([read('get_status'),read('get_login_info')]);
      const online=connection?.online===true&&connection.good!==false;
      return {configured:true,online,nickname:online&&typeof account?.nickname==='string'?account.nickname.slice(0,100):''};
    }catch{return {configured:true,online:false,nickname:''};}
  };
  let reconnecting:Promise<{ok:boolean;nickname?:string;reason?:string}>|null=null;
  const reconnect=()=>{
    if(reconnecting)return reconnecting;
    reconnecting=(async()=>{
      const value=config();if(!value)return {ok:false,reason:'not_configured'};
      const deadline=Date.now()+60000;
      if(!await start(value.reconnectTask))return {ok:false,reason:'start_failed'};
      for(let attempt=0;attempt<24&&Date.now()<deadline;attempt++){
        await pause(Math.max(0,Math.min(2000,deadline-Date.now())));const next=await statusFor(value);
        if(next.online)return {ok:true,nickname:next.nickname};
      }
      return {ok:false,reason:'timeout'};
    })().finally(()=>{reconnecting=null;});
    return reconnecting;
  };
  return {status:()=>statusFor(config()),reconnect};
}

export const assistantService=createAssistantService();
