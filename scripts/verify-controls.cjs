/** Exercise the redesigned controls in an isolated profile; never open personal data. */
const {app, BrowserWindow, nativeTheme} = require('electron');
const fs = require('node:fs'), path = require('node:path');
const output = path.resolve(__dirname, '../preview/controls');
fs.mkdirSync(output, {recursive: true});
for (const name of ['report.json', 'error.txt']) {
  const file = path.join(output, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
app.setPath('userData', fs.mkdtempSync(path.join(output, 'data-')));
app.requestSingleInstanceLock = () => true;
app.setLoginItemSettings = () => {};
app.getLoginItemSettings = () => ({openAtLogin: false});
app.disableHardwareAcceleration();
nativeTheme.themeSource = 'light';
process.env.COLDESK_DISABLE_SCHEDULER = '1';
delete process.env.COLDESK_SEED_SAMPLE;
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
require('../out/main/index.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => {if (!value) throw Error(message);};
const wait = async (check, message) => {for (let i = 0; i < 100; i++) {if (await check()) return; await delay(80);} throw Error(message);};
setTimeout(() => {fs.writeFileSync(path.join(output, 'error.txt'), 'Control verification timed out'); app.exit(1);}, 90000).unref();
(async () => {
  let main;
  try {
    await app.whenReady();
    await wait(() => {main = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'ColDesk'); return main && !main.webContents.isLoading();}, 'Main window missing');
    main.setSize(1320, 900); main.setIgnoreMouseEvents(true); main.showInactive(); main.webContents.setBackgroundThrottling(false);
    const js = code => main.webContents.executeJavaScript(code);
    const invoke = (channel, payload = {}) => js(`window.coldesk.invoke(${JSON.stringify(channel)},${JSON.stringify(payload)})`);
    const click = async selector => {await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(100);};
    const setValue = async (selector, value) => {await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await delay(100);};
    const shot = async (name, rect) => {await delay(350); fs.writeFileSync(path.join(output, name + '.png'), (await main.capturePage(rect, {stayHidden: true, stayAwake: true})).toPNG());};
    await js("window.addEventListener('blur',event=>event.stopImmediatePropagation(),true)");
    await invoke('settings:update', {onboardingVersion: 1, mainTheme: 'garden'});
    const date = (await invoke('state:get')).date;
    for (const [title, urgency, minutes, time] of [['复习日语词汇', 5, 45, '12:00'], ['整理项目材料', 3, 90, '20:00'], ['准备周末阅读', 2, 25, '23:59']]) {
      await invoke('task:create', {title, domain: 'study', type: 'todo', urgency, estMinutes: minutes, dueAt: date + 'T' + time, detail: '整理重点内容，按照自己的节奏完成。', splittable: true});
    }
    const task = Object.values((await invoke('state:get')).buckets).flat().find(item => item.title === '复习日语词汇');
    const input = `input[id="duration-${task.id}"]`, wrapper = input + ' ~ ';
    await wait(() => js(`!!document.querySelector(${JSON.stringify(input)})`), 'Duration control missing');
    const value = () => js(`document.querySelector(${JSON.stringify(input)}).value`);
    await click(wrapper + '.is-increase'); assert(await value() === '46', 'Increase did not update the duration');
    await click(wrapper + '.is-decrease'); assert(await value() === '45', 'Decrease did not update the duration');
    await setValue(input, '73'); assert(await value() === '73', 'Direct input was lost');
    await js(`document.querySelector(${JSON.stringify(input)}).focus()`);
    main.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Up'}); main.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Up'});
    await wait(async () => await value() === '74', 'Native keyboard increment stopped working');
    await setValue(input, '1'); assert(await js(`document.querySelector(${JSON.stringify(wrapper + '.is-decrease')}).disabled`), 'Minimum is not protected');
    await click(wrapper + '.is-increase'); assert(await value() === '2', 'Cannot leave the minimum');
    await setValue(input, '1440'); assert(await js(`document.querySelector(${JSON.stringify(wrapper + '.is-increase')}).disabled`), 'Maximum is not protected');
    await click(wrapper + '.is-decrease'); assert(await value() === '1439', 'Cannot leave the maximum');
    const dragTarget = `.deadline-drag-target[data-task-id="${task.id}"]`;
    for (const invalid of ['', '0', '1441', '1.5']) {
      await setValue(input, invalid);
      assert(await js(`!document.querySelector(${JSON.stringify(dragTarget)}).draggable`), 'Invalid duration can be dragged: ' + invalid);
    }
    await setValue(input, '74');
    const dragged = await js(`(()=>{const e=document.querySelector(${JSON.stringify(dragTarget)}),data=new DataTransfer();e.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const result=JSON.parse(data.getData(data.types.find(type=>type!=='text/plain')));e.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));return result;})()`);
    assert(dragged.durationMinutes === 74 && dragged.taskId === task.id, 'Drag did not use the custom duration');
    await click('.schedule-zoom [aria-label="放大日程"]');
    assert(await js("document.querySelector('.schedule-layout').dataset.zoom==='2'"), 'SVG zoom button is not functional');
    await click('.schedule-zoom [aria-label="恢复全天预览"]');
    await click('.schedule-date-trigger'); assert(await js('!!document.querySelector(".schedule-date-picker")'), 'Schedule calendar did not open');
    const month = await js('document.querySelector(".schedule-date-picker header strong").textContent');
    await click('.schedule-date-picker [aria-label="下个月"]'); assert(await js('document.querySelector(".schedule-date-picker header strong").textContent') !== month, 'Month arrow did not work');
    await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    const layouts = [];
    for (const [width, height] of [[1320, 900], [960, 720], [1800, 1050]]) {
      main.setSize(width, height); await delay(350);
      const layout = await js(`(()=>{const content=document.querySelector('.content'),control=document.querySelector(${JSON.stringify(input)}).parentElement,r=control.getBoundingClientRect();return {width:innerWidth,contentWidth:content.clientWidth,scrollWidth:content.scrollWidth,controlWidth:r.width,parts:[...control.children].map(e=>{const b=e.getBoundingClientRect();return {left:b.left-r.left,right:b.right-r.left,top:b.top-r.top,height:b.height}})}})()`);
      assert(layout.scrollWidth <= layout.contentWidth + 1, 'Window horizontally overflows: ' + width);
      assert(layout.parts.every(part => part.left >= 0 && part.right <= layout.controlWidth + .1 && part.height >= 20), 'Duration controls overlap or clip: ' + JSON.stringify(layout));
      layouts.push(layout); await shot('schedule-' + width);
    }
    main.setSize(1320, 900); await delay(300);
    const themes = [];
    for (const theme of ['default', 'blue', 'mint', 'lavender', 'rose', 'garden']) {
      await invoke('settings:update', {mainTheme: theme}); await delay(400);
      const colors = await js(`(()=>{const e=document.querySelector(${JSON.stringify(wrapper + '.is-increase')}),css=getComputedStyle(e);const probe=document.createElement('span');probe.style.color='var(--accent)';e.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {actual:css.color,expected}})()`);
      assert(colors.actual === colors.expected, 'Control color does not follow theme ' + theme + ': ' + JSON.stringify(colors)); themes.push({theme, ...colors});
    }
    await shot('schedule-light');
    const rect = await js("(()=>{const r=document.querySelector('.deadline-panel').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
    await shot('duration-detail', rect);
    nativeTheme.themeSource = 'dark'; await delay(250); await shot('schedule-dark');
    nativeTheme.themeSource = 'light';
    await invoke('task:openEditor', {id: task.id, field: 'all'});
    await wait(() => js('!!document.querySelector(".task-edit-dialog .number-stepper")'), 'Editor stepper missing');
    assert(await js("(()=>{const input=document.querySelector('.task-edit-dialog .number-stepper input');return input.closest('label').control===input})()"), 'Input lost its label association');
    await click('.task-edit-dialog .number-stepper .is-increase');
    assert(await js("document.querySelector('.task-edit-dialog .number-stepper input').value==='46'"), 'Editor increment failed');
    await setValue('.task-edit-dialog .number-stepper input', '75');
    await click('.deadline-date-trigger'); await wait(() => js('!!document.querySelector(".deadline-calendar")'), 'Deadline calendar did not open');
    await click('.deadline-calendar [aria-label="下个月"]'); await shot('deadline-calendar');
    await click('.deadline-calendar [aria-label="关闭日历"]');
    await shot('task-editor');
    await click('.task-edit-dialog button[type="submit"]');
    await wait(() => js('!document.querySelector(".task-edit-dialog")'), 'Editor did not save');
    assert(Object.values((await invoke('state:get')).buckets).flat().find(item => item.id === task.id).estMinutes === 75, 'Edited duration did not persist');
    await js("[...document.querySelectorAll('.nav-item')].find(e=>e.querySelector('.nav-label').textContent==='任务').click()"); await delay(750);
    await click('.task-page .primary-btn');
    await wait(() => js('!!document.querySelector(".task-form .number-stepper")'), 'New task duration missing');
    await click('.task-form .number-stepper .is-increase');
    assert(await js("document.querySelector('.task-form .number-stepper input').value==='50'"), 'Task form lost its five-minute step');
    await click('.task-form .number-stepper .is-decrease');
    assert(await js("document.querySelector('.task-form .number-stepper input').value==='45'"), 'Task form decrement failed');
    await shot('new-task');
    await invoke('settings:update', {language: 'en'}); await delay(150);
    assert(await js("document.querySelector('.task-form .is-increase').getAttribute('aria-label')==='Increase value'"), 'English control labels missing');
    await invoke('settings:update', {language: 'ja'}); await delay(150);
    assert(await js("document.querySelector('.task-form .is-increase').getAttribute('aria-label')==='値を増やす'"), 'Japanese control labels missing');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ok: true, directInput: true, keyboardStepping: true, boundaries: true, invalidDurationsBlocked: true, dragDuration: dragged.durationMinutes, editorPersistence: true, taskFormStep: 5, calendars: true, zoom: true, layouts, themes, languages: ['zh-CN', 'en', 'ja'], darkMode: true}, null, 2));
    app.quit();
  } catch (error) {
    fs.writeFileSync(path.join(output, 'error.txt'), error.stack || String(error));
    if (main && !main.isDestroyed()) try {fs.writeFileSync(path.join(output, 'failure.png'), (await main.capturePage()).toPNG());} catch {}
    app.exit(1);
  }
})();
