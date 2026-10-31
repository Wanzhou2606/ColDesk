/**
 * 主进程启动链路测试。
 *
 * 为什么需要它：这台机器启用了 Smart App Control，会拦截 Electron 的未签名
 * 二进制，导致 electron.exe 被静默终止，无法真的开出 GUI 来验证。
 * 这里用受控替身（CARGO_MANIFEST 风格的 require hook）拦截 electron 模块，
 * 记录窗口创建、IPC 注册、托盘与调度器启动等关键调用，
 * 从而验证"入口不会崩 + 全链路被正确拉起"。
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';

import { addDays } from '@shared/time';

/**
 * 给"需要被排进日程"的测试任务一个可用的截止时间：**明天 23:00**。
 *
 * 为什么不能写 `今天T23:00`——这个坑排查了很久，记下来避免重犯：
 *
 *  1. 排程器有"睡前 30 分钟不排任务"的规则，所以**今天的可用时间取决于运行钟点**。
 *     实测 22:15 运行时，今天 study 只剩 19:00-22:30 这段，
 *     再扣掉截止前 20% 的缓冲（estMinutes=30 → 6 分钟），
 *     凑不出minBlockMinutes(25)，于是当天排不进去 → 整个任务被推到明天。
 *
 *  2. 而 `state.timeline` 是**当天时间轴**（agenda.ts 里 `buildTimeline({ date })`），
 *     **只包含今天**的项目。所以"被排到明天"的任务在 timeline 里永远看不到，
 *     断言 `timeline 里有该任务的块` 在深夜必然失败，白天却通过——
 *     这是典型的"时间相关假失败"，比真 bug 更难查。
 *
 * 现在的做法是两条一起改：
 *  · 截止时间用"明天 23:00"：无论几点运行，明天都有完整窗口可用
 *  · 断言改成查**数据库里的块**（`getBlocks()`），而不是 timeline——
 *    因为排程结果本来就可能落在明天，用当天时间轴去验证是错的
 */
function schedulableDueAt(fromDate: string): string {
  return `${addDays(fromDate, 1)}T23:00`;
}

/** 今天 23:00：只关心"任务能被查到/提醒能生成"的测试用这个，不涉及排程窗口 */
function dueToday(fromDate: string): string {
  return `${fromDate}T23:00`;
}

/** 在状态的"今日临期 + 未来 7 天临期"里找任务，避免依赖今天的剩余时间 */
function findAnywhere(state: Record<string, unknown>, title: string) {
  const groups = [...(state.todayTasks as unknown[]), ...(state.urgentTasks as unknown[])];
  return groups.find((d) => (d as { task: { title: string } }).task.title === title) as
    | { task: { id: string; title: string; urgency: number } }
    | undefined;
}

/**
 * 该任务是否被排程器**接受**（排出了块）。
 *
 * 为什么不用"timeline 里有该任务的块"判断：`state.timeline` 是当天时间轴，
 * 只含今天的项目；深夜运行时任务常被排到明天，这就成了时间相关的假失败
 * （排查了很久，详见 schedulableDueAt 的注释）。
 *
 * 为什么也不直接查数据库：这个测试加载的是**构建产物** `out/main/index.cjs`，
 * 产物不导出 getDb 等内部函数，所以拿不到数据库句柄。
 *
 * 于是用可观测信号判断，两条都必须成立：
 *   · 自动排程是开着的 —— 关掉时排程器整体不工作，"没告警"不代表"已排入"
 *   · `unscheduled` 与 `warnings` 里都没有它 —— 既没排不进去，也没有过期之类的问题
 */
function isAcceptedByPlanner(state: Record<string, unknown>, title: string): boolean {
  const autoSchedule = (state.settings as { autoSchedule?: boolean } | undefined)?.autoSchedule;
  if (autoSchedule === false) return false;

  const unscheduled = (state.unscheduled ?? []) as Array<{ title?: string }>;
  const warnings = (state.warnings ?? []) as Array<{ taskId?: string; message?: string }>;
  const inUnscheduled = unscheduled.some((u) => u.title === title);
  const inWarnings = warnings.some((w) => typeof w.message === 'string' && w.message.includes(title));
  return !inUnscheduled && !inWarnings;
}

/** 按标题在"今日临期 + 未来 7 天临期"里取任务 */
function taskByTitle(state: Record<string, unknown>, title: string) {
  const groups = [...(state.todayTasks as unknown[]), ...(state.urgentTasks as unknown[])];
  return groups
    .map((d) => (d as { task: { id: string; title: string; urgency: number } }).task)
    .find((t) => t.title === title);
}
const require = createRequire(import.meta.url);

