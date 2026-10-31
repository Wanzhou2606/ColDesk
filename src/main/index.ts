/**
 * ColDesk 主进程入口。
 * 启动顺序：单实例锁 → 数据库 → 状态装载 → 窗口 → IPC → 托盘 → 调度器
 */

import { join, isAbsolute } from 'node:path';
import { updateIconShortcuts, customIconPath } from './personalization';
import { appIconPath } from './icon';
import { mkdirSync } from 'node:fs';
import {watchExternalChanges} from './externalChanges';
import { app, BrowserWindow, powerMonitor, Menu } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

import { closeDatabase, getDataDir, initDatabase, seedIfEmpty, initializeUserData } from './db';
import {
  applyAutoLaunch,
  applyWidgetLayer,
  buildPreloadPath,
  createDrawerWindow,
  createMainWindow,
  getWindow,
  navigateMainWindow,
  createToastWindow,
  createTray,
  createWidgetWindow,
  getAutoLaunch,
  initPlacements,
  initWindows,
  registerShortcuts,
  repositionToastWindow,
  toggleWidget,
  unregisterShortcuts,
  updateTrayMenu
} from './windows';
import { registerIpc } from './ipc';
import { store } from './store';
import { catchUpAfterResume, startScheduler, stopScheduler, tick } from './scheduler';
import { broadcast } from './windows';
import { APP_USER_MODEL_ID } from './icon';
import { homeVault } from './home';
import { flushHome } from './homeIpc';
import { showStartupDigest } from './startupDigest';

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

// 支持隔离的本地检查配置；普通安装不设置此环境变量，仍使用 Windows 的用户数据目录。
const profileDir = process.env.COLDESK_PROFILE_DIR;
if (profileDir) {
  if (!isAbsolute(profileDir)) throw new Error('独立配置目录需要使用绝对路径');
  mkdirSync(profileDir, { recursive: true });
  app.setPath('userData', profileDir);
}

let stopExternalWatch=()=>{};
const gotLock = app.requestSingleInstanceLock();
if (!gotLock || process.argv.includes('--quit-for-update')) {
  app.quit();
} else {
  app.on('second-instance', (_event,argv) => {
    if(argv?.includes('--quit-for-update')){app.quit();return;}
    createMainWindow();
  });

  app.whenReady().then(() => {
    if (!process.env.ELECTRON_RENDERER_URL) Menu.setApplicationMenu(null);
    const dataDir = app.getPath('userData');
    initDatabase(dataDir);
    if (!app.isPackaged && process.env.COLDESK_SEED_SAMPLE === '1') seedIfEmpty();
    else initializeUserData();
    initWindows(buildPreloadPath());
    initPlacements(join(dataDir, 'window-placement.json'));

    store.load();
    if (customIconPath()) updateIconShortcuts(appIconPath());
    registerIpc();

    // 托盘先建，保证窗口创建失败也能退出
    const trayHandlers = {
      onOpenMain: () => createMainWindow(),
      onToggleWidget: () => toggleWidget(),
      onQuickAdd: () => {
        navigateMainWindow({ page: 'study', action: 'quick-add' });
      },
      onReplan: () => {
        navigateMainWindow({page:'schedule'});
      },
      onQuit: () => {
        app.quit();
      },
      autoLaunch: getAutoLaunch(),
      onToggleAutoLaunch: (next: boolean) => {
        applyAutoLaunch(next);
        store.updateSettings({ autoLaunch: next });
        updateTrayMenu({ ...trayHandlers, autoLaunch: next });
      },
      desktopLayer: store.getSettings().desktopLayer,
      // 置底之后悬浮窗可能被别的窗口盖住，这是把它救回来的入口
      onSetDesktopLayer: (layer: 'top' | 'normal' | 'bottom') => {
        applyWidgetLayer(layer);
        store.updateSettings({ desktopLayer: layer });
        updateTrayMenu({ ...trayHandlers, desktopLayer: layer });
      }
    };
    createTray(trayHandlers);

    createMainWindow();
    createToastWindow();

    // 桌面组件按设置决定：悬浮窗 / 贴边抽屉 / 两者
    const desktopMode = store.getSettings().desktopMode;
    if (desktopMode !== 'drawer') createWidgetWindow();
    if (desktopMode === 'drawer'||desktopMode === 'both') createDrawerWindow();

    // 恢复用户上次选的悬浮窗层级（默认固定最前）
    applyWidgetLayer(store.getSettings().desktopLayer);

    registerShortcuts({
      onQuickAdd: () => {
        navigateMainWindow({ page: 'study', action: 'quick-add' });
      },
      onToggleWidget: () => toggleWidget()
    });

    startScheduler();
    if(process.env.COLDESK_DISABLE_SCHEDULER!=='1')setTimeout(showStartupDigest,1800).unref();

    // 设置里勾选的开机自启与系统实际状态对齐
    const settings = store.getSettings();
    if (settings.autoLaunch !== getAutoLaunch()) applyAutoLaunch(settings.autoLaunch);

    // 状态变化 → 所有渲染窗口刷新
    store.on('change', (state) => {broadcast('state:changed', state);updateTrayMenu({...trayHandlers,autoLaunch:store.getSettings().autoLaunch,desktopLayer:store.getSettings().desktopLayer});});

    stopExternalWatch=process.env.COLDESK_DISABLE_SCHEDULER==='1'?()=>{}:watchExternalChanges(()=>store.refreshExternalData());

    powerMonitor.on('resume', () => {
      catchUpAfterResume();
      repositionToastWindow();
      store.refresh();
    });

    app.on('browser-window-created', (_event, win: BrowserWindowType) => {
      win.setMenuBarVisibility(false);
    });
  });

  app.on('activate', () => {
    createMainWindow();
  });

  // 关闭主窗口不退出，继续在托盘提醒
  app.on('window-all-closed', () => {
    /* 保持后台运行 */
  });

  let readyToQuit = false;
  let waitingToQuit = false;
  app.on('before-quit', event => {
    const main = getWindow('main');
    if (!readyToQuit && main && homeVault.hasDraft(main.webContents.id)) {
      event.preventDefault();
      if (!waitingToQuit) {
        waitingToQuit = true;
        void flushHome(main.webContents).then(ok => { waitingToQuit = false; if (ok) { readyToQuit = true; app.quit(); } });
      }
      return;
    }
    stopExternalWatch();
    stopScheduler();
    unregisterShortcuts();
    closeDatabase();
  });

  // 数据目录迁移后需要重启
  app.on('will-quit', () => {
    console.info(`[coldesk] 数据目录：${getDataDir()}`);
  });
}
