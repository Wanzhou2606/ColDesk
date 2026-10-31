/** 拖拽日程实机检查，独立测试库；--interactive 留出窗口供原生鼠标拖拽复核。 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');const path = require('node:path');
const output = path.resolve(__dirname,'../preview/schedule-drag-check');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(output,'data-')));app.setLoginItemSettings=()=>{};app.getLoginItemSettings=()=>({openAtLogin:false});
process.env.COLDESK_SEED_SAMPLE='1';process.env.COLDESK_DISABLE_SCHEDULER='1';
require(path.resolve(__dirname,'../out/main/index.cjs'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const waitFor=async(fn,msg)=>{for(let i=0;i<60;i++){if(await fn())return;await delay(100);}throw new Error(msg);};
(async()=>{
  let main;
  try {
    await app.whenReady();await delay(2000);main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk');
    for(const win of BrowserWindow.getAllWindows())if(win!==main)win.hide();main.show();main.focus();
    const js=code=>main.webContents.executeJavaScript(code);
    const capture=async name=>{await delay(180);fs.writeFileSync(path.join(output,name+'.png'),(await main.capturePage()).toPNG());};
    await js(`window.coldesk.invoke('settings:update',{onboardingVersion:1,autoSchedule:false,scheduleStart:'00:00',scheduleEnd:'24:00'})`);
    const initial=await js(`window.coldesk.invoke('state:get')`);
    const state=await js(`window.coldesk.invoke('task:create',{title:'拖拽安排测试',domain:'study',urgency:5,dueAt:'${initial.date}T23:59',estMinutes:75,splittable:true})`);
    const task=[...Object.values(state.buckets).flat()].find(t=>t.title==='拖拽安排测试');assert(task,'未创建测试任务');
    const day=state.week.days.find(d=>d.blocks.some(b=>b.kind==='lesson'));assert(day,'测试范围内没有课程');
    await js(`Array.from(document.querySelectorAll('.schedule-switch button')).find(b=>b.textContent==='周视图').click()`);await delay(120);
    await js(`Array.from(document.querySelectorAll('.week-day-head')).find(b=>b.title.includes('${day.dayLabel}')).click()`);
    await waitFor(()=>js(`!!document.querySelector('.day-view-grid')`),'周日期不能打开日程表');
    await js(`document.querySelector('.day-view-canvas').scrollTop=0`);
    await js(`(()=>{const input=document.querySelector('[data-task-id="${task.id}"]').closest('li').querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'70');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(150);
    if(process.argv.includes('--interactive')){
      fs.writeFileSync(path.join(output,'native-plan.json'),JSON.stringify({taskId:task.id,date:day.date,expectedDuration:70},null,2));
      console.log('原生拖拽复核窗口已就绪');
      setInterval(async()=>{try{const current=await js(`window.coldesk.invoke('state:get')`);const blocks=current.week.days.find(d=>d.date===day.date)?.blocks.filter(b=>b.taskId===task.id);fs.writeFileSync(path.join(output,'native-result.json'),JSON.stringify({blocks},null,2));}catch{}},700);
      return;
    }
    const startDrag=async()=>{
      await js(`(()=>{globalThis.scheduleTestTransfer=new DataTransfer();document.querySelector('[data-task-id="${task.id}"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:scheduleTestTransfer}));})()`);await delay(130);
    };
    const hover=async minute=>js(`(()=>{const grid=document.querySelector('.day-view-grid'),rect=grid.getBoundingClientRect();grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:scheduleTestTransfer,clientX:rect.left+90,clientY:rect.top+${minute}/1440*rect.height}));})()`);
    const drop=async minute=>js(`(()=>{const grid=document.querySelector('.day-view-grid'),rect=grid.getBoundingClientRect();grid.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:scheduleTestTransfer,clientX:rect.left+90,clientY:rect.top+${minute}/1440*rect.height}));})()`);
    await startDrag();await hover(390);await waitFor(()=>js(`!!document.querySelector('.schedule-drop-preview')`),'没有拖拽预览');await capture('preview');
    await drop(390);await waitFor(()=>js(`document.querySelector('.schedule-placement-message')?.textContent.includes('已安排到')`),'拖拽保存失败');
    const saved=await js(`window.coldesk.invoke('state:get')`);let placed=saved.week.days.find(d=>d.date===day.date).blocks.find(b=>b.taskId===task.id&&b.locked);
    assert(placed&&placed.startMinute===390&&placed.endMinute===460,'落点或自定义时长不正确');
    await capture('placed');
    const lesson=day.blocks.find(b=>b.kind==='lesson');
    await startDrag();await hover(lesson.startMinute+10);await waitFor(()=>js(`!!document.querySelector('.schedule-drop-preview.conflict')`),'课程冲突没有标红');await capture('conflict');
    await drop(lesson.startMinute+10);await waitFor(()=>js(`document.querySelector('.schedule-placement-message.error')?.textContent.includes('冲突')`),'后端未拒绝课程冲突');
    const unchanged=await js(`window.coldesk.invoke('state:get')`);assert(unchanged.week.days.find(d=>d.date===day.date).blocks.filter(b=>b.taskId===task.id&&b.locked).length===1,'冲突仍写入了日程');
    // 移动已有手动安排，不应新建副本。
    await js(`(()=>{scheduleTestTransfer=new DataTransfer();document.querySelector('.time-block.locked .time-block-content').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:scheduleTestTransfer}));})()`);await delay(130);await hover(400);await drop(400);await delay(220);
    const moved=await js(`window.coldesk.invoke('state:get')`);const manual=moved.week.days.find(d=>d.date===day.date).blocks.filter(b=>b.taskId===task.id&&b.locked);
    assert(manual.length===1&&manual[0].id===placed.id&&manual[0].startMinute===400,'移动产生了副本或位置不正确');
    await js(`window.coldesk.invoke('settings:update',{autoSchedule:true})`);await js(`window.coldesk.invoke('schedule:replan')`);
    const replanned=await js(`window.coldesk.invoke('state:get')`);placed=replanned.week.days.find(d=>d.date===day.date).blocks.find(b=>b.id===placed.id);assert(placed?.startMinute===400&&placed.locked,'重排挪动了手动安排');
    main.setSize(900,600);await delay(220);const narrow=await js(`({width:document.querySelector('.content').clientWidth,scrollWidth:document.querySelector('.content').scrollWidth})`);assert(narrow.scrollWidth<=narrow.width+1,'小窗口横向溢出');await capture('narrow');
    await js(`window.coldesk.invoke('settings:update',{autoSchedule:false})`);await js(`document.querySelector('.time-block.locked .remove-placement-btn').click()`);await waitFor(()=>js(`!document.querySelector('.time-block.locked')`),'不能移除手动安排');
    assert(await js(`window.coldesk.invoke('task:list').then(tasks=>tasks.some(t=>t.id==='${task.id}'))`),'移除安排误删任务');
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({ok:true,date:day.date,customDuration:70,courseConflict:true,moveWithoutDuplicate:true,replanPreserved:true,removeKeepsTask:true,narrow},null,2));
    console.log('拖拽检查通过：落点、时长、课程冲突、移动、重排保留与移除');app.quit();
  }catch(error){if(main&&!main.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await main.capturePage()).toPNG());console.error(error);app.exit(1);}
})();
