/** 主窗口实机布局检查，使用独立数据目录，禁用开机启动写入。 */
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'preview', 'main-check');
process.env.COLDESK_SEED_SAMPLE = '1';
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'data'));
app.setLoginItemSettings = () => {};
app.getLoginItemSettings = () => ({ openAtLogin: false });
nativeTheme.themeSource = 'light';
require(path.join(root, 'out/main/index.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const waitFor = async (check, message) => { for (let i = 0; i < 60; i++) { if (await check()) return; await delay(100); } throw new Error(message); };
const evaluate = (win, code) => win.webContents.executeJavaScript(code);
const capture = async (win, name) => fs.writeFileSync(path.join(output, name + '.png'), (await win.capturePage()).toPNG());
const geometry = win => evaluate(win, `(() => { const content = document.querySelector('.content'); return { width:innerWidth, height:innerHeight, contentWidth:content.clientWidth, scrollWidth:content.scrollWidth, bodyWidth:document.documentElement.scrollWidth, title:document.querySelector('h1')?.textContent, runningAnimations:document.getAnimations().filter(a=>a.playState==='running').length }; })()`);
const checkBlocks = (win, selector) => evaluate(win, `(() => { const elements=Array.from(document.querySelectorAll('${selector}')); const pairs=[]; for(let i=0;i<elements.length;i++)for(let j=i+1;j<elements.length;j++){if(elements[i].parentElement!==elements[j].parentElement)continue;const a=elements[i].getBoundingClientRect(),b=elements[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)pairs.push([elements[i].textContent,elements[j].textContent]);}return {count:elements.length,overlaps:pairs}; })()`);
(async () => {
  const report = {};
  let main;
  try {
    await app.whenReady();
    await delay(2500);
    main = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ColDesk');
    await evaluate(main, `window.coldesk.invoke('settings:update', {onboardingVersion:1})`);
    await waitFor(() => evaluate(main, `!!document.querySelector('.day-view-grid') && !document.body.innerText.includes('正在加载')`), '默认日程表没有加载');
    report.day = await geometry(main);
    assert(report.day.scrollWidth <= report.day.contentWidth + 1, '默认日程横向溢出');
    assert(report.day.runningAnimations === 0, '静置时有持续动画');
    await capture(main, 'schedule');
    const switchView = async label => {
      await evaluate(main, `Array.from(document.querySelectorAll('.schedule-switch button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
      await delay(250);
    };
    await switchView('日程表');
    report.timeline = await checkBlocks(main, '.time-block');
    assert(report.timeline.overlaps.length === 0, '时间轴安排仍相互遮挡');
    await capture(main, 'timeline');
    await switchView('周视图');
    report.week = await checkBlocks(main, '.week-block');
    assert(report.week.overlaps.length === 0, '周视图安排仍相互遮挡');
    report.weekGeometry = await geometry(main);
    assert(report.weekGeometry.scrollWidth <= report.weekGeometry.contentWidth + 1, '周视图撑宽了页面');
    await capture(main, 'week');
    await evaluate(main, `document.querySelector('.week-day-head:not(.today)').click()`);
    await waitFor(() => evaluate(main, `!!document.querySelector('.picked-day-bar') && !!document.querySelector('.day-view-grid')`), '点击周日期未进入日程表');
    await evaluate(main, `document.querySelector('.picked-day-bar button').click()`);
    await waitFor(() => evaluate(main, `!document.querySelector('.picked-day-bar')`), '回到今天失效');
    main.setSize(900, 600);
    await delay(300);
    report.narrow = await geometry(main);
    assert(report.narrow.scrollWidth <= report.narrow.contentWidth + 1, '最小窗口横向溢出');
    await capture(main, 'schedule-narrow');
    await switchView('周视图');
    report.narrowWeek = await geometry(main);
    assert(report.narrowWeek.scrollWidth <= report.narrowWeek.contentWidth + 1, '最小窗口周视图横向溢出');
    await switchView('日程表');
    main.setSize(1120, 760);
    await delay(200);
    report.pages = [];
    for (const label of ['学习任务', '生活', '记账', '打卡']) {
      await evaluate(main, `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
      await delay(250);
      const page = await geometry(main);
      assert(page.scrollWidth <= page.contentWidth + 1, `${label} 页面横向溢出`);
      report.pages.push(page);
      if (label === '学习任务' || label === '记账') await capture(main, label === '记账' ? 'expenses' : 'study');
    }
    await evaluate(main, `document.querySelector('.settings-pill').click()`);
    await delay(200);
    await capture(main, 'settings');
    await evaluate(main, `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='日程').click()`);
    await delay(200);
    const firstTask = await evaluate(main, `window.coldesk.invoke('state:get').then(s => [...s.todayTasks, ...s.urgentTasks][0]?.task)`);
    if(firstTask) {
      const border = await evaluate(main, `getComputedStyle(document.querySelector('.deadline-list .check')).borderTopStyle`);
      assert(border === 'solid', '截止任务完成按钮不可见');
      await evaluate(main, `document.querySelector('.deadline-list .check').click()`);
      await waitFor(() => evaluate(main, `!Array.from(document.querySelectorAll('.deadline-list button')).some(b=>b.getAttribute('aria-label')===${JSON.stringify('完成：' + firstTask.title)})`), '截止任务完成操作失效');
      await evaluate(main, `window.coldesk.invoke('task:reopen', {id:${JSON.stringify(firstTask.id)}})`);
      await delay(200);
      report.deadlineCompletion = true;
    }
    nativeTheme.themeSource = 'dark';
    await delay(350);
    await capture(main, 'schedule-dark');
    report.dark = await geometry(main);
    nativeTheme.themeSource = 'light';
    await evaluate(main, `document.documentElement.dataset.contrast='high'`);
    await delay(200);
    await capture(main, 'schedule-contrast');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const failure = path.join(output, 'failure.txt'); if(fs.existsSync(failure))fs.unlinkSync(failure);
    console.log(JSON.stringify({ok:true,output,...report},null,2));
    app.quit();
  } catch(error) {
    fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack || error));
    if(main && !main.isDestroyed()) await capture(main,'failure');
    console.error(error); app.exit(1);
  }
})();