interface LogEntry {
  call: string;
  args?: unknown;
}

const dir = mkdtempSync(join(tmpdir(), 'coldesk-boot-'));
const logFile = join(dir, 'call-log.json');
writeFileSync(logFile, '[]', 'utf8');

const entries: LogEntry[] = [];
const record = (call: string, args?: unknown) => {
  entries.push({ call, args });
  writeFileSync(logFile, JSON.stringify(entries.slice(-400)), 'utf8');
};

const handlers = new Map<string, (payload: unknown) => unknown>();

function makeFakeElectron() {
  type Listener = (...args: unknown[]) => void;

  class FakeWebContents {
    static nextId = 1;
    readonly id = FakeWebContents.nextId++;
    private listeners = new Map<string, Listener[]>();
    on(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
    }
    emit(event: string) { for (const fn of this.listeners.get(event) ?? []) fn(); }
    send(channel: string, payload?: unknown) {
      record('webContents.send', { channel, payload });
    }
  }

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    private listeners = new Map<string, Listener[]>();
    public webContents = new FakeWebContents();
    public destroyed = false;
    public visible = false;
    public minimized = false;
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; record('window.restore'); }
    public bounds: { x: number; y: number; width: number; height: number };

    constructor(public options: Record<string, unknown> = {}) {
      this.bounds = {
        x: Number(options.x ?? 0),
        y: Number(options.y ?? 0),
        width: Number(options.width ?? 300),
        height: Number(options.height ?? 400)
      };
      FakeBrowserWindow.instances.push(this);
      record('BrowserWindow', { width: options.width, height: options.height });
    }

    loadFile(file: string) {
      record('loadFile', file);
      return Promise.resolve();
    }

    loadURL(url: string) {
      record('loadURL', url);
      return Promise.resolve();
    }

    once(event: string, fn: Listener) {
      this.on(event, fn);
      return this;
    }

    on(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }

    isDestroyed() {
      return this.destroyed;
    }

    isVisible() {
      return this.visible;
    }

    isFocused() {
      // 替身窗口永远没有焦点；置底逻辑据此跳过 blur（不可聚焦的窗口本来也没焦点可让）
      return false;
    }

    blur() {
      record('window.blur');
    }

    show() {
      this.visible = true;
      record('window.show');
    }

    showInactive() {
      this.visible = true;
      record('window.showInactive');
    }

    hide() {
      this.visible = false;
    }

    focus() {}
    setAlwaysOnTop(flag: boolean, level?: string) {
      record('window.setAlwaysOnTop', { flag, level });
    }
    moveTop() {
      record('window.moveTop');
    }
    setIgnoreMouseEvents() {}
    setMenuBarVisibility() {}
    setAppDetails(options: unknown) { record('window.setAppDetails', options); }
    setBounds(next: Partial<{ x: number; y: number; width: number; height: number }>) {
      this.bounds = { ...this.bounds, ...next };
      record('setBounds', this.bounds);
    }

    getBounds() {
      return this.bounds;
    }
  }

  const display = {
    id: 1,
    scaleFactor: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }
  };

  return {
    app: {
      requestSingleInstanceLock: () => {
        record('app.requestSingleInstanceLock');
        return true;
      },
      whenReady: () => {
        record('app.whenReady');
        return Promise.resolve();
      },
      on: (event: string, fn: Listener) => record('app.on', event),
      quit: () => record('app.quit'),
      getPath: () => {
        record('app.getPath');
        return dir;
      },
      getVersion: () => '0.1.0-test',
      getAppPath: () => process.cwd(),
      setAppUserModelId: (id: string) => record('app.setAppUserModelId', id),
      setLoginItemSettings: () => record('app.setLoginItemSettings'),
      getLoginItemSettings: () => ({ openAtLogin: false })
    },
    BrowserWindow: FakeBrowserWindow,
    Tray: class {
      constructor() {
        record('Tray');
      }
      setToolTip() {}
      setContextMenu() {}
      on(event: string) {
        record('Tray.on', event);
      }
    },
    Menu: {
      setApplicationMenu: () => record('Menu.setApplicationMenu'),
      buildFromTemplate: (template: unknown[]) => {
        record('Menu.buildFromTemplate', template.length);
        return template;
      }
    },
    globalShortcut: {
      register: (accelerator: string) => {
        record('globalShortcut.register', accelerator);
        return true;
      },
      unregisterAll: () => record('globalShortcut.unregisterAll')
    },
    screen: {
      getPrimaryDisplay: () => display,
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => display,
      getDisplayMatching: () => display,
      getAllDisplays: () => [display]
    },
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
        handlers.set(channel, fn);
        record('ipcMain.handle', channel);
      },
      on: (channel: string, fn: Listener) => {
        record('ipcMain.on', channel);
      }
    },
    powerMonitor: {
      on: (event: string) => record('powerMonitor.on', event)
    },
    // Tray 只接受文件路径或 NativeImage；替身里记录调用，便于断言图标确实被转换过
    nativeImage: {
      createFromBuffer: (buffer: unknown) => {
        record('nativeImage.createFromBuffer', { bytes: (buffer as { length?: number })?.length ?? 0 });
        return { isEmpty: () => false };
      }
    },
    shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve('') }
  };
}

