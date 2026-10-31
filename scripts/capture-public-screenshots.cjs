const {app,BrowserWindow,nativeTheme}=require('electron'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../preview/public-screenshots');fs.mkdirSync(out,{recursive:true});for(const name of ['report.json','error.txt']){const file=path.join(out,name);if(fs.existsSync(file))fs.unlinkSync(file);}
const profile=fs.mkdtempSync(path.join(out,'data-'));app.setPath('userData',profile);app.requestSingleInstanceLock=()=>true;app.setLoginItemSettings=()=>{};app.getLoginItemSettings=()=>({openAtLogin:false});app.disableHardwareAcceleration();nativeTheme.themeSource='light';process.env.COLDESK_DISABLE_SCHEDULER='1';process.env.COLDESK_SEED_SAMPLE='1';app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');require(path.resolve(__dirname,'../out/main/index.cjs'));
const delay=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},wait=async(fn,m)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(100)}throw Error(m)};
(async()=>{let main;try{
 await app.whenReady();await wait(()=>{main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk');return main&&!main.webContents.isLoading()},'main missing');main.setSize(1320,900);main.show();main.webContents.setBackgroundThrottling(false);
 const js=async code=>{try{return await main.webContents.executeJavaScript(code)}catch(error){throw Error(code+"\n"+error.stack)}},invoke=(channel,payload)=>js(`window.coldesk.invoke(${JSON.stringify(channel)},${JSON.stringify(payload??{})})`);
 const click=async(selector,label)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('button missing '+${JSON.stringify(label)});e.click()})()`);await delay(120)};
 const fill=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('input missing '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const nav=async label=>{await js(`[...document.querySelectorAll('.nav-item')].find(e=>e.querySelector('.nav-label').textContent===${JSON.stringify(label)}).click()`);await delay(180)};
 const shot=async name=>{main.restore();main.show();main.moveTop();main.focus();main.webContents.sendInputEvent({type:'mouseMove',x:5,y:5});for(let attempt=0;attempt<3;attempt++){await delay(600+attempt*350);try{fs.writeFileSync(path.join(out,name+'.png'),(await main.capturePage(undefined,{stayHidden:false,stayAwake:true})).toPNG());return;}catch(error){if(!String(error).includes('UnknownVizError')||attempt===2)throw error;}}};



 await invoke('settings:update',{onboardingVersion:1,autoSchedule:false,mainTheme:'garden',homeTheme:'garden'});
 assert(fs.readFileSync(path.resolve(__dirname,'../out/renderer/app-icon.png')).equals(fs.readFileSync(path.resolve(__dirname,'../assets/icons/app-icon-256.png'))),'renderer icon differs from original source');
 const current=await invoke('state:get'),date=current.date;
 for(const [title,hour] of [['完成阅读笔记',18],['准备课程分享',20],['整理本周计划',22]])await invoke('task:create',{title,type:'todo',urgency:3,dueAt:date+'T'+hour+':00',estMinutes:45,detail:'这是用于项目介绍的虚构演示任务。'});
 await nav('日程');await click('button','周视图');await delay(700);await shot('schedule');
 const root=await invoke('goals:save',{title:'学会一门新语言',note:'给每天留一点时间，把喜欢的事慢慢学会。'});
 const basic=await invoke('goals:save',{parentId:root,title:'发音与基础',note:'从熟悉的声音和简单的表达开始。'});
 const sound=await invoke('goals:save',{parentId:basic,title:'认识字母与发音'});await invoke('goals:complete',{id:sound,done:true});
 await invoke('goals:save',{parentId:basic,title:'用简单句介绍自己'});
 const words=await invoke('goals:save',{parentId:root,title:'积累 4000 个常用词',targetAmount:4000,unit:'个',note:'每天一点，稳稳向前。'});
 await invoke('goals:progress',{id:words,date,mode:'add',amount:620,requestId:require('node:crypto').randomUUID(),note:'演示进度'});
 await invoke('goals:save',{parentId:root,title:'听力与日常表达',note:'每天五分钟，记录生活里的表达。'});
 await invoke('goals:primary',{id:root});await nav('长期');await wait(()=>js('!!document.querySelector(".goal-detail-head")'),'handbook missing');await shot('goals');
 const docs=path.resolve(__dirname,'../docs/screenshots');fs.mkdirSync(docs,{recursive:true});for(const name of ['schedule','goals'])fs.copyFileSync(path.join(out,name+'.png'),path.join(docs,name+'.png'));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,profile,syntheticDataOnly:true,originalIcon:true,screenshots:['schedule','goals']},null,2));app.quit();
 }catch(error){fs.writeFileSync(path.join(out,'error.txt'),String(error.stack??error));app.exit(1);}
})();
