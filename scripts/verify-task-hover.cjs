const {app,BrowserWindow,nativeTheme,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../preview/task-hover-urgency');fs.mkdirSync(out,{recursive:true});
for(const name of ['report.json','error.txt','renderer.log']){const f=path.join(out,name);if(fs.existsSync(f))fs.unlinkSync(f);}
const profile=fs.mkdtempSync(path.join(out,'data-'));app.setPath('userData',profile);
app.requestSingleInstanceLock=()=>true;app.setLoginItemSettings=()=>{};app.getLoginItemSettings=()=>({openAtLogin:false});
app.disableHardwareAcceleration();nativeTheme.themeSource='light';delete process.env.COLDESK_DISABLE_SCHEDULER;delete process.env.COLDESK_SEED_SAMPLE;
// Capture the startup callback to also verify manual dismissal and clearing after auto-dismiss.
const originalTimeout=global.setTimeout;let showStartup;
global.setTimeout=function(fn,ms,...args){if(ms===1800)showStartup=fn;return originalTimeout(fn,ms,...args)};
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');require(path.resolve(__dirname,'../out/main/index.cjs'));
const watchdog=originalTimeout(()=>{fs.writeFileSync(path.join(out,'error.txt'),'GUI verification timed out');app.exit(1)},120000);watchdog.unref();
const delay=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},wait=async(fn,m)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(80)}throw Error(m)};
(async()=>{let main,hover;try{
 await app.whenReady();await wait(()=>{main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk');return main&&!main.webContents.isLoading()},'main missing');
 main.webContents.on('console-message',(_e,level,message)=>fs.appendFileSync(path.join(out,'renderer.log'),String(message)+'\n'));main.setSize(1320,900);main.show();main.focus();main.webContents.setBackgroundThrottling(false);
 const js=async code=>{try{return await main.webContents.executeJavaScript(code)}catch(e){throw Error(code+'\n'+e.stack)}},invoke=(c,p)=>js(`window.coldesk.invoke(${JSON.stringify(c)},${JSON.stringify(p??{})})`);
 const click=async(selector,label)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('missing button '+${JSON.stringify(label)});e.click()})()`);await delay(180)};
 const nav=async label=>{await js(`[...document.querySelectorAll('.nav-item')].find(e=>e.querySelector('.nav-label').textContent===${JSON.stringify(label)}).click()`);await delay(180)},has=()=>js('!!document.querySelector(".task-hover-card")');
 const move=async(selector,position={x:.4,y:.5},win=main)=>{
   return await win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect(),p={x:Math.round(r.x+r.width*${position.x}),y:Math.round(r.y+r.height*${position.y})};for(const type of ['pointerover','pointermove'])e.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'mouse',clientX:p.x,clientY:p.y}));return p})()`);
 };
 const away=async(win=main)=>{await win.webContents.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:3,clientY:3}))");await delay(650)};
 const shot=async(name,win=main)=>{for(let i=0;i<3;i++){await delay(500+i*250);try{fs.writeFileSync(path.join(out,name+'.png'),(await win.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return}catch(e){if(!String(e).includes('UnknownVizError')||i===2)throw e}}};
 await invoke('settings:update',{onboardingVersion:1,mainTheme:'garden',desktopMode:'widget'});
 const shapes=[];
 const shape=async(selector,win=main)=>{
  const result=await win.webContents.executeJavaScript(`(()=>{const origin=document.querySelector(${JSON.stringify(selector)}),panel=document.querySelector('.task-hover-card'),a=origin.getBoundingClientRect(),b=panel.getBoundingClientRect(),css=getComputedStyle(panel);return {width:a.width,expandedWidth:b.width,left:a.left,expandedLeft:b.left,height:a.height,expandedHeight:b.height,top:b.top,bottom:b.bottom,viewport:innerHeight,accent:css.getPropertyValue('--course-color').trim(),expected:getComputedStyle(origin).getPropertyValue('--accent').trim(),frames:panel.getAnimations().flatMap(animation=>animation.effect.getKeyframes()).map(k=>({left:parseFloat(k.left),width:parseFloat(k.width),height:parseFloat(k.height),radius:k.borderRadius}))}})()`);
  assert(Math.abs(result.width-result.expandedWidth)<.1&&Math.abs(result.left-result.expandedLeft)<.1,'preview no longer matches its row '+JSON.stringify(result));
  assert(result.frames.length>=3&&result.frames.every(frame=>Math.abs(frame.width-result.width)<.1&&Math.abs(frame.left-result.left)<.1),'animation changes row width '+JSON.stringify(result));
  assert(result.expandedHeight>result.height&&result.expandedHeight<=result.height+300,'expansion is not modest '+JSON.stringify(result));
  assert(result.top>=0&&result.bottom<=result.viewport,'vertical preview outside window');
  const taskId=await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).dataset.taskId`),current=await invoke('state:get'),task=Object.values(current.buckets).flat().find(task=>task.id===taskId);
  assert(task&&result.accent===({1:'#8A8F98',2:'#12A594',3:'#4F7CFF',4:'#F76B15',5:'#E5484D'})[task.urgency],'hover does not match urgency '+JSON.stringify(result));
  shapes.push({selector,...result});
 };
 let toast;await wait(()=>{toast=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('toast.html'));return toast&&!toast.webContents.isLoading()},'toast window missing');
 await wait(async()=>(await invoke('toast:get')).items.some(item=>item.kind==='startup'),'startup missing');
 const startup=(await invoke('toast:get')).items.find(item=>item.kind==='startup');assert(startup&&!startup.strong,'startup still requires acknowledgement');
 assert(!toast.isFocusable()&&!toast.isModal(),'startup takes focus or blocks the app');
 await nav('任务');assert(await js('!!document.querySelector(".task-page")'),'startup blocked navigation');
 assert(await toast.webContents.executeJavaScript('!document.querySelector(".toast-card.startup").textContent.includes("收到")&&!!document.querySelector(".toast-card.startup button[title=关闭]")'),'startup acknowledgement button remains');
 await wait(async()=>!(await invoke('toast:get')).items.some(item=>item.id===startup.id),'startup did not auto-dismiss');
 assert(!toast.isVisible(),'auto-dismiss left the notification window open');
 assert(typeof showStartup==='function','startup callback missing');showStartup();await delay(200);
 await toast.webContents.executeJavaScript('document.querySelector(".toast-card.startup button[title=关闭]").click()');
 assert(!(await invoke('toast:get')).items.some(item=>item.kind==='startup'),'normal close still requires acknowledgement');
 showStartup();await invoke('toast:clear');assert(!(await invoke('toast:get')).items.length,'clear preserves startup reminder');
 // Keep rendered-window checks separate from physical mouse movement on the developer's desktop.
 main.setIgnoreMouseEvents(true);main.showInactive();await delay(250);
 await js("window.addEventListener('blur',event=>event.stopImmediatePropagation(),true)");
 await js(`window.hoverEvents=[];for(const type of ['blur','focus','pointerover','pointerleave','scroll','resize'])window.addEventListener(type,event=>{window.hoverEvents.push({type,target:event.target?.className??event.target?.nodeName,time:performance.now()});if(window.hoverEvents.length>50)window.hoverEvents.shift()},true)`);
 let state=await invoke('state:get');const date=state.now.slice(0,10);
 const title='准备课程展示材料：整理阅读笔记、核对引用来源，并完成演示稿',detail='1. 整理本周的阅读笔记，保留关键例子。\n2. 核对引用来源与图表，准备 5 分钟展示。\n备注：<重点> 只是普通文字，不应被当作 HTML。';
 const create=async(name,dueAt,body)=>{await invoke('task:create',{title:name,domain:'study',type:'todo',urgency:3,dueAt,detail:body,estMinutes:40,splittable:true});const s=await invoke('state:get');return Object.values(s.buckets).flat().find(t=>t.title===name).id};
 const task=await create(title,date+'T23:50',detail),empty=await create('没有截止日期的想法',undefined,'');
 const settings=await invoke('app:interaction'),systemTime=settings.hoverTime;
 assert(Number.isInteger(systemTime)&&systemTime>0,'system hover time missing');
 await nav('任务');await wait(()=>js('!!document.querySelector(".task-list-item")'),'task list missing');await delay(750);
 await js('document.querySelector(".task-page .primary-btn").focus();window.hoverMeasured=null;document.addEventListener("pointerover",e=>{if(e.target.closest?.(".task-list-item"))window.hoverBegan=performance.now()});new MutationObserver(()=>{if(document.querySelector(".task-hover-card")&&window.hoverMeasured===null)window.hoverMeasured=performance.now()-window.hoverBegan}).observe(document.body,{childList:true,subtree:true})');
 const item=`.task-list-item[data-task-id="${task}"]`,target=item+' .task-title-link';
 const before=await js('[...document.querySelectorAll(".task-list-item")].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})');
 await move(target);await delay(Math.max(25,systemTime*.45));assert(!await has(),'preview appeared before hover delay');
 await wait(has,'hover preview missing');await delay(500);
 const measured=await js('window.hoverMeasured');assert(measured>=systemTime-35&&measured<systemTime+300,'wrong native delay '+measured);
 assert(await js(`document.querySelector('#task-hover-title').textContent===${JSON.stringify(title)}&&document.querySelector('.task-hover-card').textContent.includes(${JSON.stringify(date+' 23:50')})&&document.querySelector('.task-hover-card .task-detail-body p').textContent===${JSON.stringify(detail)}`),'preview lost title, deadline or detail');
 assert(await js('document.activeElement===document.querySelector(".task-page .primary-btn")'),'hover stole keyboard focus');
 assert(JSON.stringify(before)===JSON.stringify(await js('[...document.querySelectorAll(".task-list-item")].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})')),'hover moved other cards');
 assert(await js('getComputedStyle(document.querySelector(".task-hover-card .task-detail-body p")).whiteSpace==="pre-wrap"&&!document.querySelector(".task-hover-card .task-detail-body 重点")'),'details not safe plain multiline text');
 await shape(item);await move('.task-hover-card .task-detail-body');await delay(650);assert(await has(),'moving into preview collapsed it');await shot('task-list-hover');
 await away();assert(!await has(),'leaving did not collapse preview');
 await move(target);await delay(Math.max(30,systemTime*.35));await away();assert(!await has(),'quick pass opened a preview');
 const point=await move(target);await delay(systemTime*.6);await js(`document.querySelector(${JSON.stringify(target)}).dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:${point.x+12},clientY:${point.y}}))`);await delay(systemTime*.6);assert(!await has(),'moving did not restart resting delay');await wait(has,'resting after motion never opened');
 await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait(async()=>!await has(),'Escape did not close');await delay(systemTime+150);assert(!await has(),'Escape caused immediate reopen');await away();
 await move(item+' .task-menu-trigger');await delay(systemTime+150);assert(!await has(),'menu trigger opened hover');await js(`document.querySelector(${JSON.stringify(item+' .task-menu-trigger')}).click()`);await wait(()=>js('!!document.querySelector(".task-action-menu")'),'task menu missing');assert(!await has(),'menu overlapped hover');await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await away();
 // Direct click retains the existing editor, with no delayed extra preview.
 await js(`document.querySelector(${JSON.stringify(target)}).click()`);await wait(()=>js('!!document.querySelector(".task-edit-dialog")'),'click editor missing');await delay(systemTime+100);assert(!await has(),'editor overlapped hover');await click('.task-edit-dialog button[type=button].ghost-btn','取消');
 await nav('日程');await invoke('schedule:placeTask',{taskId:task,startAt:date+'T18:00',durationMinutes:40});await wait(()=>js(`!!document.querySelector('.time-block[data-task-id="${task}"]')`),'schedule task missing');await away();
 const block=`.time-block[data-task-id="${task}"]`;
 await move(block);await wait(has,'schedule hover missing');await delay(500);assert(await js('document.querySelector(".task-hover-card").getAnimations().some(a=>a.effect.getKeyframes().some(k=>k.offset===.76&&k.borderRadius==="19px"))'),'spring animation missing');await shape(block);await shot('schedule-hover');await away();
 await move(block);await js(`(()=>{const e=document.querySelector(${JSON.stringify(block)});e.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}))})()`);await delay(systemTime+180);assert(!await has(),'drag opened preview');await js(`document.querySelector(${JSON.stringify(block)}).dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}))`);await away();
 await move(`.deadline-drag-target[data-task-id="${task}"]`);await wait(has,'sidebar hover missing');await delay(450);await shape(`.deadline-drag-target[data-task-id="${task}"]`);await away();
 await click('.schedule-switch button','周视图');await move(`.week-block[data-task-id="${task}"]`);await wait(has,'week hover missing');await delay(450);await shape(`.week-block[data-task-id="${task}"]`);await shot('week-hover');await away();
 await click('.schedule-switch button','清单');await js('document.querySelector(".agenda-past")?.setAttribute("open","")');await move(`.agenda-card[data-task-id="${task}"]`);await wait(has,'agenda hover missing');await delay(450);await shape(`.agenda-card[data-task-id="${task}"]`);await away();
 await nav('任务');await js('document.querySelector("[data-task-group=later]").scrollIntoView({block:"center",behavior:"instant"})');await delay(250);await move(`.task-list-item[data-task-id="${empty}"] .task-title-link`);await wait(has,'empty task preview missing');assert(await js('document.querySelector(".task-hover-card").textContent.includes("无截止时间")&&document.querySelector(".task-hover-card").textContent.includes("还没有填写详细内容")'),'empty states missing');await away();
 const long='每日复盘与进度说明，保留换行和完整内容。\n'.repeat(80).slice(0,1999);await invoke('task:update',{id:task,patch:{detail:long}});
 main.setSize(900,650);await js('document.querySelector(".content").scrollTo({top:0,behavior:"instant"})');await delay(400);await move(target,{x:.1,y:.5});await wait(has,'small preview missing');await delay(500);
 assert(await js('(()=>{const r=document.querySelector(".task-hover-card").getBoundingClientRect(),p=document.querySelector(".task-hover-card .task-detail-body");return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&p.scrollHeight>p.clientHeight&&p.scrollWidth<=p.clientWidth+1})()'),'small/long preview clipped');await shot('small-long-hover');await away();
 // All five urgency colors remain consistent across themes and appearances.
 for(const [theme,urgency] of [['default',1],['mint',2],['lavender',3],['rose',4],['garden',5]]){
  await invoke('settings:update',{mainTheme:theme});await invoke('task:update',{id:task,patch:{urgency}});await delay(300);await move(target,{x:.1,y:.5});await wait(has,'theme hover missing');await delay(450);await shape(item);if(theme==='rose')await shot('rose-theme-hover');await away();
 }
 nativeTheme.themeSource='dark';await delay(350);await move(target,{x:.1,y:.5});await wait(has,'dark theme hover missing');await delay(450);await shape(item);await shot('dark-theme-hover');await away();nativeTheme.themeSource='light';await delay(350);
 // Preference refresh follows focus, using a slower value without changing the user's registry.
 ipcMain.removeHandler('app:interaction');ipcMain.handle('app:interaction',()=>({hoverTime:1000}));await js('window.dispatchEvent(new Event("focus"))');await delay(100);await move(target);await delay(600);assert(!await has(),'custom system delay ignored');await wait(has,'custom delay did not open');await away();ipcMain.removeHandler('app:interaction');ipcMain.handle('app:interaction',()=>settings);await js('window.dispatchEvent(new Event("focus"))');
 for(const language of ['en','ja']){await invoke('settings:update',{language});await delay(250);await move(target);await wait(has,'localized preview missing');assert(await js('document.querySelector(".task-hover-card header span").textContent==='+JSON.stringify(language==='en'?'Task details':'タスクの詳細')),'untranslated preview '+language);await away();}await invoke('settings:update',{language:'zh-CN'});
 // Desktop widget uses the same hover experience within its existing window bounds.
 let widget;await wait(()=>{widget=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('widget.html'));return widget&&!widget.webContents.isLoading()},'widget missing');widget.setIgnoreMouseEvents(true);widget.showInactive();widget.webContents.setBackgroundThrottling(false);await widget.webContents.executeJavaScript("window.addEventListener('blur',event=>event.stopImmediatePropagation(),true)");await delay(700);
 const wjs=async code=>{try{return await widget.webContents.executeJavaScript(code)}catch(e){throw Error(code+'\n'+e.stack)}};await move(`.task-row[data-task-id="${task}"] .grow`,{x:.3,y:.5},widget);await wait(()=>wjs('!!document.querySelector(".task-hover-card")'),'widget hover missing');await delay(450);await shape(`.task-row[data-task-id="${task}"]`,widget);await shot('widget-hover',widget);await away(widget);
 await invoke('toast:clear');await invoke('settings:update',{desktopMode:'island'});await wait(()=>wjs('!!document.querySelector(".island-shell")'),'island missing');
 hover=setInterval(()=>{if(!widget.isDestroyed())widget.webContents.send('widget:hover',{inside:true})},250);widget.webContents.send('widget:hover',{inside:true});
 await wait(()=>wjs('document.querySelector(".island-shell").classList.contains("is-expanded")'),'island not expanded');await invoke('toast:clear');await wait(()=>wjs('!!document.querySelector(".island-deadline-open")'),'island deadline list missing');widget.setIgnoreMouseEvents(true);await delay(600);await move(`.island-deadline-open`,{x:.3,y:.5},widget);await wait(()=>wjs('!!document.querySelector(".task-hover-card")'),'island task hover missing');await delay(500);assert(await wjs('(()=>{const p=document.querySelector(".task-hover-card .task-detail-body"),f=document.querySelector(".task-hover-actions"),r=f.getBoundingClientRect();return p.clientHeight>=32&&r.bottom<=innerHeight-8})()'),'island preview content/footer clipped');await shape('.island-deadlines li[data-task-id]',widget);await shot('island-hover',widget);await away(widget);clearInterval(hover);hover=null;
 await invoke('settings:update',{desktopMode:'widget'});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,profile,startupAutoDismiss:true,startupDismissAndClear:true,startupNoFocusOrModal:true,startupNavigationAvailable:true,startupNoAcknowledgement:true,verticalGeometry:shapes,urgencyColorsAcrossThemes:true,lightAndDark:true,systemHoverTime:systemTime,measuredHoverTime:measured,systemPreferenceRefresh:true,titleDeadlineDetails:true,plainMultilineText:true,noFocusSteal:true,otherCardsStayStill:true,quickPassSuppressed:true,motionRestartsDelay:true,hoverPanelStaysOpen:true,leaveAndEscape:true,menuAndEditorIndependent:true,dragPreserved:true,sidebar:true,day:true,week:true,agenda:true,emptyStates:true,longContent:true,responsive:true,englishJapanese:true,widget:true,island:true},null,2));app.quit();
 }catch(error){if(hover)clearInterval(hover);try{if(main&&!main.isDestroyed()){fs.writeFileSync(path.join(out,'events.json'),JSON.stringify(await main.webContents.executeJavaScript('window.hoverEvents'),null,2));fs.writeFileSync(path.join(out,'failure.png'),(await main.capturePage(undefined,{stayHidden:false,stayAwake:true})).toPNG())}}catch{}fs.writeFileSync(path.join(out,'error.txt'),String(error.stack??error));app.exit(1);}
})();
