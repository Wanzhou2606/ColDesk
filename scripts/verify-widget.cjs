/** 真 Electron 下验证尺寸、输入与视觉。独立测试目录，不读写用户业务库。 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'preview', 'widget-check');
process.env.COLDESK_SEED_SAMPLE = '1';
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'data'));
// 本次只测渲染，不改变 Windows 开机启动配置。
app.setLoginItemSettings = () => {};
app.getLoginItemSettings = () => ({ openAtLogin: false });
let sizeCalls = 0;
const errors = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  if (channel === 'widget:setSize') sizeCalls++;
  return listener(...args);
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_e, details) => errors.push(details));
  contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
});
require(path.join(root, 'out/main/index.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const waitFor = async (check, message) => {
  for (let i = 0; i < 50; i++) { if (await check()) return; await delay(100); }
  throw new Error(message);
};
const inspect = win => win.webContents.executeJavaScript(`(() => {
  const shell = document.querySelector('.widget-shell');
  const footer = document.querySelector('.widget-compose');
  const root = document.querySelector('.widget-root');
  const body = document.querySelector('.widget-body');
  return { width: innerWidth, height: innerHeight, shellClass: shell?.className, documentWidth: document.documentElement.scrollWidth, rootHeight: root?.getBoundingClientRect().height, shellHeight: shell?.getBoundingClientRect().height, footerBottom: footer?.getBoundingClientRect().bottom, bodyClientHeight: body?.clientHeight, bodyScrollHeight: body?.scrollHeight, text: document.body.innerText, animations: document.getAnimations().filter(a => a.playState === 'running').length };
})()`);
(async () => {
  try {
    await app.whenReady();
    await delay(3500);
    const widget = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/widget.html'));
    assert(widget, '未找到真实悬浮窗');
    // 模拟用户实际操作浮窗时的前台状态，避免后台窗口的帧节流影响尺寸检查。
    widget.show();
    widget.focus();
    let initial = await inspect(widget);
    assert(initial.text.includes('ColDesk'), '悬浮窗尚未渲染');
    assert(initial.footerBottom <= initial.height, '底部快捷操作被裁切');
    assert(initial.documentWidth === initial.width, '悬浮窗有横向溢出');
    fs.writeFileSync(path.join(output, 'widget.png'), (await widget.capturePage()).toPNG());
    const callsBeforeTyping = sizeCalls;
    await widget.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.quick-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      for(let i=1;i<=20;i++){ setter.call(input, '输入响应测试'.repeat(4).slice(0,i)); input.dispatchEvent(new Event('input', {bubbles:true})); }
    })()`);
    await delay(400);
    const callsAfterTyping = sizeCalls - callsBeforeTyping;
    assert(callsAfterTyping === 0, `输入引发了 ${callsAfterTyping} 次多余的窗口尺寸请求`);
    await widget.webContents.executeJavaScript(`(() => { const input = document.querySelector('.quick-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.collapse-btn').click(); })()`);
    await waitFor(async () => (await inspect(widget)).height <= 90, '浮窗折叠未完成');
    const collapsed = await inspect(widget);
    assert(collapsed.height <= 90, `折叠仍占用 ${collapsed.height}px`);
    fs.writeFileSync(path.join(output, 'collapsed.png'), (await widget.capturePage()).toPNG());
    await widget.webContents.executeJavaScript(`document.querySelector('.collapse-btn').click()`);
    await delay(400);
    widget.setSize(260, widget.getBounds().height);
    await delay(400);
    const narrow = await inspect(widget);
    assert(narrow.documentWidth === narrow.width, '最窄宽度发生横向溢出');
    assert(narrow.footerBottom <= narrow.height, '最窄宽度时底部被裁切');
    fs.writeFileSync(path.join(output, 'narrow.png'), (await widget.capturePage()).toPNG());
    widget.setSize(340, widget.getBounds().height);
    await delay(400);
    const settled = await inspect(widget);
    assert(settled.animations === 0, '浮窗静置时仍有持续动画');
    const showcase = new BrowserWindow({ width: 1040, height: 940, show: false, backgroundColor: '#f2f4f7', webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await showcase.loadFile(path.join(root, 'preview/harmony-glass.html'));
    await delay(1000);
    fs.writeFileSync(path.join(output, 'harmony-preview.png'), (await showcase.capturePage()).toPNG());
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/main.html'));
    await main.webContents.executeJavaScript(`window.coldesk.invoke('settings:update', {onboardingVersion:1})`);
    await main.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.schedule-switch button')).find(b => b.textContent === '日程表').click()`);
    await waitFor(() => main.webContents.executeJavaScript(`!!document.querySelector('.day-view-canvas')`), '时间轴没有打开');
    await delay(200);
    // 初次异步加载数据后，应自动滚到当天当前时段。
    const dayScroll = await main.webContents.executeJavaScript(`({ scroll: document.querySelector('.day-view-canvas')?.scrollTop, now: document.querySelector('.now-label')?.textContent, hoursTransform: document.querySelector('.day-view-hours')?.style.transform })`);
    if (Number(dayScroll.now?.slice(0, 2)) >= 10) assert(dayScroll.scroll > 0, '异步数据加载后未滚动到当前时段');
    // 高 DPI 下 scrollTop 可含小数，CSS 序列化会舍入；比较实际偏移而非字符串。
    assert(Math.abs(parseFloat(dayScroll.hoursTransform?.slice('translateY('.length)) + dayScroll.scroll) < 0.5, '时间刻度未跟随日程一起滚动');
    // 点击真实 React 按钮，覆盖主窗口已打开、已关闭和最小化三条路径。
    let targetMain = main;
    const openFromWidget = async (title, heading) => {
      await widget.webContents.executeJavaScript(`document.querySelector('button[title="${title}"]').click()`);
      await waitFor(async () => {
        targetMain = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ColDesk');
        if (!targetMain || targetMain.webContents.isLoading()) return false;
        return await targetMain.webContents.executeJavaScript(`document.querySelector('h1')?.textContent === ${JSON.stringify(heading)}`);
      }, `${title} 未跳到 ${heading}`);
      assert(targetMain.isVisible() && !targetMain.isMinimized(), '目标主窗口不可见');
    };
    await openFromWidget('打开设置', '设置');
    await openFromWidget('记一笔支出', '记账');
    targetMain.close();
    await openFromWidget('打开设置', '设置');
    await targetMain.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.settings-nav-item')).find(b => b.textContent.includes('悬浮窗')).click()`);
    await waitFor(() => targetMain.webContents.executeJavaScript(`!!document.querySelector('input[type="range"]')`), '未打开悬浮窗设置');
    assert(await targetMain.webContents.executeJavaScript(`!document.querySelector('.light-options')`), '三档入口仍存在');
    fs.writeFileSync(path.join(output, 'settings.png'), (await targetMain.capturePage()).toPNG());
    await targetMain.webContents.executeJavaScript(`(() => { const input = document.querySelector('input[type="range"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '45'); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await waitFor(() => widget.webContents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue('--glass-tint-alpha').trim() === '0.45'`), '透明度滑块未同步到浮窗');
    await widget.webContents.executeJavaScript(`window.coldesk.invoke('state:refresh')`);
    assert(await widget.webContents.executeJavaScript(`window.coldesk.invoke('state:get').then(s => s.settings.glassOpacity === 0.45 && !('glassLight' in s.settings))`), '重新加载丢失透明度或三档未清理');
    targetMain.close();
    await openFromWidget('记一笔支出', '记账');
    targetMain.minimize();
    await openFromWidget('打开设置', '设置');
    await widget.webContents.executeJavaScript(`window.coldesk.invoke('window:setGlass', {glassOpacity:0.62})`);
    assert(errors.length === 0, `渲染错误：${JSON.stringify(errors)}`);
    for (const file of ['failure.txt', 'diagnostic.json']) { const stale = path.join(output, file); if (fs.existsSync(stale)) fs.unlinkSync(stale); }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ initial, collapsed, narrow, settled, dayScroll, navigation: 'existing, closed settings, closed expenses, minimized', opacityReload: 0.45, callsAfterTyping, sizeCalls, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, output, callsAfterTyping, collapsedHeight: collapsed.height, narrowWidth: narrow.width, idleAnimations: settled.animations, dayScroll }, null, 2));
    app.quit();
  } catch(error) {
    fs.writeFileSync(path.join(output, 'diagnostic.json'), JSON.stringify(await Promise.all(BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('/main.html')).map(w => w.webContents.executeJavaScript(`({ scroll: document.querySelector('.day-view-canvas')?.scrollTop, canvasHeight: document.querySelector('.day-view-canvas')?.clientHeight, canvasScrollHeight: document.querySelector('.day-view-canvas')?.scrollHeight, hoursTransform: document.querySelector('.day-view-hours')?.style.transform })`))), null, 2));
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack || error));
    console.error(error);
    app.exit(1);
  }
})();
