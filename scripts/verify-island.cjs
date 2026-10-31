const {app,BrowserWindow,screen}=require('electron');const fs=require('node:fs');const path=require('node:path');
const output=path.resolve(__dirname,'../preview/island-check');fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(output,'data-'));app.setPath('userData',profile);app.requestSingleInstanceLock=()=>true;
app.setLoginItemSettings=()=>{};app.getLoginItemSettings=()=>({openAtLogin:false});
delete process.env.COLDESK_SEED_SAMPLE;process.env.COLDESK_DISABLE_SCHEDULER='1';
let cursor={x:400,y:300};
require(path.resolve(__dirname,'../out/main/index.cjs'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const wait=async(fn,msg)=>{for(let i=0;i<90;i++){if(await fn())return;await delay(100);}throw new Error(msg);};
(async()=>{let main,widget;try{
  await app.whenReady();screen.getCursorScreenPoint=()=>cursor;await delay(1800);main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk');main.setTitle('ColDesk · 灵动岛检查');widget=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk 悬浮窗');
  const js=async(code,win=main)=>{try{return await win.webContents.executeJavaScript(code);}catch(error){console.error('检查步骤失败：',code.slice(0,220));throw error;}};
  const shot=async(name,win=widget)=>{await delay(200);fs.writeFileSync(path.join(output,name+'.png'),(await win.capturePage()).toPNG());};
  const setHover=inside=>{const b=widget.getBounds();cursor=inside?{x:b.x+30,y:b.y+30}:{x:-10000,y:-10000};};
  const transition=async(event,expanded,selector)=>{setHover(expanded);return js(`new Promise(resolve=>{
    const shell=document.querySelector('.island-shell'),layer=document.querySelector('${selector}');
    const sample=()=>{const style=getComputedStyle(layer);return {opacity:Number(style.opacity),scale:new DOMMatrixReadOnly(style.transform).a};};

    const waitForChange=()=>{if(shell.classList.contains('is-expanded')!==${expanded})return requestAnimationFrame(waitForChange);
      setTimeout(()=>{const first=sample();setTimeout(()=>resolve({first,second:sample()}),80);},100);};
    requestAnimationFrame(waitForChange);
  })`,widget);};
  const assertShrinking=({first,second},label)=>assert(first.opacity>0&&first.opacity<1&&first.scale<.995&&second.opacity<first.opacity&&second.scale<first.scale,label+'未同时淡出和缩小');
  await js(`window.coldesk.invoke('settings:update',{onboardingVersion:1,autoSchedule:false})`);await js(`window.coldesk.invoke('toast:clear')`);
  const state=await js(`window.coldesk.invoke('state:get')`),date=state.date;
  const created=await js(`window.coldesk.invoke('task:create',{title:'拖拽与灵动岛测试',urgency:3,dueAt:'${date}T23:59',estMinutes:75})`);
  const task=Object.values(created.buckets).flat().find(t=>t.title==='拖拽与灵动岛测试');
  await js(`window.coldesk.invoke('schedule:placeTask',{taskId:'${task.id}',startAt:'${date}T14:00',durationMinutes:75})`);
  await js(`window.coldesk.invoke('toast:clear')`);
  // 日程红线无需重新打开窗口就会更新。
  const initialLine=await js(`document.querySelector('.now-line')?.style.top`);
  await js(`globalThis.originalClockDate=Date;globalThis.Date=class extends originalClockDate{constructor(...args){if(args.length)super(...args);else super(originalClockDate.now()+120000);}static now(){return originalClockDate.now()+120000;}};void 0;`);
  await delay(1250);const changedLine=await js(`document.querySelector('.now-line')?.style.top`);assert(initialLine&&changedLine&&initialLine!==changedLine,'红线没有实时移动');await js(`globalThis.Date=originalClockDate;void 0;`);
  // 同一任务重复拖入只更新一条；整个任务块可拖动。
  await js(`window.coldesk.invoke('schedule:placeTask',{taskId:'${task.id}',startAt:'${date}T15:00',durationMinutes:60})`);
  const arranged=await js(`window.coldesk.invoke('state:get')`);assert(arranged.timeline.filter(b=>b.taskId===task.id).length===1,'重复拖入生成了副本');
  assert(await js(`document.querySelector('.time-block.task-with-menu')?.draggable`),'整块任务不能拖动');
  await js(`window.coldesk.invoke('settings:update',{desktopMode:'island'})`);await wait(()=>js(`!!document.querySelector('.island-shell')`,widget),'灵动岛未出现');await delay(700);
  assert(widget.getBounds().width<=308&&widget.getBounds().height<=96,'收起后窗口没有同步缩小');await shot('collapsed');const anchor=widget.getBounds();
  const miniExit=await transition('pointerover',true,'.island-mini');assertShrinking(miniExit,'胶囊内容');
  await wait(()=>js(`document.querySelector('.island-shell').classList.contains('is-expanded')`,widget),'悬停不能展开');await delay(700);assert(widget.getBounds().width>=380,'展开窗口尺寸未更新');await shot('expanded');
  const contentExit=await transition('pointerout',false,'.island-content');assertShrinking(contentExit,'日程内容');await delay(800);assert(widget.getBounds().width<=308,'移开不能收起');assert(Math.abs(widget.getBounds().x-anchor.x)<=1,'展开收起改变了岛的位置');
  // 未播完就反向悬停，检查过渡最终回到完整收起状态。
  setHover(true);await delay(210);
  setHover(false);await delay(900);
  const recovered=await js(`(()=>{const mini=getComputedStyle(document.querySelector('.island-mini')),content=getComputedStyle(document.querySelector('.island-content'));return {miniOpacity:Number(mini.opacity),miniScale:new DOMMatrixReadOnly(mini.transform).a,contentOpacity:Number(content.opacity)};})()`,widget);
  assert(recovered.miniOpacity===1&&recovered.miniScale===1&&recovered.contentOpacity===0,'反向过渡没有正确结束');
  widget.webContents.debugger.attach('1.3');await widget.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  setHover(true);
  await wait(()=>js(`document.querySelector('.island-shell').classList.contains('is-expanded')`,widget),'减少动态效果时未展开');
  assert(await js(`['.island-shell','.island-mini','.island-content'].every(selector=>getComputedStyle(document.querySelector(selector)).transitionDuration==='0s')`,widget),'系统减少动态效果未覆盖展开动画');
  setHover(false);await delay(350);
  await widget.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});widget.webContents.debugger.detach();
  // 系统原生移动由 will-move/moved 驱动，不再轮询坐标重新设置边界。
  const start=widget.getBounds();assert(await js(`getComputedStyle(document.querySelector('.island-drag')).webkitAppRegion==='drag'`,widget),'没有启用系统拖动区域');widget.emit('will-move',{});cursor={x:550,y:390};await delay(100);const moved=widget.getBounds();assert(moved.x===start.x&&moved.y===start.y,'软件仍在轮询鼠标并移动窗口');await delay(500);assert(widget.getBounds().x===moved.x,'按住停留时发生了吸附');widget.emit('moved');assert(fs.existsSync(path.join(profile,'window-placement.json')),'松手没有保存位置');
  await assertReject(()=>js(`window.coldesk.invoke('widget:dragStart')`),'主窗口能够操作组件拖动');
  // 到期提醒只在岛上出现，可关闭和完成。
  const soon=new Date(Date.now()+5*60000),due=`${soon.getFullYear()}-${String(soon.getMonth()+1).padStart(2,'0')}-${String(soon.getDate()).padStart(2,'0')}T${String(soon.getHours()).padStart(2,'0')}:${String(soon.getMinutes()).padStart(2,'0')}`;
  await js(`window.coldesk.invoke('task:create',{title:'灵动岛提醒检查',urgency:5,dueAt:'${due}',estMinutes:15})`);
  await js(`window.coldesk.invoke('state:refresh')`);
  await wait(()=>js(`!!document.querySelector('.island-notice h2')`,widget),'提醒没有展开灵动岛');await delay(700);await shot('notification');
  const popup=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('toast.html'));assert(!popup?.isVisible(),'岛模式仍出现独立弹窗');
  await js(`Array.from(document.querySelectorAll('.island-notice-actions button')).find(b=>b.textContent==='完成').click()`,widget);await wait(()=>js(`window.coldesk.invoke('task:list').then(tasks=>tasks.find(t=>t.title==='灵动岛提醒检查')?.status==='done')`),'完成按钮未更新任务');
  await js(`window.coldesk.invoke('toast:clear')`);await js(`window.coldesk.invoke('settings:update',{desktopMode:'widget'})`);await wait(()=>js(`!!document.querySelector('.widget-shell')`,widget),'不能返回普通浮窗');await delay(700);assert(widget.getBounds().width>=260,'普通浮窗宽度未恢复');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({ok:true,miniExit,contentExit,reverseTransition:true,reducedMotion:true,clockMoves:true,uniquePlacement:true,wholeBlockDrag:true,hover:true,geometry:true,anchorStable:true,nativeDragRegion:true,noCoordinatePolling:true,noSnapDuringDrag:true,notification:true,completed:true,normalModeRestored:true},null,2));
  console.log('灵动岛与日程检查通过');app.quit();
}catch(e){if(widget&&!widget.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await widget.capturePage()).toPNG());console.error(e);app.exit(1);}})();
async function assertReject(fn,msg){try{await fn();}catch{return;}throw new Error(msg);}
