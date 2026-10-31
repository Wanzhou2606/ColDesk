import {t} from '@shared/i18n';
/**
 * 窗口管理：主窗口、液态玻璃悬浮窗、贴边抽屉、提醒弹窗。
 *
 * 悬浮窗要点（设计文档 4.1 / 4.2）：
 *  - 无边框 + 透明 + Win11 acrylic 打底，圆角与高光交由 CSS 绘制
 *  - 顶部拖拽把手 + 松手吸附屏幕边缘
 *  - 位置按"显示器 + 缩放比例"持久化，显示器拔出后回落到主屏
 *  - 弹窗永不抢焦点（showInactive）
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, screen } from 'electron';
import type { BrowserWindow as BrowserWindowType, Rectangle, Tray as TrayType } from 'electron';

import { readIconChoice, updateIconShortcuts } from './personalization';
import { APP_USER_MODEL_ID, appIconPath, coldeskIcon } from './icon';
import { homeVault } from './home';
import { flushHome } from './homeIpc';
import { store } from './store';
import { clearHduPreview } from './hduCalendar';

export type WindowKind = 'main' | 'widget' | 'toast' | 'drawer';

let preloadFile = '';
const preloadPath = () => preloadFile;

function resolvePreload(): string {
  const candidates = [
    join(__dirname, '../preload/index.cjs'),
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js')
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1];
}

/** electron-vite 在开发模式下注入渲染进程地址 */
const devServerUrl = (): string | undefined => process.env.ELECTRON_RENDERER_URL || undefined;

function rendererHtml(kind: WindowKind): string {
  const file = kind === 'main' ? 'main.html' : kind === 'widget' ? 'widget.html' : 'toast.html';
  return join(__dirname, `../renderer/${file}`);
}

function loadWindow(win: BrowserWindow, kind: WindowKind): void {
  const url = devServerUrl();
  if (url) {
    const page = kind === 'main' ? 'main.html' : kind === 'widget' ? 'widget.html' : 'toast.html';
    void win.loadURL(`${url}/${page}`);
  } else {
    void win.loadFile(rendererHtml(kind));
  }
}

const windows = new Map<WindowKind, BrowserWindow>();
let tray: Tray | null = null;
/** 悬浮窗吸附回调：由 createWidgetWindow 注册，供 IPC 调用 */
let widgetSnapHandler: (() => void) | null = null;

export function snapWidget(): boolean {
  if (!widgetSnapHandler) return false;
  widgetSnapHandler();
  return true;
}

