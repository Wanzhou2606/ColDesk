const {app,BrowserWindow,nativeTheme}=require('electron'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../preview/timetable-maintenance-ui');fs.mkdirSync(out,{recursive:true});for(const name of ['report.json','error.txt']){const file=path.join(out,name);if(fs.existsSync(file))fs.unlinkSync(file);}
const profile=fs.mkdtempSync(path.join(out,'data-'));app.setPath('userData',profile);app.requestSingleInstanceLock=()=>true;app.setLoginItemSettings=()=>{};app.getLoginItemSettings=()=>({openAtLogin:false});app.disableHardwareAcceleration();nativeTheme.themeSource='light';process.env.COLDESK_DISABLE_SCHEDULER='1';delete process.env.COLDESK_SEED_SAMPLE;app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');require(path.resolve(__dirname,'../out/main/index.cjs'));
const delay=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},wait=async(fn,m)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(100)}throw Error(m)};
(async()=>{let main;try{
 await app.whenReady();await wait(()=>{main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk');return main&&!main.webContents.isLoading()},'main missing');main.setSize(1320,900);main.show();main.webContents.setBackgroundThrottling(false);
 const js=async code=>{try{return await main.webContents.executeJavaScript(code)}catch(error){throw Error(code+"\n"+error.stack)}},invoke=(channel,payload)=>js(`window.coldesk.invoke(${JSON.stringify(channel)},${JSON.stringify(payload??{})})`);
 const click=async(selector,label)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('button missing '+${JSON.stringify(label)});e.click()})()`);await delay(120)};
 const fill=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('input missing '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const nav=async label=>{await js(`[...document.querySelectorAll('.nav-item')].find(e=>e.querySelector('.nav-label').textContent===${JSON.stringify(label)}).click()`);await delay(180)};
 const shot=async name=>{main.restore();main.show();main.moveTop();main.focus();main.webContents.sendInputEvent({type:'mouseMove',x:5,y:5});for(let attempt=0;attempt<3;attempt++){await delay(600+attempt*350);try{fs.writeFileSync(path.join(out,name+'.png'),(await main.capturePage(undefined,{stayHidden:false,stayAwake:true})).toPNG());return;}catch(error){if(!String(error).includes('UnknownVizError')||attempt===2)throw error;}}};



 await invoke('settings:update',{onboardingVersion:1,mainTheme:'garden'});
 const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../preview/timetable-2026-10-30/import.json'),'utf8'));
 await invoke('timetable:import',{text:JSON.stringify(data),mode:'replace'});
 await invoke('task:create',{title:'删除课表后保留的任务',type:'todo',urgency:2,estMinutes:30});
 await click('.settings-pill','设置');await click('.settings-nav-label','课程与排程');
 await wait(()=>js('!!document.querySelector(".timetable-maintenance button:not(:disabled)")'),'delete button missing');
 assert((await invoke('timetable:current')).count===10,'initial count wrong');
 await click('.timetable-maintenance>button','删除当前课表');await wait(()=>js('!!document.querySelector(".timetable-delete-dialog[open]")'),'confirmation missing');
 assert(await js('document.activeElement.textContent.trim()==="取消"'),'cancel not default focused');await shot('delete-confirmation');
 await click('.timetable-delete-dialog button','取消');await wait(()=>js('!document.querySelector(".timetable-delete-dialog")'),'cancel did not close');assert((await invoke('timetable:current')).count===10,'cancel changed data');
 let rejected=false;try{await invoke('timetable:delete',{semesterId:'stale-id'})}catch{rejected=true}assert(rejected,'stale confirmation accepted');assert((await invoke('timetable:current')).count===10,'stale confirmation changed data');
 for(const language of ['en','ja']){await invoke('settings:update',{language});await wait(()=>js('document.querySelector(".timetable-maintenance>button").textContent==='+JSON.stringify(language==='en'?'Delete current timetable':'現在の時間割を削除')),'translation failed '+language)}
 await invoke('settings:update',{language:'zh-CN'});await wait(()=>js('document.querySelector(".timetable-maintenance>button").textContent==="删除当前课表"'),'Chinese restore failed');
 await click('.timetable-maintenance>button','删除当前课表');await click('.timetable-delete-dialog button','确认删除');
 await wait(()=>js('!document.querySelector(".timetable-delete-dialog")'),'delete did not close');
 assert((await invoke('timetable:current')).count===0,'courses remain');const state=await invoke('state:get');assert(state.courses.length===0,'state not refreshed');assert(Object.values(state.buckets).flat().some(t=>t.title==='删除课表后保留的任务'),'personal task lost');assert(await js('document.querySelector(".timetable-maintenance>button").disabled'),'empty deletion not disabled');
 assert(fs.readdirSync(path.join(profile,'backup')).some(name=>name.startsWith('timetable-before-delete-')),'backup missing');await shot('deleted');
 await invoke('timetable:import',{text:JSON.stringify(data),mode:'replace'});await wait(()=>js('!document.querySelector(".timetable-maintenance>button").disabled'),'reimport not reflected');assert((await invoke('timetable:current')).count===10,'reimport failed');
 for(const [w,h] of [[900,650],[1920,1080]]){main.setSize(w,h);await delay(250);assert(await js('document.querySelector(".settings-body").scrollWidth<=document.querySelector(".settings-body").clientWidth+2'),'settings overflow '+w)}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,profile,deleteConfirmation:true,cancelPreservesData:true,staleConfirmationRejected:true,backupBeforeDelete:true,personalTaskPreserved:true,stateRefresh:true,reimportAfterDelete:true,languages:true,responsive:true},null,2));app.quit();
 }catch(error){try{if(main&&!main.isDestroyed())fs.writeFileSync(path.join(out,'failure.png'),(await main.capturePage(undefined,{stayHidden:false,stayAwake:true})).toPNG())}catch{}fs.writeFileSync(path.join(out,'error.txt'),String(error.stack??error));app.exit(1);}
})();
