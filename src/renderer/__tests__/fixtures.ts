import type { ExpenseView, HabitView, TodayView } from '@shared/view';
import type { Task, Urgency } from '@shared/types';
import type { WeekView } from '@shared/agenda';
import { buildExpenseSummary } from '@shared/expense';
import { buildDayDetail, buildMonthlyBoard, currentStreak } from '@shared/habit';
import type { Habit, HabitCheckin } from '@shared/habit';

/** 渲染层测试用的视图 fixture，字段与主进程返回的 TodayView 完全一致 */

const WEEKDAY_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 从起始日期生成 7 天概览；busy 用来给指定天塞几条块 */
export function fakeWeek(fromDate = '2025-10-08', busy: Record<number, number> = { 0: 1, 2: 2 }): WeekView {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${fromDate}T00:00`);
    d.setDate(d.getDate() + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const weekday = WEEKDAY_CN[d.getDay() === 0 ? 7 : d.getDay()];
    const count = busy[i] ?? 0;
    return {
      date,
      weekday,
      dayLabel: `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`,
      isToday: i === 0,
      blocks: Array.from({ length: count }, (_, k) => ({
        id: `block-${i}-${k}`,
        kind: (k % 2 === 0 ? 'lesson' : 'block') as 'lesson' | 'block',
        title: k % 2 === 0 ? `课程 ${i}-${k}` : `任务编排 ${i}-${k}`,
        location: k % 2 === 0 ? 'A301' : undefined,
        color: k % 2 === 0 ? '#4F7CFF' : '#8B7BD8',
        startMinute: 8 * 60 + k * 120,
        endMinute: 8 * 60 + k * 120 + 100,
        timeLabel: `${pad(Math.floor((8 * 60 + k * 120) / 60))}:00-${pad(
          Math.floor((8 * 60 + k * 120 + 100) / 60)
        )}:${pad((8 * 60 + k * 120 + 100) % 60)}`,
        reason: k % 2 === 0 ? undefined : '紧迫度 4 · 自动排入',
        locked: false
      }))
    };
  });

  return {
    days,
    weekStart: days[0].date,
    dueCount: 3,
    firstBusyIndex: 0
  };
}

export function fakeTask(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    domain: 'study',
    type: 'assignment',
    title,
    source: 'manual',
    urgency: 3,
    status: 'open',
    progress: 0,
    allDay: false,
    splittable: true,
    remindPolicy: 'default',
    autoScheduled: true,
    createdAt: '2025-10-01T09:00',
    updatedAt: '2025-10-01T09:00',
    ...extra
  };
}

export function fakeView(overrides: Partial<TodayView> = {}): TodayView {
  const base: TodayView = {
    now: '2025-10-08T10:00',
    date: '2025-10-08',
    dateLabel: '10月08日 周三',
    current: undefined,
    next: [
      {
        id: 'lesson:prob',
        kind: 'lesson',
        title: '概率论',
        startAt: '2025-10-08T14:00',
        endAt: '2025-10-08T15:40',
        location: 'B104',
        color: '#12A594',
        status: 'upcoming',
        untilStartMinutes: 240,
        untilEndMinutes: 340,
        timeLabel: '14:00-15:40',
        countdownLabel: '4 小时后开始'
      }
    ],
    primary: undefined,
    timeline: [
      {
        id: 'lesson:prob',
        kind: 'lesson',
        title: '概率论',
        startAt: '2025-10-08T14:00',
        endAt: '2025-10-08T15:40',
        location: 'B104',
        color: '#12A594'
      }
    ],
    week: fakeWeek(),
    todayTasks: [
      {
        task: fakeTask('t1', '交数据结构实验报告', { urgency: 5, dueAt: fromNow(180) }),
        overdue: false,
        dueLabel: '今天 21:00',
        untilDueMinutes: 180
      }
    ],
    urgentTasks: [],
    overdueTasks: [],
    summary: {
      lessonCount: 1,
      dueTodayCount: 1,
      overdueCount: 0,
      doneTodayCount: 0,
      plannedMinutes: 60
    },
    buckets: { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], done: [] },
    warnings: [],
    unscheduled: [],
    courses: [{ id: 'c1', name: '概率论', color: '#12A594' }],
    ui: { glassTintAlpha: 0.62, showWidget: true, showDrawer: false },
    settings: {
      dailyDigestAt: '07:30',
      classReminder: true,
      autoSchedule: true,
      autoLaunch: true,
      desktopMode: 'widget',
      glassOpacity: 0.3,
      quietOnFullscreen: true,
      desktopLayer: 'top',
      onboardingVersion: 1,
      highContrast: false,
    },
    expense: fakeExpense(),
    plannerPrefs: {
      studyWindows: [
        { start: '08:00', end: '12:00' },
        { start: '14:00', end: '18:00' },
        { start: '19:00', end: '23:00' }
      ],
      lifeWindows: [
        { start: '12:00', end: '13:30' },
        { start: '18:00', end: '19:00' },
        { start: '21:00', end: '23:00' }
      ],
      dailyCapMinutes: { study: 180, life: 60 },
      minBlockMinutes: 25,
      maxBlockMinutes: 90,
      breakMinutes: 10,
      dueBufferRatio: 0.2
    },
    habit: fakeHabit()
  };

  return { ...base, ...overrides };
}

export const urgencySamples: Urgency[] = [1, 2, 3, 4, 5];

/**
 * 记账视图夹具。
 *
 * 刻意造出"一个分类超支、其余在范围内"的局面，
 * 这样界面测试才能验证超支的红色标记、结余文案、柱状图超标柱都真的渲染出来——
 * 如果所有分类都正常，这些分支就永远测不到。
 *
 * ⚠️ `summary` 必须由**同一组参数**现算，不能事后用 overrides 单独改 monthBudget：
 * 踩过的坑——只覆盖 monthBudget 而 summary 还是按旧参数算的，
 * 夹具自身就自相矛盾（界面上写着"已填 ¥2000"、结算卡却按 50 元预算算），
 * 于是测试失败的原因指向界面，实际是夹具错了。
 */
export function fakeExpense(
  overrides: Partial<ExpenseView> = {},
  options: { openingBalance?: number } = {}
): ExpenseView {
  const categories = [
    { id: 'c1', name: '餐饮', icon: '🍚', color: '#F2994A', dailyTarget: 30, sortOrder: 0 },
    { id: 'c2', name: '饮料', icon: '🧋', color: '#EB5757', dailyTarget: 10, sortOrder: 1 }
  ];
  const entries = [
    { id: 'e1', categoryId: 'c1', date: '2026-10-08', amount: 45, note: '食堂 + 外卖', createdAt: '2026-10-08T12:00' },
    { id: 'e2', categoryId: 'c2', date: '2026-10-08', amount: 6, note: '奶茶', createdAt: '2026-10-08T15:00' }
  ];
  const totalDailyBudget = 50;
  const hasOpening = options.openingBalance !== undefined;

  // 与主进程一样：期初余额在时优先，否则按每日预算折算
  const summary = buildExpenseSummary({
    mode: 'day',
    anchorDate: '2026-10-08',
    today: '2026-10-08',
    categories,
    entries,
    totalDailyBudget,
    openingBalance: options.openingBalance,
    hasOpeningBalance: hasOpening
  });

  return {
    mode: 'day',
    anchorDate: '2026-10-08',
    today: '2026-10-08',
    categories,
    entries,
    totalDailyBudget,
    monthBudget: hasOpening
      ? { month: '2026-10', openingBalance: options.openingBalance as number, note: '' }
      : undefined,
    // 默认标成"不是示例数据"，这样默认夹具里不会出现"清空示例数据"按钮；
    // 需要测那个按钮的用例显式传 isSampleData: true
    isSampleData: false,
    summary,
    ...overrides
  };
}

/**
 * 打卡视图夹具。
 *
 * 固定锚点在 2026-10-08，三个习惯：两个每天、一个只有周内。
 * 构造出一部分已完成，于是"分级标色"的几种状态（完成 / 部分 / 未开始）都能测到。
 */
export function fakeHabit(overrides: Partial<HabitView> = {}): HabitView {
  const habits: Habit[] = [
    { id: 'h1', name: '早起', icon: '🌅', color: '#F2994A', activeDays: [], startDate: '2026-10-01', sortOrder: 0, archived: false },
    { id: 'h2', name: '背单词', icon: '📖', color: '#4F7CFF', activeDays: [], startDate: '2026-10-01', sortOrder: 1, archived: false },
    { id: 'h3', name: '跑步', icon: '🏃', color: '#12A594', activeDays: [1, 2, 3, 4, 5], startDate: '2026-10-01', sortOrder: 2, archived: false }
  ];
  const checkins: HabitCheckin[] = [
    { habitId: 'h1', date: '2026-10-08' },
    { habitId: 'h2', date: '2026-10-08' }
  ];
  const month = '2026-10';
  const today = '2026-10-08';

  return {
    month,
    habits,
    board: buildMonthlyBoard({ month, habits, checkins, today }),
    today: buildDayDetail(today, habits, checkins),
    streak: currentStreak(habits, checkins, today),
    quote: { text: '不积跬步，无以至千里。', from: '《荀子·劝学》', author: '荀子', source: 'local' },
    quoteFromFallback: true,
    ...overrides
  };
}

/**
 * 相对"现在"的本地时间字符串，格式与主进程一致（YYYY-MM-DDTHH:mm）。
 * 剩余时长这类断言必须用相对时间，否则测试会随真实日期漂移。
 */
export function fromNow(minutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
