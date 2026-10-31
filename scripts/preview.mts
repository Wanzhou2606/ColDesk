/**
 * 导出界面静态预览（不依赖 Electron）。
 *
 * 用途：本机 Smart App Control 会拦截未签名的 electron.exe，导致无法开 GUI 截图。
 * 这里直接复用渲染层的组件与已构建的 CSS，渲染成自包含 HTML，
 * 用浏览器打开即可核对悬浮窗、提醒弹窗、周视图与主窗口的真实样貌与文案。
 *
 * 用法：pnpm preview
 * 产物：preview/index.html、widget.html、toast.html、week.html、app.html
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = process.cwd();
const outDir = join(root, 'preview');
mkdirSync(outDir, { recursive: true });
copyFileSync(join(root, 'src/renderer/public/app-icon.png'), join(outDir, 'app-icon.png'));

const { WidgetView } = await import('../src/renderer/src/windows/WidgetView.tsx');
const { ToastStackView } = await import('../src/renderer/src/windows/ToastView.tsx');
const { WeekView } = await import('../src/renderer/src/pages/WeekView.tsx');
const { fakeView, fromNow } = await import('../src/renderer/__tests__/fixtures.ts');
const { buildFixtureState } = await import('./fixture-state.mts');

/** 真实数据层构造的状态：课程、任务、编排块都来自与 pnpm dev 相同的那套种子数据 */
const realState = await buildFixtureState();

/* ---------------------------------------------------- 复用构建出的玻璃样式 */

function readBuiltCss(): string {
  const assetsDir = join(root, 'out/renderer/assets');
  if (!existsSync(assetsDir)) {
    throw new Error('找不到 out/renderer/assets，请先执行 pnpm build');
  }
  const files = readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
  const wanted = (pattern) => files.find((f) => f.startsWith(pattern));
  // Vite 可将基础 widget 与浮窗专用光感拆成多个 CSS 文件，不能只取第一个。
  const picked = [wanted('glass-'), ...files.filter((f) => f.startsWith('widget-')), wanted('main-')].filter(Boolean);
  if (picked.length === 0) throw new Error('构建产物里没有 CSS，请先执行 pnpm build');
  return picked.map((f) => `/* ${f} */\n${readFileSync(join(assetsDir, f), 'utf8')}`).join('\n');
}

const css = readBuiltCss();

/* ------------------------------------------------------------ 渲染用状态 */

const noop = () => undefined;

/** 场景一：上午没课，下午有课（对应"上午看今天还没上的课"） */
const morningView = fakeView({
  now: '2025-10-08T10:00',
  next: [
    {
      id: 'lesson:prob',
      kind: 'lesson',
      title: '概率论与数理统计',
      startAt: '2025-10-08T14:00',
      endAt: '2025-10-08T15:40',
      location: 'B104',
      color: '#12A594',
      status: 'upcoming',
      untilStartMinutes: 240,
      untilEndMinutes: 340,
      timeLabel: '14:00-15:40',
      countdownLabel: '4 小时后开始'
    },
    {
      id: 'lesson:eng',
      kind: 'lesson',
      title: '大学英语',
      startAt: '2025-10-08T16:00',
      endAt: '2025-10-08T17:40',
      location: '线上',
      color: '#8B7BD8',
      status: 'upcoming',
      untilStartMinutes: 360,
      untilEndMinutes: 460,
      timeLabel: '16:00-17:40',
      countdownLabel: '6 小时后开始'
    }
  ],
  todayTasks: [
    {
      task: {
        id: 't1',
        domain: 'study',
        type: 'assignment',
        title: '交数据结构实验报告',
        source: 'manual',
        urgency: 5,
        status: 'open',
        progress: 0,
        allDay: false,
        splittable: true,
        remindPolicy: 'default',
        autoScheduled: true,
        dueAt: fromNow(180),
        createdAt: '2025-10-01T09:00',
        updatedAt: '2025-10-01T09:00'
      },
      overdue: false,
      dueLabel: '今天 18:00',
      untilDueMinutes: 180
    },
    {
      task: {
        id: 't2',
        domain: 'study',
        type: 'assignment',
        title: '早该交的读书笔记',
        source: 'manual',
        urgency: 2,
        status: 'open',
        progress: 0,
        allDay: false,
        splittable: true,
        remindPolicy: 'default',
        autoScheduled: true,
        dueAt: fromNow(-1440),
        createdAt: '2025-10-01T09:00',
        updatedAt: '2025-10-01T09:00'
      },
      overdue: true,
      dueLabel: '昨天 18:00',
      untilDueMinutes: -1440
    }
  ],
  urgentTasks: [
    {
      task: {
        id: 't3',
        domain: 'life',
        type: 'todo',
        title: '买教材',
        source: 'manual',
        urgency: 3,
        status: 'open',
        progress: 0,
        allDay: false,
        splittable: true,
        remindPolicy: 'default',
        autoScheduled: true,
        dueAt: fromNow(2880),
        createdAt: '2025-10-01T09:00',
        updatedAt: '2025-10-01T09:00'
      },
      overdue: false,
      dueLabel: '周五 23:59',
      untilDueMinutes: 2880
    }
  ],
  summary: { lessonCount: 2, dueTodayCount: 3, overdueCount: 1, doneTodayCount: 2, plannedMinutes: 120 },
  warnings: [],
  settings: {
    dailyDigestAt: '07:30',
    classReminder: true,
    autoSchedule: true,
    autoLaunch: true,
    desktopMode: 'widget',
    glassOpacity: 0.55,
    quietOnFullscreen: true
  }
});

