/**
 * 主进程 → 渲染层的视图契约。
 * 渲染层只依赖这个文件，不直接接触数据库类型，便于将来安卓端复用同一份结构。
 */

import type { Agenda, AgendaSnapshot } from './agenda';
import type { Domain, Task, Urgency } from './types';
import type { PlanWarning } from './planner';
import type { PlannerPrefsView } from './plannerPrefs';
import type {
  ExpenseCategory,
  ExpenseEntry,
  ExpenseViewMode
} from './expense';
import { buildExpenseSummary } from './expense';
import type { Habit } from './habit';
import { buildDayDetail, buildMonthlyBoard } from './habit';
import type { Quote } from './quote';

export type { Agenda, AgendaSnapshot, PlanWarning };
export type { WeekDayView, WeekView } from './agenda';

export interface AppSettingsView {
  language?: import('./navigation').Language;
  navigationOrder?: import('./navigation').NavPage[];
  startPage?: import('./navigation').NavPage;
  dailyDigestAt: string;
  classReminder: boolean;
  autoSchedule: boolean;
  autoLaunch: boolean;
  desktopMode: 'widget' | 'drawer' | 'both' | 'island';
  glassOpacity: number;
  quietOnFullscreen: boolean;
  /** 悬浮窗层级：固定最前 / 普通 / 置底 */
  desktopLayer: 'top' | 'normal' | 'bottom';
  onboardingVersion: number;
  highContrast: boolean;
  uiFont?: string;
  homeCoverFont?: string;
  scheduleStart?: string;
  scheduleEnd?: string;
  mainTheme?: import('./personalization').ThemeId;
  homeTheme?: import('./personalization').ThemeId;
}

export interface TaskBucketsView {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  thisWeek: Task[];
  later: Task[];
  done: Task[];
}

export interface TodayView {
  now: string;
  date: string;
  dateLabel: string;
  /** 渲染层需要的界面参数（由主进程按设置算出） */
  ui: {
    /** 透明度 0..1，映射成玻璃薄纱的 alpha */
    glassTintAlpha: number;
    /** 是否显示悬浮窗 */
    showWidget: boolean;
    /** 是否显示贴边抽屉 */
    showDrawer: boolean;
  };
  /** 正在进行的安排（课/考试/编排块） */
  current?: Agenda['current'];
  /** 接下来若干条安排 */
  next: Agenda['next'];
  /** 悬浮窗"当下"一段的选题结果 */
  primary?: Agenda['current'];
  timeline: Agenda['timeline'];
  /** All dates for task detail editors; one task may have multiple independently movable segments. */
  taskSegments?: import('./types').ScheduleBlock[];
  /** 未来 7 天概览，周视图数据源 */
  week: Agenda['week'];
  courseWeek?: Agenda['week'];
  teachingSlots?: Array<{slotIndex:number;startTime:string;endTime:string}>;
  teachingSlotsEstimated?: boolean;
  /** 今日临期：今天到期的 + 已超期未处理的 */
  todayTasks: Agenda['todayTasks'];
  /** 跨天临期：今天之后 7 天内的 */
  urgentTasks: Agenda['urgentTasks'];
  /** 上面两组里已超期的部分 */
  overdueTasks: Agenda['overdueTasks'];
  summary: Agenda['summary'];
  buckets: TaskBucketsView;
  warnings: PlanWarning[];
  unscheduled: Array<{ taskId: string; title: string; reason: string }>;
  courses: Array<{ id: string; name: string; color: string }>;
  settings: AppSettingsView;
  /** 排程偏好里用户可调的那部分，供设置页编辑 */
  plannerPrefs: PlannerPrefsView;
  /** 记账：分类、每日目标、当前区间的结算（口径见 shared/expense.ts） */
  expense: ExpenseView;
  /** 自律打卡：习惯、当前月视图、今日明细与名言 */
  habit: HabitView;
}

/**
 * 自律打卡的视图状态。
 *
 * 把"习惯 + 签到 + 月视图 + 今日明细 + 名言"打包给渲染层。
 * 月视图是**当前停留月份**的，翻页由渲染层调用 habit:setMonth 让主进程重算；
 * 名言可能来自远端（异步返回后单独广播），所以它是可空的。
 */
export interface HabitView {
  /** 当前停留的月份 YYYY-MM */
  month: string;
  habits: Habit[];
  /** Archived records stay available for inspection and restoration. */
  archivedHabits?: Habit[];
  /** 当前月网格与统计 */
  board: ReturnType<typeof buildMonthlyBoard>;
  /** 今日明细：哪些做了哪些没做（供"完成一项"用） */
  today: ReturnType<typeof buildDayDetail>;
  /** 连续打卡天数 */
  streak: number;
  /** 每日名言；尚未取回时为 undefined */
  quote?: Quote;
  /** 名言取回失败时是否已回退到本地（用于界面提示） */
  quoteFromFallback: boolean;
}

/**
 * 记账的视图状态。
 *
 * 把"分类 / 流水 / 结算"三样打包给渲染层，而不是只给结算结果：
 * 因为记账页要能翻看历史、编辑分类、删除某一笔，这些都需要原始数据。
 * 流水只给最近 N 天，避免长期使用后一次推送过多数据。
 */
export interface ExpenseView {
  /** 当前视图模式，由主进程持久化，切页后仍保持 */
  mode: ExpenseViewMode;
  /** 视图停留的基准日期 */
  anchorDate: string;
  /** 今天（渲染层据此标注"未来"的柱子，不用自己取时间） */
  today: string;
  categories: ExpenseCategory[];
  /** 最近若干天的流水，按日期倒序 */
  entries: ExpenseEntry[];
  /** 每日总预算（期初余额未填时的兜底口径） */
  totalDailyBudget: number;
  /** 视图停留那一月的期初余额；undefined 表示该月还没填过 */
  monthBudget?: { month: string; openingBalance: number; note: string };
  /**
   * 当前流水是否仍是首次运行灌入的示例数据。
   * 为 false 时界面不再显示"清空示例数据"——按钮据此自己消失，
   * 因为用户已经改过数据，再提供"清空示例"就变成会误删真实记录的危险操作。
   */
  isSampleData: boolean;
  /** 当前区间的结算结果 */
  summary: ReturnType<typeof buildExpenseSummary>;
}

export interface ToastView {
  id: string;
  kind: 'reminder' | 'event' | 'class' | 'daily_digest' | 'overdue' | 'missed' | 'startup';
  title: string;
  body?: string;
  urgency?: Urgency;
  timeLabel: string;
  strong: boolean;
  taskId?: string;
  reminderId?: string;
  eventId?: string;
}

export interface ToastUpdate {
  items: ToastView[];
  queued: number;
}

export interface TaskCreateInput {
  title: string;
  domain: Domain;
  type?: Task['type'];
  urgency: Urgency;
  dueAt?: string;
  estMinutes?: number;
  splittable?: boolean;
  courseId?: string;
  detail?: string;
}