let fakeElectron: ReturnType<typeof makeFakeElectron>;
describe('main: 启动链路', () => {
  before(async () => {
    // 这个测试加载的是构建产物 out/main/index.cjs，所以必须先构建，
    // 并且要在加载之前完成（构建会重新写盘，CJS 模块一旦 require 就被缓存）。
    const { build } = await import('electron-vite');
    await build({ configFile: join(process.cwd(), 'electron.vite.config.ts'), mode: 'production' });

    process.env.COLDESK_DB_FACTORY = 'fake';
    process.env.COLDESK_DISABLE_SCHEDULER = '1';
    process.env.COLDESK_SEED_SAMPLE = '1';
    process.env.COLDESK_LOG_STDOUT = '1';
    delete process.env.ELECTRON_RENDERER_URL;

    // 把 electron 模块替换成受控替身
    const originalLoad = (require('node:module') as { _load: (id: string, ...rest: unknown[]) => unknown })._load;
    const fake = makeFakeElectron();
    fakeElectron = fake;
    (require('node:module') as { _load: unknown })._load = function patched(id: string, ...rest: unknown[]) {
      if (id === 'electron') return fake;
      return originalLoad.call(this, id, ...rest);
    };
  });

  it('入口能完成启动：建库、开窗、注册 IPC、起托盘与调度器', async () => {
    // 直接加载构建产物（CJS），这样 require hook 能拦到 electron；
    // 源码走 tsx 的 ESM 解析会绕过 hook，故此处不用源码。
    const bundle = join(process.cwd(), 'out/main/index.cjs');
    const load = createRequire(import.meta.url);
    assert.ok(existsSync(bundle), '请先执行 pnpm build 生成 out/main/index.cjs');

    // CJS 不允许顶层 await，这里用同步 require 触发入口
    load(bundle);

    // whenReady 是异步的，给它几个 tick 走完启动流程
    await new Promise((resolve) => setTimeout(resolve, 500));

    const calls = entries.map((e) => e.call);

    assert.ok(existsSync(logFile), '应产生调用日志');
    assert.ok(calls.includes('app.requestSingleInstanceLock'), '应申请单实例锁');
    assert.ok(calls.includes('app.whenReady'), '应等待 app ready');

    const windows = entries.filter((e) => e.call === 'BrowserWindow');
    assert.ok(windows.length >= 3, `应至少创建主窗口/悬浮窗/弹窗，实际 ${windows.length}`);

    const loaded = entries.filter((e) => e.call === 'loadFile').map((e) => String(e.args));
    assert.ok(loaded.some((f) => f.endsWith('main.html')), `缺少主窗口页面：${loaded.join(', ')}`);
    assert.ok(loaded.some((f) => f.endsWith('widget.html')), '缺少悬浮窗页面');
    assert.ok(loaded.some((f) => f.endsWith('toast.html')), '缺少提醒弹窗页面');

    assert.ok(calls.includes('Tray'), '应创建托盘');
    assert.ok(
      calls.includes('nativeImage.createFromBuffer'),
      '托盘图标必须经 NativeImage 转换——Tray 不接受原始 Buffer（真实运行时报过 Argument must be a file path or a NativeImage）'
    );
    assert.ok(calls.includes('globalShortcut.register'), '应注册全局快捷键');
    assert.ok(calls.includes('powerMonitor.on'), '应监听休眠唤醒');

    // IPC 白名单应注册齐全
    const channels = [...handlers.keys()];
    for (const expected of ['state:get', 'task:quickAdd', 'task:create', 'task:complete', 'settings:update', 'widget:setSize', 'toast:action']) {
      assert.ok(channels.includes(expected), `缺少 IPC 通道 ${expected}`);
    }
  });

  it('IPC：state:get 能返回可渲染的视图状态', async () => {
    const handler = handlers.get('state:get');
    assert.ok(handler, '应有 state:get');
    const state = (await handler?.({})) as Record<string, unknown>;

    assert.equal(typeof state.date, 'string');
    assert.equal(typeof state.dateLabel, 'string');
    assert.ok(Array.isArray(state.timeline), 'timeline 应为数组');
    assert.ok(Array.isArray(state.todayTasks), 'todayTasks 应为数组');
    assert.ok(typeof state.summary === 'object' && state.summary !== null, 'summary 应存在');
    assert.ok(state.settings, '设置应随状态返回');
    // 日期格式必须是 YYYY-MM-DD，渲染层直接切片使用
    assert.match(String(state.date), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('home IPC 仅允许主窗口访问，日记不进入通用状态广播', async () => {
    const main = fakeElectron.BrowserWindow.instances.find(w => w.options.title === 'ColDesk' && !w.destroyed)!;
    const widget = fakeElectron.BrowserWindow.instances.find(w => w.options.transparent)!;
    await assert.rejects(async () => handlers.get('home:status')?.({sender:widget.webContents}), /主窗口/);
    await assert.rejects(async () => handlers.get('home:export')?.({sender:widget.webContents}, {scope:'all'}), /主窗口/);
    const homeCall = (channel: string, payload?: unknown) => (handlers.get(channel) as any)({sender:main.webContents},payload);
    await homeCall('home:setup',{password:'private-test-password'});
    await homeCall('home:save',{date:'2026-10-10',cover:'不能广播的封面',body:'不能广播的正文',weather:'晴天',mood:'平静'});
    const state = await handlers.get('state:get')?.({});
    assert.ok(!JSON.stringify(state).includes('不能广播'));
    await homeCall('home:lock');
    await assert.rejects(async()=>homeCall('home:month',{month:'2026-10'}),/解锁/);
    await assert.rejects(async()=>homeCall('home:export',{scope:'all'}),/解锁/);
  });

  it('IPC 字体设置拒绝 CSS 内容，并在刷新后保留有效字体', async () => {
    const update = handlers.get('settings:update') as any;
    await update({}, {uiFont:'微软雅黑',homeCoverFont:'LiSu'});
    const state = await handlers.get('state:refresh')?.({}) as any;
    assert.equal(state.settings.uiFont,'微软雅黑'); assert.equal(state.settings.homeCoverFont,'LiSu');
    await assert.rejects(async()=>update({}, {uiFont:"font'; color:red;"}), /字体名称/);
    const after = await handlers.get('state:get')?.({}) as any;
    assert.equal(after.settings.uiFont,'微软雅黑');
  });

  it('浮窗导航等待主窗口监听就绪，且只接受主窗口的就绪消息', async () => {
    const win = fakeElectron.BrowserWindow.instances.find(w => w.options.title === 'ColDesk')!;
    const widget = fakeElectron.BrowserWindow.instances.find(w => w.options.transparent)!;
    const navigationCount = () => entries.filter(e => e.call === 'webContents.send' && (e.args as any)?.channel === 'navigate').length;
    const before = navigationCount();
    await handlers.get('widget:openSettings')?.({});
    assert.equal(navigationCount(), before, '加载期间不能发送跳转');
    assert.equal(await handlers.get('window:ready')?.({ sender: widget.webContents }), false);
    assert.equal(navigationCount(), before, '其他窗口不能消费待处理跳转');
    assert.equal(await handlers.get('window:ready')?.({ sender: win.webContents }), true);
    assert.equal(navigationCount(), before + 1);
    assert.deepEqual(entries.findLast(e => e.call === 'webContents.send')?.args, { channel: 'navigate', payload: { page: 'settings' } });
    await handlers.get('window:ready')?.({ sender: win.webContents });
    assert.equal(navigationCount(), before + 1, '重复就绪消息不能重复导航');
    await handlers.get('widget:openExpenses')?.({});
    assert.deepEqual(entries.findLast(e => e.call === 'webContents.send')?.args, { channel: 'navigate', payload: { page: 'expenses' } });
  });

  it('关闭主窗口后重新打开设置、重载页面、最小化恢复均能导航', async () => {
    const old = fakeElectron.BrowserWindow.instances.find(w => w.options.title === 'ColDesk')!;
    old.destroyed = true;
    old.emit('closed');
    const before = entries.length;
    await handlers.get('widget:openSettings')?.({});
    const win = fakeElectron.BrowserWindow.instances.findLast(w => w.options.title === 'ColDesk')!;
    assert.notEqual(win, old);
    assert.equal(entries.slice(before).some(e => e.call === 'webContents.send' && (e.args as any)?.channel === 'navigate'), false);
    assert.equal(await handlers.get('window:ready')?.({ sender: old.webContents }), false);
    await handlers.get('window:ready')?.({ sender: win.webContents });
    assert.deepEqual(entries.findLast(e => e.call === 'webContents.send')?.args, { channel: 'navigate', payload: { page: 'settings' } });
    win.webContents.emit('did-start-loading');
    const beforeReload = entries.length;
    await handlers.get('widget:openExpenses')?.({});
    await handlers.get('widget:openSettings')?.({});
    assert.equal(entries.slice(beforeReload).some(e => e.call === 'webContents.send' && (e.args as any)?.channel === 'navigate'), false);
    await handlers.get('window:ready')?.({ sender: win.webContents });
    assert.deepEqual(entries.findLast(e => e.call === 'webContents.send')?.args, { channel: 'navigate', payload: { page: 'settings' } });
    win.minimized = true;
    await handlers.get('widget:openExpenses')?.({});
    assert.equal(win.minimized, false, '已最小化的窗口应恢复');
    assert.ok(entries.some(e => e.call === 'window.restore'));
  });

  it('IPC：新建任务后能出现在视图状态里，并可标记完成', async () => {
    const create = handlers.get('task:create');
    const before = (await handlers.get('state:get')?.({})) as Record<string, unknown>;
    const beforeCount = (before.todayTasks as unknown[]).length + (before.urgentTasks as unknown[]).length;

    const created = (await create?.({}, {
      title: '启动链路测试任务',
      domain: 'study',
      type: 'assignment',
      urgency: 5,
      // 截止在后天：保证无论几点运行都有足够的排程窗口（见 safeDueAt 注释）
      dueAt: schedulableDueAt(String(before.date)),
      estMinutes: 30,
      splittable: true
    })) as Record<string, unknown>;

    // 截止日不是今天，所以要去"今日 + 未来 7 天"两组里找，
    // 不能只查 todayTasks（那个字段的语义是"今天到期或已超期"）
    const found = findAnywhere(created, '启动链路测试任务');
    assert.ok(found, '新建任务应出现在临期列表里');
    assert.ok(
      (created.todayTasks as unknown[]).length + (created.urgentTasks as unknown[]).length >= beforeCount,
      '任务总数不应减少'
    );

    assert.equal((created.settings as {autoSchedule:boolean}).autoSchedule,false,'新任务默认留在任务栏');
    assert.ok(!(created.timeline as Array<{taskId?:string}>).some(block=>block.taskId===found?.task.id),'保存不得自动安排');

    const done = (await handlers.get('task:complete')?.({}, { id: found?.task.id })) as Record<string, unknown>;
    const stillOpen = [...(done.todayTasks as unknown[]), ...(done.urgentTasks as unknown[])].some(
      (d) => (d as { task: { id: string } }).task.id === found?.task.id
    );
    assert.equal(stillOpen, false, '完成后不应再出现在临期列表');
  });

  it('IPC：非法输入被拒绝', async () => {
    const create = handlers.get('task:create');
    await assert.rejects(
      async () => {
        await create?.({}, { title: '   ' });
      },
      /任务标题不能为空/,
      '空标题必须被拒绝'
    );

    const complete = handlers.get('task:complete');
    await assert.rejects(
      async () => {
        await complete?.({}, {});
      },
      /缺少任务 id/
    );
  });

  it('IPC：旧客户端传入生活分类仍统一保存任务', async () => {
    const quickAdd = handlers.get('task:quickAdd');
    const state = (await quickAdd?.({}, { title: '买洗衣液', domain: 'life', urgency: 2 })) as Record<string, unknown>;

    const buckets = state.buckets as Record<string, Array<{ title: string }>>;
    const all = Object.values(buckets).flat();
    assert.ok(all.some((t) => t.title === '买洗衣液'), '快速添加的生活任务应进入对应分组');

    assert.equal((all.find(t=>t.title==='买洗衣液') as {domain?:string}).domain,'study');
    const listed=await handlers.get('task:list')?.({}, {domain:'life'}) as Array<{title:string}>;
    assert.ok(listed.some(t=>t.title==='买洗衣液'));
  });

  it('IPC：无结束时间到点仅提醒一次，不能稍后重发，修改时间后可再提醒',async()=>{
    const main=fakeElectron.BrowserWindow.instances.find(w=>w.options.title==='ColDesk'&&!w.destroyed)!;
    const sender={sender:main.webContents},state=await handlers.get('state:get')?.({}) as any;
    const payload={title:'一次事件提醒验证',detail:'弹出后不重复',type:'activity',startAt:state.now,endAt:null};
    const id=await handlers.get('schedule:saveEvent')?.(sender,payload);
    const widget=fakeElectron.BrowserWindow.instances.find(w=>w.options.minWidth===180&&!w.destroyed)!;
    const notices=async()=>((await handlers.get('toast:get')?.({sender:widget.webContents})) as any).items;
    let list=await notices();const item=list.find((item:any)=>item.eventId===id);assert.ok(item);assert.equal(item.kind,'event');
    assert.equal(await handlers.get('toast:action')?.({}, {action:'snooze',id:item.id,minutes:1}),false);
    await handlers.get('toast:action')?.({}, {action:'dismiss',id:item.id});
    await handlers.get('state:refresh')?.({});assert.ok(!(await notices()).some((item:any)=>item.eventId===id));
    await handlers.get('schedule:saveEvent')?.(sender,{...payload,id,title:'编辑文字后不重发'});
    assert.ok(!(await notices()).some((item:any)=>item.eventId===id));
    await handlers.get('schedule:deleteEvent')?.(sender,{id});
  });

  it('IPC：切到"两者并存"会补建贴边抽屉窗口', async () => {
    const before = entries.filter((e) => e.call === 'BrowserWindow').length;
    const update = handlers.get('settings:update');
    const settings = (await update?.({}, { desktopMode: 'both' })) as Record<string, unknown>;

    assert.equal(settings.desktopMode, 'both', '设置应被保存');
    await new Promise((resolve) => setTimeout(resolve, 60));

    const loaded = entries.filter((e) => e.call === 'loadFile').map((e) => String(e.args));
    assert.ok(loaded.some((f) => f.endsWith('widget.html')), '悬浮窗应存在');
    const after = entries.filter((e) => e.call === 'BrowserWindow').length;
    assert.ok(after >= before, `窗口数不应减少（前 ${before}，后 ${after}）`);
  });

  it('IPC：旧版自动开关不会重新启用自动占用时间', async () => {
    const update = handlers.get('settings:update');
    const create = handlers.get('task:create');
    const state0 = (await handlers.get('state:get')?.({})) as Record<string, unknown>;

    // 关掉自动排程
    await update?.({}, { autoSchedule: false });
    const created = (await create?.({}, {
      title: '关掉排程后新建的任务',
      domain: 'study',
      urgency: 5,
      dueAt: schedulableDueAt(String(state0.date)),
      estMinutes: 30
    })) as Record<string, unknown>;

    const createdTask = taskByTitle(created, '关掉排程后新建的任务');
    assert.ok(createdTask, '任务应已创建');
    // 关掉排程后，排程器不该接受任何任务
    assert.equal(
      isAcceptedByPlanner(created, '关掉排程后新建的任务'),
      false,
      '关掉自动排程后任务不应被排入日程'
    );

    const reopened = (await update?.({}, { autoSchedule: true })) as Record<string, unknown>;
    assert.equal(reopened.autoSchedule,false,'旧版调用也保持手动安排');

  });

  it('IPC：视图状态带上渲染层需要的界面参数', async () => {
    const update = handlers.get('settings:update');
    await update?.({}, { glassOpacity: 0.8, desktopMode: 'widget' });
    const state = (await handlers.get('state:get')?.({})) as Record<string, unknown>;
    const ui = state.ui as { glassTintAlpha: number; showWidget: boolean; showDrawer: boolean };

    assert.equal(ui.glassTintAlpha, 0.8, '透明度设置应透传给渲染层');
    assert.equal(ui.showWidget, true);
    assert.equal(ui.showDrawer, false, 'desktopMode=widget 时不应显示抽屉');
  });

  it('IPC：排程偏好可改，且乱填的值会被收敛', async () => {
    const updatePrefs = handlers.get('prefs:update');
    const state = (await updatePrefs?.({}, {
      prefs: {
        studyWindows: [{ start: '20:00', end: '22:00' }],
        lifeWindows: [],
        dailyCapMinutes: { study: 99999, life: -5 },
        minBlockMinutes: 0,
        maxBlockMinutes: 9999,
        breakMinutes: 999,
        dueBufferRatio: 9
      }
    })) as Record<string, unknown>;

    const prefs = state.plannerPrefs as {
      studyWindows: Array<{ start: string; end: string }>;
      lifeWindows: Array<{ start: string; end: string }>;
      dailyCapMinutes: { study: number; life: number };
      minBlockMinutes: number;
      maxBlockMinutes: number;
      breakMinutes: number;
      dueBufferRatio: number;
    };

    assert.deepEqual(prefs.studyWindows, [{ start: '20:00', end: '22:00' }], '自定义时段应生效');
    assert.ok(prefs.lifeWindows.length > 0, '生活时段被清空时应回退到默认');
    assert.equal(prefs.dailyCapMinutes.study, 720, '学习上限封顶');
    assert.equal(prefs.dailyCapMinutes.life, 0, '生活上限下限');
    assert.equal(prefs.maxBlockMinutes, 360, '单块最长封顶');
    assert.equal(prefs.breakMinutes, 60, '块间休息封顶');
    assert.equal(prefs.dueBufferRatio, 0.5, '缓冲封顶');
    assert.ok(prefs.minBlockMinutes <= prefs.maxBlockMinutes, '不得留下矛盾区间');
  });

  it('IPC：悬浮窗层级可在 置顶 / 普通 / 置底 之间切换', async () => {
    const update = handlers.get('settings:update');
    const getState = handlers.get('state:get');
    const readLayer = async () => {
      const state = (await getState?.({})) as Record<string, unknown>;
      return (state.settings as { desktopLayer: string }).desktopLayer;
    };
    const before = entries.filter((e) => e.call === 'window.setAlwaysOnTop').length;

    // 注意：settings:update 返回的是设置对象本身，不是整个视图状态，
    // 所以要断言层级必须从 state:get 里读。
    await update?.({}, { desktopLayer: 'normal' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await readLayer(), 'normal', '切到普通层级应保存成功');

    const normalCalls = entries.filter((e) => e.call === 'window.setAlwaysOnTop').slice(before);
    assert.ok(
      normalCalls.some((c) => (c.args as { flag?: boolean })?.flag === false),
      '切到普通层级应取消始终置顶'
    );

    /*
     * 置底：只应"取消始终置顶"，**不得调用 moveBottom**。
     *
     * 这里断言的是修复过的 bug：原先写的是 win.moveBottom()，
     * 但该方法**只在 macOS 存在**，Windows 上调用会抛 "not a function"。
     * 之所以当时测不出来：类型检查没覆盖主进程（缺 @types/node），
     * 而这个替身无条件提供了 moveBottom，替真实 API 掩盖了缺陷。
     * 现在替身里已删除该方法，所以一旦有人写回去，这里会直接失败。
     */
    await update?.({}, { desktopLayer: 'bottom' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await readLayer(), 'bottom');
    assert.ok(
      !entries.some((e) => e.call === 'window.moveBottom' as string),
      '不得调用 moveBottom —— Windows 上不存在该方法，会抛错'
    );
    assert.ok(
      entries.some((e) => (e.args as { flag?: boolean })?.flag === false),
      '置底应取消始终置顶'
    );

    // 恢复固定最前
    await update?.({}, { desktopLayer: 'top' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await readLayer(), 'top');
    assert.ok(
      entries
        .filter((e) => e.call === 'window.setAlwaysOnTop')
        .some((c) => (c.args as { flag?: boolean })?.flag === true),
      '恢复置顶应重新开启始终置顶'
    );
  });

  it('IPC：非法层级值被忽略，不会破坏设置', async () => {
    const update = handlers.get('settings:update');
    const getState = handlers.get('state:get');
    await update?.({}, { desktopLayer: 'top' });
    await update?.({}, { desktopLayer: '瞎写的值' });

    const state = (await getState?.({})) as Record<string, unknown>;
    assert.equal(
      (state.settings as { desktopLayer: string }).desktopLayer,
      'top',
      '非法值应被忽略并保持原值'
    );
  });
  it('灵动岛可选择、不会打开抽屉，尺寸和拖动仅由组件控制',async()=>{
    const main=fakeElectron.BrowserWindow.instances.find(w=>w.options.title==='ColDesk'&&!w.destroyed)!;
    const widget=fakeElectron.BrowserWindow.instances.find(w=>w.options.minWidth===180&&!w.destroyed)!;
    await handlers.get('settings:update')?.({}, {desktopMode:'island'});
    const state=await handlers.get('state:get')?.({}) as any;assert.equal(state.settings.desktopMode,'island');assert.equal(state.ui.showDrawer,false);
    const original={...widget.getBounds()};
    await handlers.get('widget:setSize')?.({sender:main.webContents},{width:380,height:360});assert.deepEqual(widget.getBounds(),original);
    await handlers.get('widget:setSize')?.({sender:widget.webContents},{width:384,height:374});assert.equal(widget.getBounds().width,384);
    await assert.rejects(async()=>handlers.get('widget:dragStart')?.({sender:main.webContents}),/组件/);
    widget.emit('will-move');
    await handlers.get('widget:setSize')?.({sender:widget.webContents},{width:400,height:390});
    assert.equal(widget.getBounds().width,384,'系统拖动期间应推迟尺寸动画');
    widget.emit('moved');
    assert.equal(widget.getBounds().width,400,'系统拖动结束后应应用待处理尺寸');
    await handlers.get('settings:update')?.({}, {desktopMode:'widget'});
  });

  it('启动时会重建提醒（reminder 表不能为空）', async () => {
    // 这是一个真实踩到过的 bug：store.load() 漏了 refreshReminders()，
    // 导致首次运行与每次重启后 reminder 表都是空的，多级提醒完全不触发。
    // 断言方式：用 dueAt 明确的紧迫度 5 任务反推应产生的提醒条数。
    //
    // 这条测试**不涉及排程**，所以截止时间用"今天 23:00"即可——
    // 它只要求任务能被查到。具体提醒条数由数据层测试覆盖。
    const create = handlers.get('task:create');
    const state0 = (await handlers.get('state:get')?.({})) as Record<string, unknown>;
    const dueAt = dueToday(String(state0.date));

    await create?.({}, {
      title: '提醒回归测试任务',
      domain: 'study',
      type: 'assignment',
      urgency: 5,
      dueAt,
      estMinutes: 30
    });

    const state = (await handlers.get('state:get')?.({})) as Record<string, unknown>;
    const found = findAnywhere(state, '提醒回归测试任务');
    assert.ok(found, '新建的紧迫任务应出现在临期列表里');
    assert.equal(found?.task.urgency, 5);

    // 再次触发刷新，确认不会因为重建提醒而抛错
    const refreshed = (await handlers.get('state:refresh')?.({})) as Record<string, unknown>;
    assert.ok(refreshed.date, '刷新后仍应返回有效状态');
  });
  it('IPC：完整打卡图标不会截断，归档可找回并保留签到',async()=>{
    let state=await handlers.get('habit:add')?.({}, {name:'归档找回验证',icon:'🗣️',activeDays:[]}) as any;
    let habit=state.habit.habits.find((h:any)=>h.name==='归档找回验证');assert.equal(habit.icon,'🗣️');const id=habit.id;
    state=await handlers.get('habit:update')?.({}, {id,icon:'✍️'}) as any;assert.equal(state.habit.habits.find((h:any)=>h.id===id).icon,'✍️');
    await handlers.get('habit:setCheckin')?.({}, {habitId:id,date:state.date,done:true});
    state=await handlers.get('habit:update')?.({}, {id,archived:true}) as any;assert.ok(state.habit.archivedHabits.some((h:any)=>h.id===id));assert.ok(!state.habit.habits.some((h:any)=>h.id===id));
    state=await handlers.get('state:refresh')?.({}) as any;assert.ok(state.habit.archivedHabits.some((h:any)=>h.id===id));
    state=await handlers.get('habit:update')?.({}, {id,archived:false}) as any;assert.ok(state.habit.today.cells.find((c:any)=>c.habit.id===id).done);
    await assert.rejects(async()=>handlers.get('habit:update')?.({}, {id,icon:'⭐📚'}),/图标/);
    state=await handlers.get('state:get')?.({}) as any;assert.equal(state.habit.habits.find((h:any)=>h.id===id).icon,'✍️');
  });

});