/** 场景二：正在上课 */
const ongoingView = fakeView({
  now: '2025-10-08T08:20',
  current: {
    id: 'lesson:ds',
    kind: 'lesson',
    title: '数据结构',
    startAt: '2025-10-08T08:00',
    endAt: '2025-10-08T09:40',
    location: 'A301',
    color: '#4F7CFF',
    status: 'ongoing',
    untilStartMinutes: -20,
    untilEndMinutes: 80,
    timeLabel: '08:00-09:40',
    countdownLabel: '还有 1 小时 20 分钟结束'
  },
  primary: {
    id: 'lesson:ds',
    kind: 'lesson',
    title: '数据结构',
    startAt: '2025-10-08T08:00',
    endAt: '2025-10-08T09:40',
    location: 'A301',
    color: '#4F7CFF',
    status: 'ongoing',
    untilStartMinutes: -20,
    untilEndMinutes: 80,
    timeLabel: '08:00-09:40',
    countdownLabel: '还有 1 小时 20 分钟结束'
  },
  summary: { lessonCount: 3, dueTodayCount: 1, overdueCount: 0, doneTodayCount: 0, plannedMinutes: 60 },
  warnings: [{ code: 'capacity_shortage', message: '「写课程论文」排不进未来 14 天的可执行时段' }]
});

/** 场景三：什么都没有 */
const emptyView = fakeView({
  current: undefined,
  primary: undefined,
  next: [],
  timeline: [],
  todayTasks: [],
  urgentTasks: [],
  summary: { lessonCount: 0, dueTodayCount: 0, overdueCount: 0, doneTodayCount: 0, plannedMinutes: 0 }
});

/* ---------------------------------------------------------------- 组装 */

const widgetActions = {
  onQuickAdd: noop,
  onComplete: noop,
  onHide: noop
};

function renderWidget(state, extra = {}) {
  return renderToStaticMarkup(
    createElement(WidgetView, {
      state,
      actions: widgetActions,
      quickTitle: '',
      urgency: 3,
      domain: 'study',
      onQuickTitleChange: noop,
      onUrgencyChange: noop,
      onDomainChange: noop,
      collapsed: false,
      onToggleCollapsed: noop,
      rippleKey: null,
      ...extra
    })
  );
}

