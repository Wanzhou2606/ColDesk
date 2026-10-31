/** Verify only the newly installed ColDesk QA package; never seed records in the emulator. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),adb=path.resolve(root,'../.android-tools/sdk/platform-tools/adb.exe'),device=process.argv[2];
if(!/^127\.0\.0\.1:\d+$/.test(device??''))throw Error('Pass the verified local MuMu address');
const out=path.join(root,'preview/mobile-native');fs.mkdirSync(out,{recursive:true});for(const name of ['error.txt','report.json']){const file=path.join(out,name);if(fs.existsSync(file))fs.unlinkSync(file);}
const run=args=>{const r=spawnSync(adb,['-s',device,...args],{windowsHide:true});if(r.status!==0)throw Error(String(r.stderr));return r.stdout;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
const shot=name=>fs.writeFileSync(path.join(out,name+'.png'),run(['exec-out','screencap','-p']));
(async()=>{let ws;try{
 run(['shell','am','start','-n','com.coldesk.mobile.qa/com.coldesk.mobile.MainActivity']);
 let pid;for(let i=0;i<50;i++){try{pid=run(['shell','pidof','-s','com.coldesk.mobile.qa']).toString().trim();if(/^\d+$/.test(pid))break;}catch{}await sleep(200)}assert(/^\d+$/.test(pid),'QA app process missing');
 run(['forward','tcp:9223','localabstract:webview_devtools_remote_'+pid]);
 let tab;for(let i=0;i<50;i++){try{const tabs=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());tab=tabs.find(t=>t.url==='https://localhost/'&&t.title==='ColDesk');if(tab)break;}catch{}await sleep(200)}assert(tab,'QA WebView missing');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async(check,message)=>{for(let i=0;i<100;i++){if(await js(check))return;await sleep(100)}throw Error(message)};
 const click=async(selector,label)=>{await js(`(()=>{const e=${label?`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)})`:`document.querySelector(${JSON.stringify(selector)})`};if(!e)throw Error('Control missing');e.click()})()`);await sleep(300)};
 const nav=async label=>{await click('.mobile-tabbar>button',label==='设置'?'更多':label);if(label==='设置')await click('.mobile-more-card.more-settings');},metrics=()=>js(`(()=>{const c=document.querySelector('.mobile-content'),tab=document.querySelector('.mobile-tabbar'),r=tab.getBoundingClientRect();return {width:innerWidth,height:innerHeight,content:c.clientWidth,scroll:c.scrollWidth,tabBottom:r.bottom,ua:navigator.userAgent}})()`);
 await wait('!!window.coldesk&&!!document.querySelector(".mobile-tabbar")','App UI missing');
 const initial=await js("window.coldesk.invoke('state:get').then(s=>({tasks:Object.values(s.buckets).flat().length,entries:s.expense.entries.length,habits:s.habit.habits.length}))");
 const dimensions=await metrics();assert(dimensions.height>dimensions.width,'App did not open in portrait');
 if(await js('!!document.querySelector(".mobile-intro")')){shot('welcome');await click('.mobile-intro .primary-btn');}
 await wait('!document.querySelector(".mobile-intro")','Welcome did not finish');
 await nav('日程');
 assert(await js("[...document.querySelectorAll('.mobile-tabbar>button')].map(e=>e.textContent.trim()).join('|')==='Home|任务|日程|打卡|更多'"),'Navigation order differs on Android');
 assert(await js("document.querySelector('.mobile-tabbar>button:nth-child(3)').getAttribute('aria-current')==='page'"),'Default schedule not selected');
 const pages=[];
 for(const [label,selector,file] of [['日程','.mobile-schedule','schedule'],['任务','.mobile-tasks','tasks'],['打卡','.habits-page','habits'],['Home','.home-page','home'],['更多','.mobile-more-page','more']]){
   await nav(label);await wait(`!!document.querySelector(${JSON.stringify(selector)})`,'Page missing '+label);const layout=await metrics();assert(layout.scroll<=layout.content+1&&layout.tabBottom<=layout.height+1,'Page overflow '+label);pages.push({label,...layout});shot(file);
 }
 await nav('更多');assert(await js('[...document.querySelectorAll(".mobile-more-entry-text strong")].map(e=>e.textContent).join("|")==="记账|长期|设置"'),'More entries differ');
 for(const key of ['expenses','goals','settings']){await click('.mobile-more-card.more-'+key);assert(await js('document.querySelector(".mobile-back-button").textContent.includes("返回更多")'),'More destination return missing');run(['shell','input','keyevent','4']);await sleep(300);await wait('!!document.querySelector(".mobile-more-page")','Android back did not return to More');}
 await nav('任务');await click('.mobile-goal-feature');await wait('!!document.querySelector(".goals-page")','Goals page missing');shot('goals');
 await nav('设置');await wait('!!document.querySelector(".mobile-settings")','Settings missing');assert(await js('!document.querySelector(".mobile-more")&&!document.querySelector(".mobile-quick-links")'),'Duplicate entries remain');assert(await js('!document.querySelector(".course-color-settings").open'),'Course colors should be collapsed');shot('settings');
 const settingsMetrics=await metrics();assert(settingsMetrics.scroll<=settingsMetrics.content+1,'Settings overflow');
 await js('document.querySelector(".mobile-content").scrollTo(0,document.querySelector(".mobile-content").scrollHeight)');await sleep(200);shot('settings-fonts');
 const shortcut=await js('window.Capacitor.Plugins.ColDeskAppearance.shortcut({pin:false})');assert(typeof shortcut.supported==='boolean','Native icon shortcut adapter missing');
 const size=run(['shell','wm','size']).toString().match(/Physical size: (\d+)x(\d+)/);assert(size,'Physical screen size missing');
 const pick=async(selector)=>{
  const point=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}})()`),scale=Number(size[1])/point.width,top=Number(size[2])-point.height*scale;
  run(['shell','input','tap',String(Math.round(point.x*scale)),String(Math.round(top+point.y*scale))]);await sleep(1000);
  const activity=run(['shell','dumpsys','activity','activities']).toString().split('\n').find(line=>line.includes('topResumedActivity'))??'';
  assert(/documentsui|photopicker|PhotoPicker|ChooserActivity|resolver/i.test(activity),'Android file chooser did not open '+activity);
  run(['shell','input','keyevent','4']);await sleep(500);await wait('!!document.querySelector(".mobile-settings")','Settings did not return after cancel');
  await wait('!document.querySelector(".mobile-icon-settings .primary-btn").disabled','Cancel did not release upload button');
 };
 await pick('.mobile-icon-settings .primary-btn');
 await nav('任务');await click('[aria-label="新建任务"]');await wait('!!document.querySelector(".mobile-task-create[open]")','New task dialog missing');
 assert(await js("(()=>{const form=document.querySelector('.mobile-task-create');return form.scrollWidth<=form.clientWidth+1})()"),'Task form horizontally overflows');shot('task-form');
 await js("document.activeElement?.blur();document.querySelector('[aria-label=\"关闭新建任务\"]').click()");await sleep(300);
 await nav('日程');shot('schedule-final');
 const final=await js("window.coldesk.invoke('state:get').then(s=>({tasks:Object.values(s.buckets).flat().length,entries:s.expense.entries.length,habits:s.habit.habits.length}))");assert(JSON.stringify(initial)===JSON.stringify(final),'Native verification changed user records');
 const report={ok:true,device,pid,android:run(['shell','getprop','ro.build.version.release']).toString().trim(),package:'com.coldesk.mobile.qa',version:run(['shell','dumpsys','package','com.coldesk.mobile.qa']).toString().match(/versionName=([^\r\n]+)/)?.[1],portrait:true,centerSchedule:true,morePage:true,moreNativeBack:true,iconShortcutAdapter:true,nativeFilePicker:true,initial,final,pages};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 }finally{ws?.close()}
})().catch(error=>{fs.writeFileSync(path.join(out,'error.txt'),error.stack||String(error));try{shot('failure')}catch{}process.exitCode=1});