export function getWindow(kind: WindowKind): BrowserWindow | undefined {
  const win = windows.get(kind);
  return win && !win.isDestroyed() ? win : undefined;
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/* ------------------------------------------------------------ 位置持久化 */

interface PlacementState {
  [key: string]: { displayId: number; scaleFactor: number; x: number; y: number };
}

let placements: PlacementState = {};
let placementFile = '';

function loadPlacements(file: string): void {
  placementFile = file;
  if (existsSync(file)) {
    try {
      placements = JSON.parse(readFileSync(file, 'utf8')) as PlacementState;
    } catch {
      placements = {};
    }
  }
}

function savePlacements(): void {
  if (!placementFile) return;
  try {
    writeFileSync(placementFile, JSON.stringify(placements, null, 2), 'utf8');
  } catch {
    /* 位置保存失败不影响使用 */
  }
}

function placementKey(kind: WindowKind | 'island'): string {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return `${kind}@${display.id}`;
}

/** 默认放在工作区右下角，留出 18px 边距 */
function defaultBounds(kind: WindowKind | 'island', size: { width: number; height: number }): Rectangle {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const margin = 18;
  if(kind==='island')return {width:size.width,height:size.height,x:x+Math.round((width-size.width)/2),y:y+18};
  if (kind === 'drawer') {
    return { x: x + width - 4, y: y + Math.round(height / 2) - 30, width: 4, height: 60 };
  }
  return {
    width: size.width,
    height: size.height,
    x: x + width - size.width - margin,
    y: y + height - size.height - margin
  };
}

function restoreBounds(
  kind: WindowKind | 'island',
  size: { width: number; height: number }
): Rectangle {
  const display = screen.getPrimaryDisplay();
  const saved = placements[placementKey(kind)];
  if (saved) {
    const target = screen.getAllDisplays().find((d) => d.id === saved.displayId) ?? display;
    const width = size.width;
    const height = size.height;
    // Electron 的坐标已经是 DIP；再次乘缩放比会让位置漂移。
    let x = Math.round(saved.x);
    let y = Math.round(saved.y);
    // 保证窗口仍然可见
    const area = target.workArea;
    x = Math.max(area.x+8, Math.min(x, area.x+area.width-width-8));
    y = Math.max(area.y+8, Math.min(y, area.y+area.height-height-8));
    return { x, y, width, height };
  }
  return defaultBounds(kind, size);
}

function persistBounds(kind: WindowKind | 'island', win: BrowserWindow): void {
  const bounds = kind==='island' && islandAnchor ? islandAnchor : win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  placements[`${kind}@${display.id}`] = {
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    x: bounds.x,
    y: bounds.y
  };
  savePlacements();
}

/** 拖动松手后吸附到屏幕边缘（设计文档 4.2） */
function snapToEdge(win: BrowserWindow, threshold = 24): void {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  let { x, y } = bounds;

  if (Math.abs(x - area.x) < threshold) x = area.x + 8;
  if (Math.abs(x + bounds.width - (area.x + area.width)) < threshold) {
    x = area.x + area.width - bounds.width - 8;
  }
  if (Math.abs(y - area.y) < threshold) y = area.y + 8;
  if (Math.abs(y + bounds.height - (area.y + area.height)) < threshold) {
    y = area.y + area.height - bounds.height - 8;
  }

  if (x !== bounds.x || y !== bounds.y) {
    win.setBounds({ ...bounds, x, y }, false);
  }
  if(widgetPresentation==='island')updateIslandAnchor(win);
  persistBounds(widgetPresentation, win);
}

const ISLAND_SIZE={width:302,height:88};
let widgetPresentation: 'widget'|'island'='widget';
let islandAnchor:Rectangle|null=null;
let widgetDragging=false;
let dragLimit:NodeJS.Timeout|null=null;
let pendingWidgetSize:{width?:number;height:number}|null=null;
let changingWidgetBounds=false;
function setWidgetBounds(win:BrowserWindow,bounds:Rectangle){
  changingWidgetBounds=true;win.setBounds(bounds,false);changingWidgetBounds=false;
}
function updateIslandAnchor(win:BrowserWindow){const bounds=win.getBounds();islandAnchor={x:Math.round(bounds.x+(bounds.width-ISLAND_SIZE.width)/2),y:bounds.y,...ISLAND_SIZE};}
export function resizeWidget(width:number|undefined,height:number): Rectangle|null {
  const win=getWindow('widget');if(!win)return null;
  if(widgetDragging){pendingWidgetSize={width,height};return win.getBounds();}
  const bounds=win.getBounds(),island=widgetPresentation==='island';
  if(island && width===undefined)return bounds;
  if(!island && width!==undefined)return bounds;
  const nextWidth=island?Math.min(420,Math.max(180,Math.round(width??bounds.width))):bounds.width;
  const nextHeight=Math.min(620,Math.max(island?60:84,Math.round(height)));
  let next={...bounds,width:nextWidth,height:nextHeight};
  if(island){
    islandAnchor??={...bounds,...ISLAND_SIZE};
    next.x=Math.round(islandAnchor.x+(ISLAND_SIZE.width-nextWidth)/2);next.y=islandAnchor.y;
    const area=screen.getDisplayMatching(next).workArea;
    const clampedX=Math.max(area.x+8,Math.min(next.x,area.x+area.width-next.width-8));
    const clampedY=Math.max(area.y+8,Math.min(next.y,area.y+area.height-next.height-8));
    next={...next,x:clampedX,y:clampedY};
  }
  if(next.x!==bounds.x||next.y!==bounds.y||next.width!==bounds.width||next.height!==bounds.height)setWidgetBounds(win,next);
  return next;
}
export function setWidgetPresentation(island:boolean):void{
  const win=getWindow('widget');if(!win)return;const next=island?'island':'widget';if(next===widgetPresentation)return;
  endWidgetDrag();persistBounds(widgetPresentation,win);widgetPresentation=next;
  const bounds=restoreBounds(next,island?ISLAND_SIZE:{width:340,height:470});
  if(island)islandAnchor=bounds;setWidgetBounds(win,bounds);
}
export function beginWidgetDrag():void{
  const win=getWindow('widget');if(!win||widgetDragging)return;
  widgetDragging=true;
  win.webContents.send('widget:dragStarted',{});
  dragLimit=setTimeout(endWidgetDrag,60_000);
}
export function endWidgetDrag():void{
  if(dragLimit)clearTimeout(dragLimit);dragLimit=null;
  if(!widgetDragging)return;widgetDragging=false;const win=getWindow('widget');if(!win)return;
  if(widgetPresentation==='island')updateIslandAnchor(win);
  if(pendingWidgetSize){const pending=pendingWidgetSize;pendingWidgetSize=null;resizeWidget(pending.width,pending.height);}
  const bounds=win.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
  setWidgetBounds(win,{...bounds,x:Math.max(area.x+8,Math.min(bounds.x,area.x+area.width-bounds.width-8)),y:Math.max(area.y+8,Math.min(bounds.y,area.y+area.height-bounds.height-8))});
  snapToEdge(win,18);if(widgetPresentation==='island')updateIslandAnchor(win);
  win.webContents.send('widget:dragEnded',{});
}

/* ------------------------------------------------------------ 窗口创建 */

let mainWindow: BrowserWindow | null = null;
let mainRendererReady = false;
type MainNavigation = { page: string; action?: string; taskId?: string; field?: 'name' | 'urgency' | 'due' | 'all' | 'schedule'; date?:string; domain?: 'study' | 'life' };
let pendingNavigation: MainNavigation | null = null;

/** React 安装导航监听后才接收跳转，避免新开窗口时消息丢失。 */
export function markMainRendererReady(sender: BrowserWindow['webContents']): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) return false;
  mainRendererReady = true;
  if (pendingNavigation) {
    const target = pendingNavigation;
    pendingNavigation = null;
    sender.send('navigate', target);
  }
  return true;
}