const toastItems = [
  {
    id: 'toast-1',
    kind: 'reminder',
    title: '交数据结构实验报告',
    body: '距截止 30 分钟',
    urgency: 5,
    timeLabel: '17:30',
    strong: true,
    taskId: 't1'
  },
  {
    id: 'toast-2',
    kind: 'class',
    title: '15 分钟后上 数据结构',
    body: '10:00 开始 · A301',
    urgency: 4,
    timeLabel: '09:45',
    strong: false
  },
  {
    id: 'toast-3',
    kind: 'overdue',
    title: '早该交的读书笔记',
    body: '已超过截止时间 1 天',
    urgency: 2,
    timeLabel: '昨天',
    strong: true,
    taskId: 't2'
  }
];

const toastHtml = renderToStaticMarkup(
  createElement(ToastStackView, {
    update: { items: toastItems, queued: 2 },
    actions: { onDone: noop, onSnooze: noop, onDismiss: noop, onOpen: noop }
  })
);

/** 预览页要给出与桌面一致的背景（用桌面截图做衬底才能看出玻璃效果） */
function page(title: string, description: string, body: string, opts = {}) {
  const { width = 300, wall = true } = opts;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>ColDesk 预览 · ${title}</title>
<style>
${css}
  html, body { height: auto; }
  body {
    margin: 0; padding: 32px;
    font-family: var(--font-ui);
    color: #e8ecf5;
    background: ${wall ? 'linear-gradient(135deg, #1b2a4a 0%, #3a2a5e 45%, #6b3f6e 100%)' : '#12161f'};
    min-height: 100vh;
  }
  .page-head { max-width: 1080px; margin: 0 auto 22px; }
  .page-head h1 { font-size: 20px; margin: 0 0 6px; }
  .page-head p { margin: 0; font-size: 13px; color: rgba(255,255,255,.72); line-height: 1.7; }
  .stage { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; justify-content: center; }
  .stage > figure { margin: 0; }
  .stage figcaption { font-size: 12px; color: rgba(255,255,255,.7); text-align: center; margin-top: 10px; }
  .frame { width: ${width}px; }
  .frame.wide { width: 380px; }
  .frame.app-preview { width: 1140px; height: 760px; overflow: hidden; border-radius: 12px; border: 1px solid rgba(255,255,255,.18); }
  .note { max-width: 1080px; margin: 26px auto 0; font-size: 12px; color: rgba(255,255,255,.6); line-height: 1.8; }
  .note code { background: rgba(255,255,255,.12); padding: 1px 5px; border-radius: 5px; }
  .toast-root { height: auto; padding: 0; }
  .widget-root { padding: 0; }
</style>
</head>
<body>
  <div class="page-head">
    <h1>ColDesk 界面预览 · ${title}</h1>
    <p>${description}</p>
  </div>
  <div class="stage">${body}</div>
  <div class="note">
    这是用渲染层组件直接渲染出的静态 HTML（复用构建产物中的同一份 CSS），
    仅用于核对视觉与文案，按钮不可交互。真实运行时悬浮窗由系统 acrylic 提供桌面模糊，
    这里用渐变壁纸模拟背景，效果与桌面上的观感接近但不完全相同。
  </div>
</body>
</html>`;
}

const widgetPage = page(
  '悬浮窗',
  '三个时刻的情境：上课中 / 上午提前看下午的课 / 完全没有安排。卡片顶部横条可拖动，底部一行可直接加任务并选择紧迫度。',
  `
    <figure><div class="frame">${renderWidget(ongoingView)}</div><figcaption>上课中：正在进行 + 还有多久结束</figcaption></figure>
    <figure><div class="frame">${renderWidget(morningView)}</div><figcaption>上午：接下来是下午与晚上的课 + 今日临期（含超期）</figcaption></figure>
    <figure><div class="frame">${renderWidget(emptyView)}</div><figcaption>没有安排时的空状态</figcaption></figure>
    <figure><div class="frame">${renderWidget(morningView, { collapsed: true })}</div><figcaption>折叠态：只剩标题栏</figcaption></figure>
  `
);

const toastPage = page(
  '提醒弹窗',
  '从屏幕右下角滑入，同屏最多 3 条：紧迫度 5 与超期的提醒常驻不消失，其余 5 秒后自动淡出；排队中的条数会在下方提示。',
  `<figure><div class="frame wide">${toastHtml}</div><figcaption>三条提醒（含排队提示）</figcaption></figure>`,
  { width: 380, wall: true }
);

/* ------------------------------------------------------- 真实数据的状态 */

/** 悬浮窗用真实状态渲染一份，方便和手写场景对照 */
const realWidgetHtml = renderWidget(realState);

const weekPage = page(
  '周视图',
  '7 天 × 纵向时间轴：不同颜色区分课程、任务与生活占用，相交安排分列显示，点击某一天可切到那天的日程表。',
  `<figure><div class="frame wide">${renderToStaticMarkup(
    createElement(WeekView, { week: realState.week })
  )}</div><figcaption>由真实种子课程与自动排程结果生成</figcaption></figure>`,
  { width: 1000, wall: true }
);

/* ------------------------------------------------------------ 主窗口 */

/** 主窗口在纯 Node 下渲染需要一个 IPC 替身：把 state:get 直接返回上面那份状态 */
(globalThis as unknown as { window: unknown }).window = {
  coldesk: {
    invoke: async (channel: string) => (channel === 'state:get' ? realState : null),
    on: () => () => undefined
  },
  setInterval: () => 0,
  clearInterval: () => undefined,
  setTimeout: () => 0,
  clearTimeout: () => undefined
};

const { App } = await import('../src/renderer/src/app/App.tsx');
// fakeView 已在文件顶部导入，这里只补 fakeExpense
const { fakeExpense } = await import('../src/renderer/__tests__/fixtures.ts');

// 记账页需要真实数据才有意义，所以显式注入一份 fixture：
// 其中餐饮超支、饮料结余，正好能让"超支红标 + 结余绿标"两种状态都出现在预览里
const expensesView = fakeView({ expense: fakeExpense() });

const appPage = page(
  '主窗口',
  '左侧图标导航，右侧为玻璃卡片。日程默认打开日程表，右侧近期截止任务可按本次时长拖入空闲时间；保留清单与周视图，重叠安排分列显示。记账页把"本期到底超没超"放在最上面，下面是纯 CSS 画的花销柱状图与分类明细。',
  `
    <figure><div class="frame app-preview">${renderToStaticMarkup(createElement(App, { initialPage: 'schedule', view: realState }))}</div><figcaption>日程 · 日视图</figcaption></figure>
    <figure><div class="frame app-preview">${renderToStaticMarkup(createElement(App, { initialPage: 'study', view: realState }))}</div><figcaption>学习任务</figcaption></figure>
    <figure><div class="frame app-preview">${renderToStaticMarkup(createElement(App, { initialPage: 'expenses', view: expensesView }))}</div><figcaption>记账（日视图：结算 + 柱状图 + 分类明细）</figcaption></figure>
    <figure><div class="frame app-preview">${renderToStaticMarkup(createElement(App, { initialPage: 'settings', view: realState }))}</div><figcaption>设置</figcaption></figure>
  `,
  { width: 1140, wall: false }
);

writeFileSync(join(outDir, 'widget.html'), widgetPage, 'utf8');
writeFileSync(join(outDir, 'toast.html'), toastPage, 'utf8');
writeFileSync(join(outDir, 'week.html'), weekPage, 'utf8');
writeFileSync(join(outDir, 'app.html'), appPage, 'utf8');
writeFileSync(join(outDir, 'widget-real.html'), page('悬浮窗（真实数据）', '用数据层种子数据 + 一次真实自动排程算出的状态渲染，和 pnpm dev 启动后看到的是一致的。', `<figure><div class="frame">${realWidgetHtml}</div><figcaption>真实状态下的悬浮窗</figcaption></figure>`), 'utf8');

console.log('预览已生成：');
for (const f of ['index.html', 'widget.html', 'widget-real.html', 'toast.html', 'week.html', 'app.html']) {
  console.log(`  ${join(outDir, f)}`);
}
console.log('直接用浏览器打开 preview/index.html 即可。');
