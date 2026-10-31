/** 验证构建后软件实际加载ColDesk 图标，使用独立测试库。 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'preview', 'icon-check');
process.env.COLDESK_SEED_SAMPLE = '1';
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'data'));
app.setLoginItemSettings = () => {};
app.getLoginItemSettings = () => ({ openAtLogin: false });
const nativeIcons = [];
const createImage = nativeImage.createFromBuffer.bind(nativeImage);
nativeImage.createFromBuffer = buffer => {
  const image = createImage(buffer);
  nativeIcons.push({ size: image.getSize(), empty: image.isEmpty(), matchesSelected: [32,256].some(size => buffer.equals(fs.readFileSync(path.join(root, `assets/icons/app-icon-${size}.png`)))) });
  return image;
};
require(path.join(root, 'out/main/index.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    await app.whenReady();
    await delay(2500);
    await BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ColDesk').webContents.executeJavaScript(`window.coldesk.invoke('settings:update', {onboardingVersion:1})`);
    await delay(100);
    const checks = [];
    for (const [title, selector, filename] of [['ColDesk', '.brand-logo', 'main.png'], ['ColDesk 悬浮窗', '.widget-logo', 'widget.png']]) {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title);
      if (!win) throw new Error(`找不到 ${title}`);
      const image = await win.webContents.executeJavaScript(`(() => { const img = document.querySelector('${selector}'); return { src: img?.currentSrc, loaded: img?.complete, width: img?.naturalWidth, height: img?.naturalHeight, background: img && getComputedStyle(img).backgroundColor, hasOldLetters: img?.textContent === 'CD' }; })()`);
      if (!image.loaded || image.width !== 256 || image.hasOldLetters) throw new Error(`${title} 图标未正确加载：${JSON.stringify(image)}`);
      checks.push({ title, image });
      fs.writeFileSync(path.join(output, filename), (await win.capturePage()).toPNG());
    }
    if (!nativeIcons.some(icon => icon.matchesSelected && icon.size.width === 32)) throw new Error('托盘未使用所选ColDesk 图标');
    if (!nativeIcons.some(icon => icon.matchesSelected && icon.size.width === 256)) throw new Error('原生窗口未使用所选ColDesk 图标');
    if (nativeIcons.some(icon => icon.empty)) throw new Error('存在无法解码的原生图标');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: true, checks, nativeIcons }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, nativeIcons }, null, 2));
    app.quit();
  } catch(error) { console.error(error); app.exit(1); }
})();
