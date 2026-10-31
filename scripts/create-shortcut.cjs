/** 在工程旁建立带自定义图标的启动入口；不改写 Electron 运行时。 */
const { app, shell } = require('electron');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const shortcutPath = path.join(root, '..', 'ColDesk.lnk');
app.whenReady().then(() => {
  const ok = shell.writeShortcutLink(shortcutPath, 'create', {
    target: app.getPath('exe'),
    args: `"${root}"`,
    cwd: root,
    description: 'ColDesk · 桌面日程与任务管理',
    icon: path.join(root, 'assets', 'icons', 'app-icon.ico'),
    iconIndex: 0,
    appUserModelId: 'com.coldesk.app'
  });
  if (!ok) throw new Error('无法创建 ColDesk 启动入口');
  console.log(JSON.stringify({ shortcutPath, details: shell.readShortcutLink(shortcutPath) }, null, 2));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
