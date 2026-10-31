// Connect only to the forwarded ColDesk QA WebView; never inspect other phone apps.
const fs=require('node:fs'),path=require('node:path');
const output=path.resolve(__dirname,'../preview/android-device-check');fs.mkdirSync(output,{recursive:true});
(async()=>{const tabs=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());const tab=tabs.find(t=>t.url==='https://localhost/'&&t.title==='ColDesk');if(!tab)throw new Error('ColDesk QA WebView not found');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});let seq=0;const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
try {const expression=process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):'({body:document.body.innerText,api:!!window.coldesk,ua:navigator.userAgent,width:innerWidth,height:innerHeight})';const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));console.log(JSON.stringify(r.result.value,null,2));}finally{ws.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