export function navigateMainWindow(target: MainNavigation): BrowserWindow {
  const win = createMainWindow();
  if (mainRendererReady) win.webContents.send('navigate', target);
  else pendingNavigation = target;
  return win;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    title: 'ColDesk',
    backgroundColor: '#F5F6F8',
    icon: nativeImage.createFromBuffer(coldeskIcon(256)),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  const win = mainWindow;
  const homeContents = win.webContents;
  const homeSender = homeContents.id;
  let canClose = false;
  win.on('close', event => {
    if (!canClose && homeVault.hasDraft(homeSender)) {
      event.preventDefault();
      void flushHome(homeContents).then(ok => { if (ok && !win.isDestroyed()) { canClose = true; win.close(); } });
    }
  });
  homeContents.on('destroyed', () => { homeVault.lock(homeSender);clearHduPreview(homeSender); });
  if (process.platform === 'win32') {
    win.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: appIconPath(),
      relaunchCommand: app.isPackaged ? `"${app.getPath('exe')}"` : `"${app.getPath('exe')}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'ColDesk'
    });
  }
  mainRendererReady = false;
  pendingNavigation = null;
  windows.set('main', win);
  win.webContents.on('did-start-loading', () => { mainRendererReady = false; });
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  win.on('closed', () => {
    windows.delete('main');
    mainWindow = null;
    mainRendererReady = false;
    pendingNavigation = null;
  });
  loadWindow(win, 'main');
  return win;
}

export function createWidgetWindow(): BrowserWindow {
  const existing = getWindow('widget');
  if (existing) return existing;

  widgetPresentation=store.getSettings().desktopMode==='island'?'island':'widget';
  const size = widgetPresentation==='island'?ISLAND_SIZE:{ width: 340, height: 470 };
  const bounds = restoreBounds(widgetPresentation, size);
  if(widgetPresentation==='island')islandAnchor=bounds;
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 180,
    maxWidth: 420,
    minHeight: 60,
    maxHeight: 620,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // 注意：不要设 backgroundMaterial（acrylic / mica）。
    // 系统材质会铺满整个窗口矩形，不跟随 CSS 圆角，
    // 结果就是圆角玻璃外面露出一圈直角边框（用户反馈"丑死了"）。
    // 而且 Electron 在 Windows 上无法真正模糊窗口后面的桌面，
    // 这个材质只带来发白与直角边，收益为负，因此改用纯 CSS 玻璃。
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  windows.set('widget', win);
  loadWindow(win, 'widget');
  win.once('ready-to-show', () => win.showInactive());

  let moveTimer: NodeJS.Timeout | null = null;
  const onMoved = () => {
    if(widgetDragging||changingWidgetBounds||widgetPresentation==='island')return;
    if (moveTimer) clearTimeout(moveTimer);
    // 连续拖动时不吸附，停手后再贴边
    moveTimer = setTimeout(() => {
      moveTimer = null;
      if (!win.isDestroyed()) {if(widgetPresentation==='island')updateIslandAnchor(win);persistBounds(widgetPresentation,win);}
    }, 250);
  };
  // Windows 的原生移动开始/结束。系统直接移动窗口，软件不逐帧 setBounds。
  win.on('will-move', () => { if (!changingWidgetBounds) beginWidgetDrag(); });
  win.on('moved', () => { if (widgetDragging) endWidgetDrag(); else onMoved(); });
  let hovered: boolean | null = null;
  const hoverTimer = setInterval(() => {
    if (widgetDragging) { hovered=null;return; }
    if (win.isDestroyed() || !win.isVisible() || widgetPresentation !== 'island') return;
    const p=screen.getCursorScreenPoint(),b=win.getBounds();
    const inside=p.x>=b.x&&p.x<b.x+b.width&&p.y>=b.y&&p.y<b.y+b.height;
    if (inside!==hovered) { hovered=inside;win.webContents.send('widget:hover',{inside}); }
  },100);
  hoverTimer.unref();
  win.on('resized', () => {if(!changingWidgetBounds&&!widgetDragging&&widgetPresentation==='widget')onMoved();});
  win.on('blur',()=>endWidgetDrag());
  win.on('closed', () => {
    clearInterval(hoverTimer);if(dragLimit)clearTimeout(dragLimit);dragLimit=null;widgetDragging=false;if(moveTimer)clearTimeout(moveTimer);
    windows.delete('widget');
    widgetSnapHandler = null;
  });

  widgetSnapHandler = () => {
    if (!win.isDestroyed()) snapToEdge(win);
  };
  return win;
}

export function createDrawerWindow(): BrowserWindow {
  const existing = getWindow('drawer');
  if (existing) return existing;

  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const height = 60;
  const win = new BrowserWindow({
    width: 4,
    height,
    x: area.x + area.width - 4,
    y: area.y + Math.round(area.height / 2) - height / 2,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  windows.set('drawer', win);
  loadWindow(win, 'drawer');
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => windows.delete('drawer'));
  return win;
}

/** 抽屉展开/收起：由渲染层的热区鼠标事件驱动 */
export function setDrawerExpanded(expanded: boolean): void {
  const win = getWindow('drawer');
  if (!win) return;
  const display = screen.getDisplayMatching(win.getBounds());
  const area = display.workArea;
  const width = expanded ? 340 : 4;
  const height = expanded ? Math.min(560, area.height - 80) : 60;
  win.setBounds(
    {
      x: area.x + area.width - width,
      y: expanded ? area.y + Math.round((area.height - height) / 2) : area.y + Math.round(area.height / 2) - 30,
      width,
      height
    },
    false
  );
}

export function createToastWindow(): BrowserWindow {
  const existing = getWindow('toast');
  if (existing) return existing;

  const height = 600;
  const width = 380;
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 12,
    y: area.y + area.height - height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(false);
  windows.set('toast', win);
  loadWindow(win, 'toast');
  win.on('closed', () => windows.delete('toast'));
  return win;
}

/** 让弹窗保持贴在工作区右下角（分辨率变化时调用） */
export function repositionToastWindow(): void {
  const win = getWindow('toast');
  if (!win) return;
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = win.getBounds();
  win.setBounds({ ...bounds, x: area.x + area.width - bounds.width - 12, y: area.y + area.height - bounds.height }, false);
}

/** 供 IPC 调用：按设置调整桌面组件的显示状态 */
export function applyDesktopMode(mode: 'widget' | 'drawer' | 'both' | 'island'): void {
  const widget = getWindow('widget');
  const drawer = getWindow('drawer');

  if (mode !== 'drawer') {
    if (widget) widget.showInactive();
    else createWidgetWindow();
    setWidgetPresentation(mode==='island');
  } else if (widget) {
    widget.hide();
  }

  if (mode === 'drawer'||mode === 'both') {
    if (drawer) drawer.showInactive();
    else createDrawerWindow();
  } else if (drawer) {
    drawer.hide();
    setDrawerExpanded(false);
  }
}

/* ------------------------------------------------------------ 桌面层级 */

export type DesktopLayer = 'top' | 'normal' | 'bottom';

/**
 * 设置悬浮窗的层级。
 *
 * **关于'bottom'：这里修过一个会在运行时抛错的 bug。**
 * 原先写的是 `win.moveBottom()`，但 Electron 的 `moveBottom()` **只在 macOS 存在**
 * （类型定义里只有 `moveTop()`；Windows/Linux 上调用会抛 "not a function"）。
 * 之所以一直没暴露：类型检查从未覆盖主进程（缺 @types/node，见 package.json 注释），
 * 而测试用的是替身窗口，替身无条件提供了这个方法。
 *
 * 现在改成这个平台上真正可行的做法：
 *   · `setAlwaysOnTop(false)` —— 取消置顶，之后其它窗口激活时就能盖住它
 *   · `blur()` —— 立即让出焦点，于是它马上沉到当前活动窗口后面
 *   · 若配置为不可聚焦窗口（focusable: false），blur 无效，此时只靠上面的取消置顶；
 *     用户要去点它时窗口会正常浮起，这正是想要的行为
 *
 * 需要明确的是：**Windows 没有"把窗口永久钉在所有窗口之下"的可靠手段**，
 * 而"点击时浮到最前"与"永远置底"本身就是矛盾的。
 * 所以置底的实际语义是"不再一直压在最上面"，想恢复固定置顶可从托盘菜单改。
 *
 * `bringToFront` 用于"用户在设置页/托盘刚改完层级"的场景：
 * 此时若选的是置底，窗口会被设置窗口盖住，用户看不到任何变化，
 * 会误以为设置没生效（真实踩到过）。所以先让它现一下身，再落到目标层级。
 */
export function applyWidgetLayer(layer: DesktopLayer, options: { bringToFront?: boolean } = {}): void {
  const win = getWindow('widget');
  if (!win) return;

  if (options.bringToFront) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }

  if (layer === 'top') {
    win.setAlwaysOnTop(true, 'screen-saver');
  } else if (layer === 'normal') {
    win.setAlwaysOnTop(false);
  } else {
    win.setAlwaysOnTop(false);
    // 不可聚焦的窗口没有焦点可让，调用 blur 是安全的空操作
    if (win.isFocused()) win.blur();
  }
}

export function showWidget(show = true): void {
  const win = createWidgetWindow();
  if (show) {
    win.showInactive();
  } else {
    win.hide();
  }
}

export function toggleWidget(): void {
  const win = createWidgetWindow();
  if (win.isVisible()) win.hide();
  else win.showInactive();
}

/* ------------------------------------------------------------ 托盘与快捷键 */

export interface TrayHandlers {
  onOpenMain: () => void;
  onToggleWidget: () => void;
  onQuickAdd: () => void;
  onReplan: () => void;
  onQuit: () => void;
  autoLaunch: boolean;
  onToggleAutoLaunch: (next: boolean) => void;
  /** 当前悬浮窗层级，托盘菜单里显示勾选状态 */
  desktopLayer: DesktopLayer;
  /** 从托盘改层级：置底之后帖子可能被盖住，这里是唯一的"救回来"入口 */
  onSetDesktopLayer: (layer: DesktopLayer) => void;
}

const LAYER_LABELS: Record<DesktopLayer, string> = {
  top: '固定最前',
  normal: '普通（会被盖住）',
  bottom: '置底'
};

function trayMenuTemplate(handlers: TrayHandlers) {
  return [
    { label: t('打开 ColDesk'), click: handlers.onOpenMain },
    { label: t('显示 / 隐藏悬浮窗'), click: handlers.onToggleWidget },
    { label: t('快速添加任务'), click: handlers.onQuickAdd },
    { type: 'separator' as const },
    {
      label: t('悬浮窗层级'),
      submenu: (['top', 'normal', 'bottom'] as DesktopLayer[]).map((layer) => ({
        label: t(LAYER_LABELS[layer]),
        type: 'radio' as const,
        checked: handlers.desktopLayer === layer,
        click: () => handlers.onSetDesktopLayer(layer)
      }))
    },
    { label: t('打开日程安排'), click: handlers.onReplan },
    {
      label: t('开机自启'),
      type: 'checkbox' as const,
      checked: handlers.autoLaunch,
      click: (item: { checked: boolean }) => handlers.onToggleAutoLaunch(item.checked)
    },
    { type: 'separator' as const },
    { label: t('退出'), click: handlers.onQuit }
  ];
}

export function createTray(handlers: TrayHandlers): Tray {
  // Tray 只接受文件路径或 NativeImage；coldeskIcon 返回的是 PNG Buffer，必须先转成 NativeImage
  const image = nativeImage.createFromBuffer(coldeskIcon(32));
  tray = new Tray(image);
  tray.setToolTip('ColDesk · 今天要做什么');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(handlers)));
  tray.on('click', handlers.onOpenMain);
  tray.on('double-click', handlers.onOpenMain);
  return tray;
}

export function updateTrayMenu(handlers: TrayHandlers): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(handlers)));
}

export function registerShortcuts(handlers: {
  onQuickAdd: () => void;
  onToggleWidget: () => void;
  onPasteParse?: () => void;
}): void {
  globalShortcut.register('CommandOrControl+Alt+T', handlers.onQuickAdd);
  globalShortcut.register('CommandOrControl+Alt+D', handlers.onToggleWidget);
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}

export function applyAutoLaunch(enabled: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: [] });
}

export function getAutoLaunch(): boolean {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
  return app.getLoginItemSettings().openAtLogin;
}

export function initPlacements(file: string): void {
  loadPlacements(file);
}

export function initWindows(preload: string): void {
  preloadFile = preload;
}

export function buildPreloadPath(): string {
  return resolvePreload();
}

export { snapToEdge };

/** 更新当前窗口、托盘和图标订阅；图片本身不进入定时状态广播。 */
export function applyPersonalizedIcon() {
  const image=nativeImage.createFromBuffer(coldeskIcon(256));
  for(const win of windows.values()) {
    if(win.isDestroyed())continue;
    win.setIcon(image);
    if(win===mainWindow&&process.platform==='win32')win.setAppDetails({appId:APP_USER_MODEL_ID,appIconPath:appIconPath(),appIconIndex:0});
    win.webContents.send('appearance:iconChanged',readIconChoice());
  }
  tray?.setImage(nativeImage.createFromBuffer(coldeskIcon(32)));
  return updateIconShortcuts(appIconPath());
}
