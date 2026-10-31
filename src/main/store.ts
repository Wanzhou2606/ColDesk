/**
 * 应用状态中心（主进程）：
 *  - 从数据库装载快照
 *  - 调用排程引擎并在数据变化后重排
 *  - 维护提醒表
 *  - 生成给悬浮窗/主窗口的视图模型
 */

import {getCalendarEvents} from './calendarEvents';
import {sortTasksByPriority} from '@shared/scoring';
import {isReminderEvent} from '@shared/calendarEvents';
import {validateTaskSegments,type TaskSegment} from '@shared/taskSegments';
import {validHomeDate} from '@shared/home';
import {getDb} from './db';
import { EventEmitter } from 'node:events';

import type { Agenda, AgendaSnapshot } from '@shared/agenda';
import { buildAgenda, buildTimeline, buildWeek, primaryMoment } from '@shared/agenda';
import { manualRange, placementConflict, type ManualPlacement } from '@shared/manualSchedule';
import { isThemeId, scheduleWindow } from '@shared/personalization';
import { teachingPeriods } from '@shared/teachingPeriods';
import { navigationOrder, validLanguage, validNavPage } from '@shared/navigation';
import {setLanguage} from '@shared/i18n';
import { normalizeFontName } from '@shared/fonts';
import type { TaskPatch } from '@shared/taskActions';
import type { Task, Urgency } from '@shared/types';
import type { AppSettingsView, TaskBucketsView, TodayView } from '@shared/view';
import {
  DEFAULT_PREFS_VIEW,
  sanitizePrefsView,
  toPlannerPrefs,
  type PlannerPrefsView
} from '@shared/plannerPrefs';
import { planSchedule, selectPlannableTasks, toPlannerTask, type PlanWarning } from '@shared/planner';
import { reminderDraftsForTask } from '@shared/reminders';
import { dateOf, mondayOf, nowLocal, today } from '@shared/time';

import {
  applyAutoPlan,
  saveManualBlock,
  replaceTaskSegments,
  normalizeManualPlacements,
  removeManualBlock,
  getActiveCampus,
  getActiveSemester,
  getBlocks,
  getBusyBlocks,
  getCourses,
  getExams,
  getExpenseCategories,
  getExpenseDailyBudget,
  getHabits,
  getCheckins,
  getMonthBudget,
  expenseEntriesFingerprint,
  getOverrides,
  getRecentExpenseEntries,
  getSessions,
  getSettingsJson,
  getTasks,
  getTimeSlots,
  replaceRemindersForTask,
  pruneInactiveTaskReminders,
  cleanDerivedData,
  saveTask,
  patchTask,
  setTaskPinned,
  deleteTask,
  getTask,
  setTaskStatus,
  setSettingsJson,
  getSetting,
  setSetting,
  type TaskInput
} from './db/repositories';
import type { ExpenseView } from '@shared/view';
import type { HabitView } from '@shared/view';
import { buildExpenseSummary, type ExpenseViewMode } from '@shared/expense';
import {
  buildDayDetail,
  buildMonthlyBoard,
  currentStreak,
  monthBounds
} from '@shared/habit';
import { FALLBACK_QUOTES, fallbackQuoteFor, fetchQuote, type Quote } from '@shared/quote';
import { addDays } from '@shared/time';
import { SEED_EXPENSE_FINGERPRINT, SEED_TOTAL_DAILY_BUDGET } from './db/seed-data';

/**
 * 主进程内部持有的设置。
 *
 * 多一个 `plannerPrefs`，渲染层从 state.plannerPrefs 单独取。
 */
export interface AppSettings extends AppSettingsView {
  /** 排程偏好里用户可调的那部分 */
  plannerPrefs: PlannerPrefsView;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language:'zh-CN',navigationOrder:navigationOrder(null),startPage:'schedule',
  dailyDigestAt: '07:30',
  classReminder: true,
  autoSchedule: false,
  autoLaunch: false,
  desktopMode: 'widget',
  // 玻璃透明度：0.62 是权衡后的默认值——再透会出现"背后的字透过来看不清内容"，
  // 再实就失去玻璃感。可在设置里调（0.45 ~ 1.0）
  glassOpacity: 0.62,
  quietOnFullscreen: true,
  // 悬浮窗层级：默认固定在最前，可切成普通或置底
  desktopLayer: 'top',
  onboardingVersion: 0,
  highContrast: false,
  uiFont: 'system',
  homeCoverFont: 'STXingkai',
  scheduleStart: '06:00',
  scheduleEnd: '24:00',
  mainTheme: 'default',
  homeTheme: 'default',
  plannerPrefs: DEFAULT_PREFS_VIEW
};

export interface TaskBuckets extends TaskBucketsView {}

export interface AppState extends TodayView {
  agenda: Agenda;
}

class Store extends EventEmitter {
  private snapshot: AgendaSnapshot = {
    courses: [],
    sessions: [],
    overrides: [],
    timeSlots: [],
    tasks: [],
    exams: [],
    blocks: [],
    busy: []
  };

  private warnings: PlanWarning[] = [];
  private unscheduled: Array<{ taskId: string; title: string; reason: string }> = [];
  private settings: AppSettings = DEFAULT_SETTINGS;
  private state: AppState | null = null;

  /**
   * 记账视图状态：当前模式与停留的日期。
   * 放在主进程而不是渲染层的 useState，是为了"切到别的页再回来仍是同一区间"。
   */
  private expenseMode: ExpenseViewMode = 'day';
  private expenseAnchor = today();

  /** 打卡视图当前停留的月份（YYYY-MM） */
  private habitMonth = today().slice(0, 7);
  /** 每日名言缓存：今天取过一次就不再取（一言官方限制 QPS 且不欢迎刷接口） */
  private habitQuote: Quote | null = null;
  private habitQuoteDate = '';
  private habitQuoteFromFallback = false;

  /** 记账流水推送窗口：只取最近这么多天，避免长期使用后一次推太多数据 */
  private static readonly EXPENSE_WINDOW_DAYS = 120;

  load(): void {
    const { settings, needsCleanup } = this.readSettings();
    this.settings = settings;
    /*
     * 一次性清理：如果数据库里还留着已下线的键，立刻写回一份干净的。
     *
     * 不这么做的话，旧键会一直躺在用户的数据库里——
     * 因为 load() 只读取、不写回，只有用户下次改设置时才会顺手覆盖掉。
     * 写回的内容就是合并默认值之后的完整设置，所以不会丢任何有效字段。
     */
    if (needsCleanup) setSettingsJson('app', this.settings);

    if(getSetting('manual_schedule_v1')!=='1'){this.settings.autoSchedule=false;setSettingsJson('app',this.settings);applyAutoPlan([]);setSetting('manual_schedule_v1','1');}
    // 只在第一次写入的默认设置（记账总预算等）
    this.ensureDefaults();
    // initDatabase has already made a rolling backup before touching derived cache.
    cleanDerivedData();

    this.reloadSnapshot();
    // 启动时必须重建提醒：否则首次运行、以及每次重启后，reminder 表都是空的，
    // 多级提醒（1 天前 / 1 小时前 / 10 分钟前）就完全不会触发。
    this.refreshReminders();
    this.replan();
    this.refresh();
  }

  /**
   * 初始化"只在第一次写入"的设置项。
   *
   * 为什么放在 store 而不是数据库种子里：
   * 设置项在测试环境下走内存实现，如果种子直接用原生 SQL 写 setting 表，
   * 就会出现"种子写了、应用读不到"的分叉（真实踩过：
   * 每日总预算一直是空的，导致界面上预算进度与超支判断都不显示）。
   * 这里统一用 getSetting/setSetting 这一对封装，写入与读取必然同源。
   */
  private ensureDefaults(): void {
    if (getSetting('expense_daily_budget') === undefined) {
      setSetting('expense_daily_budget', String(process.env.COLDESK_SEED_SAMPLE === '1' ? SEED_TOTAL_DAILY_BUDGET : 0));
    }
  }

  /**
   * 读取设置并补齐缺失字段：老版本存下的设置里没有 plannerPrefs。
   *
   * 同时剔除已下线的键，并告诉调用方"是否需要写回"：
   * 因为下面用展开语法合并，残留的旧键会被一起读进来，
   * 于是读出来的对象里会带着一个已经删掉的功能的配置。
   */
  private readSettings(): { settings: AppSettings; needsCleanup: boolean } {
    const raw = getSettingsJson<Partial<AppSettings> & Record<string, unknown>>('app', {});
    // 清理已下线的流动光、三档光效及未使用的提示字段。
    const { glassFlow: _removedGlassFlow, glassTintHint: _removedTintHint,
      glassLight: _removedLight, glassLightStrength: _removedStrength, ...stored } = raw;
    const needsCleanup = ['glassFlow', 'glassTintHint', 'glassLight', 'glassLightStrength'].some(key => key in raw);

    /*
     * 透明度做过一次整体上调：早期默认值是 0.30，实测"背后的字透过来看不清内容"。
     * 仅迁移低于滑块下限 0.45 的旧值，合法的手动选择必须保留。
     */
    const rawOpacity = typeof stored.glassOpacity === 'number' ? stored.glassOpacity : undefined;
    const glassOpacity =
      rawOpacity === undefined || !Number.isFinite(rawOpacity) || rawOpacity < 0.45
        ? DEFAULT_SETTINGS.glassOpacity : Math.min(rawOpacity, 1);

    return {
      needsCleanup,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(stored as Partial<AppSettings>),
        glassOpacity,
        language:validLanguage(stored.language)?stored.language:'zh-CN',
        navigationOrder:navigationOrder(stored.navigationOrder),
        startPage:validNavPage(stored.startPage)?stored.startPage:'schedule',
        scheduleStart: scheduleWindow(stored).startLabel,
        scheduleEnd: scheduleWindow(stored).endLabel,
        mainTheme: isThemeId(stored.mainTheme) ? stored.mainTheme : 'default',
        homeTheme: isThemeId(stored.homeTheme) ? stored.homeTheme : 'default',
        uiFont: normalizeFontName(stored.uiFont, 'system'),
        homeCoverFont: normalizeFontName(stored.homeCoverFont, 'STXingkai'),
        plannerPrefs: sanitizePrefsView(stored.plannerPrefs ?? DEFAULT_PREFS_VIEW)
      }
    };
  }

  /** Refresh external writes without replaying startup migrations or rebuilding finished reminders. */
  refreshExternalData(): void {
    this.reloadSnapshot();
    this.refreshReminders();
    this.replan();
    this.refresh();
  }

  /** 重新装载数据快照。改完作息时间/校区后由 IPC 调用，让课表立刻反映新设置 */
  reloadSnapshot(): void {
    // 设置也要一起刷新：否则在设置页改完自动排程/透明度，本次会话内不会生效。
    // 这里不处理 needsCleanup：load() 已经在启动时做过一次性清理，
    // 而运行期写回设置的地方（updateSettings）本来就会把完整设置覆盖回去。
    this.settings = this.readSettings().settings;
    setLanguage(this.settings.language);

    const semester = getActiveSemester();
    // 只取当前校区的作息，并剔除预备铃（预备铃没有上课时长，不参与展开）
    const campus = getActiveCampus();
    const slots = semester
      ? getTimeSlots(semester.id, campus).filter((s) => !s.isPrepareBell)
      : [];
    this.snapshot = {
      semester,
      events:getCalendarEvents(),
      courses: getCourses(semester?.id),
      sessions: getSessions(),
      overrides: getOverrides(),
      timeSlots: slots,
      tasks: getTasks(),
      exams: getExams(),
      blocks: getBlocks(),
      busy: getBusyBlocks()
    };
  }

  /** 重新计算提醒表：所有未完成且有截止时间的任务 */
  refreshReminders(): void {
    pruneInactiveTaskReminders();
    for (const task of this.snapshot.tasks) {
      if (task.status === 'done' || task.status === 'canceled') continue;
      if (!task.dueAt) continue;
      const drafts = reminderDraftsForTask(task);
      replaceRemindersForTask(
        task.id,
        drafts.map((d) => ({ fireAt: d.fireAt, level: d.level, reason: d.reason })),
        { title: task.title, urgency: task.urgency }
      );
    }
  }

  /**
   * 已执行的排程次数。
   *
   * 用来给"外观类设置不得触发重排"做回归断言——
   * 之前拖透明度滑块会连续触发几十次重排，导致界面卡顿。
   * 只靠观察数据库里的块数不可靠（任务状态变化会让块数不变），所以直接计数。
   */
  replanCount = 0;

  /** 跑一次自动排程并落库 */
  replan(): void {
    this.replanCount += 1;
    if(normalizeManualPlacements())this.reloadSnapshot();
    const now = nowLocal();

    // 用户在设置里关掉"保存后自动排入日程"：清掉自动排出的块（手动的原样保留），
    // 之后新建任务只记录不占用时间，直到他重新打开或手动重排。
    // 注意这里必须重新装载快照，否则广播出去的状态里还带着刚清掉的块。
    if (!this.settings.autoSchedule) {
      applyAutoPlan([]);
      this.warnings = [];
      this.unscheduled = [];
      this.reloadSnapshot();
      return;
    }

    const tasks = selectPlannableTasks(this.snapshot.tasks).map((t) => toPlannerTask(t, now));
    if (tasks.length === 0) {
      // 没有可排任务时也要清掉历史自动块，避免留下过期安排（用户锁定的块不动）
      applyAutoPlan([]);
      this.warnings = [];
      this.unscheduled = [];
      this.reloadSnapshot();
      return;
    }

    const locked = this.snapshot.blocks
      .filter((b) => b.locked || b.origin === 'manual')
      .map((b) => ({
        id: b.id,
        taskId: b.taskId,
        date: b.date,
        startAt: b.startAt,
        endAt: b.endAt,
        plannedMinutes: b.plannedMinutes
      }));

    const result = planSchedule({
      now,
      semester: this.snapshot.semester,
      courses: this.snapshot.courses,
      sessions: this.snapshot.sessions,
      overrides: this.snapshot.overrides,
      timeSlots: this.snapshot.timeSlots,
      exams: this.snapshot.exams,
      busy: [...this.snapshot.busy,...(this.snapshot.events??[]).filter(event=>!isReminderEvent(event)).map(event=>({id:event.id,title:event.title,date:event.startAt.slice(0,10),startAt:event.startAt,endAt:event.endAt,domain:'study' as const}))],
      lockedBlocks: locked,
      tasks,
      // 用户可调的排程偏好（可安排时段、单日上限、单块时长、缓冲）
      prefs: toPlannerPrefs(this.settings.plannerPrefs)
    });

    applyAutoPlan(result.blocks);
    this.warnings = result.warnings;
    this.unscheduled = result.unscheduled.map((u) => ({ taskId: u.taskId, title: u.title, reason: u.reason }));
    this.reloadSnapshot();
  }

  private buildBuckets(now: string): TaskBuckets {
    const buckets: TaskBuckets = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], done: [] };
    const todayStr = dateOf(now);
    for (const t of this.snapshot.tasks) {
      if (t.status === 'done') {
        buckets.done.push(t);
        continue;
      }
      if (t.status === 'canceled') continue;
      if (!t.dueAt) {
        buckets.later.push(t);
        continue;
      }
      const d = dateOf(t.dueAt);
      if (t.dueAt < now) buckets.overdue.push(t);
      else if (d === todayStr) buckets.today.push(t);
      else if (d === addDaysStr(todayStr, 1)) buckets.tomorrow.push(t);
      else if (d <= addDaysStr(todayStr, 7)) buckets.thisWeek.push(t);
      else buckets.later.push(t);
    }
    for(const key of Object.keys(buckets) as Array<keyof TaskBuckets>)buckets[key]=sortTasksByPriority(buckets[key],now);
    return buckets;
  }

  refresh(): void {
    const now = nowLocal();
    const agenda = buildAgenda(this.snapshot, now);
    const courseWeek=buildWeek(this.snapshot, mondayOf(dateOf(now)), 7, dateOf(now));
    const periods=teachingPeriods(this.snapshot.timeSlots.filter(s=>!s.isPrepareBell),courseWeek,this.snapshot.semester?.name.startsWith('杭电助手课表'));
    this.state = this.stateWithSettings({
      ...agenda,
      agenda,
      primary: primaryMoment(agenda),
      buckets: this.buildBuckets(now),
      taskSegments: this.snapshot.blocks,
      warnings: this.warnings,
      unscheduled: this.unscheduled,
      courseWeek,
      teachingSlots: periods.periods,
      teachingSlotsEstimated: periods.estimated,
      courses: this.snapshot.courses.map((c) => ({ id: c.id, name: c.name, color: c.color }))
    });
    this.emit('change', this.state);
  }

  /**
   * 把"随设置变化的那部分状态"补齐。
   *
   * 之所以抽成一个方法：`ui` 和 `settings` 都是从 this.settings 派生的，
   * 之前 refresh 与 broadcastSettings 各写一遍，结果 broadcastSettings 漏了 `ui`，
   * 导致拖动透明度滑块时悬浮窗读到的还是旧的 glassTintAlpha——
   * 表现就是"设置里调整悬浮窗没反应"。现在只在这一处派生，不会再漏。
   */
  private stateWithSettings(
    base: Omit<AppState, 'ui' | 'settings' | 'plannerPrefs' | 'expense' | 'habit'>
  ): AppState {
    return {
      ...base,
      ui: {
        glassTintAlpha: this.settings.glassOpacity,
        showWidget: this.settings.desktopMode !== 'drawer',
        showDrawer: this.settings.desktopMode === 'drawer'||this.settings.desktopMode==='both'
      },
      settings: this.settingsForView(),
      plannerPrefs: this.settings.plannerPrefs,
      expense: this.buildExpenseView(),
      habit: this.buildHabitView()
    };
  }

  /**
   * 组装记账视图。
   *
   * 每次 refresh 都重算：记账的数据量很小（一年也就几千笔），
   * 而"结算结果必须和流水、分类保持同步"——
   * 缓存反而容易在增删改后出现"金额变了但结余没变"的脏数据。
   */
  private buildExpenseView(): ExpenseView {
    const categories = getExpenseCategories();
    const totalDailyBudget = getExpenseDailyBudget();
    const entries = getRecentExpenseEntries(Store.EXPENSE_WINDOW_DAYS);
    const todayStr = today();

    /*
     * 期初余额按"视图停留那一月"取，而不是按今天：
     * 用户翻到 9 月看账时，应该看到 9 月自己填的余额，
     * 而不是今天的月份的余额。
     */
    const anchorMonth = this.expenseAnchor.slice(0, 7);
    const monthBudget = getMonthBudget(anchorMonth);

    /*
     * 判断当前是否仍是"首次运行灌入的示例流水"。
     * 用指纹比对而不是打标记：用户改过任何一笔，指纹就对不上，
     * "清空示例数据"按钮会自动消失，不需要额外维护一个标志位。
     */
    const isSampleData = entries.length > 0 && expenseEntriesFingerprint() === SEED_EXPENSE_FINGERPRINT;

    return {
      mode: this.expenseMode,
      anchorDate: this.expenseAnchor,
      today: todayStr,
      categories,
      entries,
      totalDailyBudget,
      monthBudget,
      isSampleData,
      summary: buildExpenseSummary({
        mode: this.expenseMode,
        anchorDate: this.expenseAnchor,
        today: todayStr,
        categories,
        entries,
        totalDailyBudget,
        openingBalance: monthBudget?.openingBalance,
        hasOpeningBalance: monthBudget !== undefined
      })
    };
  }

  /** 切换记账视图模式或翻页；会立即广播给所有窗口 */
  setExpenseView(next: { mode?: ExpenseViewMode; anchorDate?: string }): void {
    if (next.mode) this.expenseMode = next.mode;
    if (next.anchorDate) this.expenseAnchor = next.anchorDate;
    // 只在已有状态时做原地更新：避免记账操作触发整份日程重建
    if (!this.state) {
      this.refresh();
      return;
    }
    const { expense: _old, ...rest } = this.state;
    this.state = this.stateWithSettings(rest);
    this.emit('change', this.state);
  }

  getExpenseView(): { mode: ExpenseViewMode; anchorDate: string } {
    return { mode: this.expenseMode, anchorDate: this.expenseAnchor };
  }

  /** 组装打卡视图 */
  private buildHabitView(): HabitView {
    const allHabits = getHabits(true),habits=allHabits.filter(habit=>!habit.archived);
    const todayStr = today();
    const { start, end } = monthBounds(this.habitMonth);
    const checkins = getCheckins(start, end);

    return {
      month: this.habitMonth,
      habits,
      archivedHabits:allHabits.filter(habit=>habit.archived),
      board: buildMonthlyBoard({
        month: this.habitMonth,
        habits,
        checkins,
        today: todayStr
      }),
      today: buildDayDetail(todayStr, habits, getCheckins(todayStr, todayStr)),
      streak: currentStreak(habits, getCheckins(addDays(todayStr, -366), todayStr), todayStr),
      quote: this.habitQuoteFor(todayStr),
      quoteFromFallback: this.habitQuoteFromFallback
    };
  }

  /** 取今日名言：同一天只取一次，先读缓存，命中就直接用 */
  private habitQuoteFor(date: string): Quote | undefined {
    if (this.habitQuoteDate === date) return this.habitQuote ?? undefined;

    // 先看昨天/今天是否已经取过（跨进程重启也能命中）
    const cached = this.readQuoteCache(date);
    if (cached) {
      this.habitQuoteDate = date;
      this.habitQuote = cached;
      this.habitQuoteFromFallback = cached.source === 'local';
      return cached;
    }

    this.habitQuoteDate = date;
    this.habitQuote = fallbackQuoteFor(date);
    this.habitQuoteFromFallback = true;
    const requestedQuote=this.habitQuote;
    // 同步路径先用本地兜底，异步取回后再广播一次刷新。
    //
    // 注意：这个续体可能在"应用即将退出 / 测试已关闭数据库"之后才触发，
    // 如果那时再写缓存或广播就会抛错。所以整个续体包一层防御——
    // 名言是纯装饰，取到了最好，取不到或时机不对也绝不能影响打卡与关闭流程。
    void fetchQuote(date)
      .then((quote) => {
        try {
          if(this.habitQuoteDate!==date||this.habitQuote!==requestedQuote)return;
          this.habitQuote = quote;
          this.habitQuoteFromFallback = quote.source === 'local';
          this.writeQuoteCache(date, quote);
          if (this.state) {
            const { habit: _old, ...rest } = this.state;
            this.state = this.stateWithSettings(rest);
            this.emit('change', this.state);
          }
        } catch {
          /* 数据库已关闭等场景：静默放弃这次刷新，不产生未处理拒绝 */
        }
      })
      .catch(() => {
        /* fetchQuote 永不抛错，但防御一层，确保不会有 unhandledRejection */
      });

    return this.habitQuote ?? undefined;
  }

  refreshHabitQuote(): Quote {
    const index=FALLBACK_QUOTES.findIndex(q=>q.text===this.habitQuote?.text);
    const quote=FALLBACK_QUOTES[(index+1)%FALLBACK_QUOTES.length];
    this.habitQuoteDate=today();this.habitQuote=quote;this.habitQuoteFromFallback=true;
    this.writeQuoteCache(this.habitQuoteDate,quote);this.refresh();return quote;
  }
  private readQuoteCache(date: string): Quote | undefined {
    try {
      const raw = getSetting('habit_quote_cache');
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { date?: string; quote?: Quote };
      if (parsed?.date === date && parsed.quote?.text) return parsed.quote;
    } catch {
      /* 缓存坏了或数据库未就绪，都当没有 */
    }
    return undefined;
  }

  private writeQuoteCache(date: string, quote: Quote): void {
    try {
      setSetting('habit_quote_cache', JSON.stringify({ date, quote }));
    } catch {
      /* 写不进去也不影响使用 */
    }
  }

  /** 切换打卡停留的月份；立即广播 */
  setHabitMonth(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    this.habitMonth = month;
    if (!this.state) {
      this.refresh();
      return;
    }
    const { habit: _old, ...rest } = this.state;
    this.state = this.stateWithSettings(rest);
    this.emit('change', this.state);
  }

  getState(): AppState {
    if (!this.state || this.state.now !== nowLocal()) this.refresh();
    return this.state as AppState;
  }

  scheduleView(date:string):TodayView{
    if(!validHomeDate(date))throw Error('请选择有效的日程日期');
    const base=this.getState(),agenda=buildAgenda(this.snapshot,date+'T'+base.now.slice(11)),courseWeek=buildWeek(this.snapshot,mondayOf(date),7,base.date);
    return {...base,...agenda,summary:{...agenda.summary,dueTodayCount:this.snapshot.tasks.filter(task=>task.status!=='done'&&task.status!=='canceled'&&task.dueAt?.slice(0,10)===date).length},now:base.now,buckets:base.buckets,todayTasks:base.todayTasks,urgentTasks:base.urgentTasks,overdueTasks:base.overdueTasks,settings:base.settings,courseWeek,week:buildWeek(this.snapshot,date,7,base.date)};
  }
  returnTaskToBar(taskId:unknown,date:unknown):AppState{
    if(typeof taskId!=='string'||!getTask(taskId)||!validHomeDate(date))throw Error('请选择有效的任务和日程日期');
    getDb().prepare('UPDATE schedule_block SET deleted_at=?,updated_at=? WHERE task_id=? AND date=? AND deleted_at IS NULL').run(nowLocal(),nowLocal(),taskId,date);
    this.reloadSnapshot();this.refresh();return this.getState();
  }

  /* ------------------------------------------------------------ 变更操作 */

  placeTask(input: ManualPlacement): AppState {
    this.reloadSnapshot();
    const task = this.snapshot.tasks.find(task => task.id === input.taskId);
    if (!task || task.status === 'done' || task.status === 'canceled') throw new Error('任务不存在或已经完成，请重新选择');
    const range = manualRange(input.startAt, input.durationMinutes);
    const existing = this.snapshot.blocks.filter(block=>block.taskId===task.id);
    const moving = input.blockId ? existing.find(block=>block.id===input.blockId) : undefined;
    if (input.blockId) {
      if (!moving) throw new Error('这段日程已更新，请重新选择');
    }
    const conflict = placementConflict(buildTimeline({date:range.date,snapshot:this.snapshot}),range.startAt,range.durationMinutes,moving?.id,task.id);
    if (conflict) throw new Error(conflict);
    saveManualBlock({ taskId:task.id, date:range.date, startAt:range.startAt, endAt:range.endAt, plannedMinutes:range.durationMinutes, blockId:moving?.id });
    this.reloadSnapshot(); this.refresh();
    return this.getState();
  }
  removeTaskPlacement(id: string): AppState {
    this.reloadSnapshot();
    const block = this.snapshot.blocks.find(block => block.id === id);
    if (!block || (!block.locked && block.origin !== 'manual')) throw new Error('只能移除手动安排');
    removeManualBlock(id);
    this.reloadSnapshot(); this.refresh();
    return this.getState();
  }

  private checkTaskSegments(taskId:string|undefined,input:unknown):TaskSegment[]{
    const rows=validateTaskSegments(input),existing=this.snapshot.blocks.filter(block=>block.taskId===taskId);
    for(const row of rows){
      if(row.id&&!existing.some(block=>block.id===row.id))throw Error('分段记录已更新，请重新打开任务');
      const timeline=buildTimeline({date:row.date,snapshot:this.snapshot}).filter(block=>!taskId||block.taskId!==taskId||block.kind!=='block');
      const conflict=placementConflict(timeline,row.startAt,row.plannedMinutes);if(conflict)throw Error(conflict);
    }
    return rows;
  }
  saveTaskSegments(taskId:unknown,input:unknown):AppState{
    this.reloadSnapshot();
    const task=typeof taskId==='string'?getTask(taskId):undefined;
    if(!task||task.status==='done'||task.status==='canceled')throw Error('任务不存在或已经完成，请重新选择');
    const rows=this.checkTaskSegments(task.id,input);replaceTaskSegments(task.id,rows);
    this.reloadSnapshot();this.refresh();return this.getState();
  }
  updateTask(input: TaskInput,segments?:unknown): AppState {
    this.reloadSnapshot();
    const rows=segments===undefined?undefined:this.checkTaskSegments(input.id,segments);
    getDb().transaction(()=>{
    const task = saveTask(input);
    const drafts = reminderDraftsForTask(task);
    replaceRemindersForTask(
      task.id,
      drafts.map((d) => ({ fireAt: d.fireAt, level: d.level, reason: d.reason })),
      { title: task.title, urgency: task.urgency }
    );
    if(rows)replaceTaskSegments(task.id,rows);
    })();
    this.reloadSnapshot();
    this.refresh();
    return this.getState();
  }

  completeTask(id: string): AppState {
    setTaskStatus(id, 'done');
    this.reloadSnapshot();
    this.refresh();
    return this.getState();
  }

  editTask(id: string, patch: TaskPatch,segments?:unknown): AppState {
    this.reloadSnapshot();
    if(segments!==undefined&&['done','canceled'].includes(getTask(id)?.status??''))throw Error('任务不存在或已经完成，请重新选择');
    const rows=segments===undefined?undefined:this.checkTaskSegments(id,segments);
    getDb().transaction(()=>{
    const task = patchTask(id, patch);
    const drafts = task.status==='done'||task.status==='canceled' ? [] : reminderDraftsForTask(task);
    replaceRemindersForTask(id, drafts.map(d => ({fireAt:d.fireAt,level:d.level,reason:d.reason})), {title:task.title,urgency:task.urgency});
    if(rows)replaceTaskSegments(id,rows);
    })();
    this.reloadSnapshot(); this.refresh();
    return this.getState();
  }
  pinTask(id: string, pinned: boolean): AppState {
    setTaskPinned(id,pinned); this.reloadSnapshot(); this.refresh();
    return this.getState();
  }
  removeTask(id: string): AppState {
    if (!getTask(id)) throw new Error('任务已不存在，请刷新后重试');
    deleteTask(id); this.reloadSnapshot(); this.refresh();
    return this.getState();
  }

  reopenTask(id: string): AppState {
    setTaskStatus(id, 'open');
    this.reloadSnapshot();
    this.refresh();
    return this.getState();
  }

  /**
   * 更新设置。
   *
   * `silent` 用于纯外观类设置（透明度、光感强度）：
   * 这类改动只影响渲染层，没必要重建整份状态并广播给所有窗口。
   * 拖滑块时会连续调用几十次，走 silent 路径才能不卡。
   */
  updateSettings(patch: Partial<AppSettings>, options: { silent?: boolean } = {}): AppSettings {
    const previous = this.settings;
    this.settings = { ...this.settings, ...patch };
    setLanguage(this.settings.language);
    setSettingsJson('app', this.settings);

    // 关掉自动排程要立刻把自动块清掉（手动的保留），
    // 否则广播给渲染层的状态里还带着刚失效的安排。
    const autoToggled = previous.autoSchedule !== this.settings.autoSchedule;
    if (autoToggled) {
      this.replan();
    }

    if (options.silent) return this.settings;

    this.refresh();
    return this.settings;
  }

  /** 把当前设置合并进已有状态并广播，供静默改动后同步给各窗口用 */
  broadcastSettings(): void {
    if (!this.state) {
      this.refresh();
      return;
    }
    // 注意必须连 `ui` 一起重算：悬浮窗的玻璃外观读的是 ui.glassTintAlpha，
    // 只更新 settings 的话玻璃不会有任何变化。
    const { ui: _ui, settings: _settings, plannerPrefs: _prefs, ...rest } = this.state;
    this.state = this.stateWithSettings(rest);
    this.emit('change', this.state);
  }

  /**
   * 给渲染层的设置对象。
   */
  private settingsForView(): AppSettingsView {
    const { plannerPrefs: _plannerPrefs, ...settingsView } = this.settings;
    return settingsView;
  }
  quickAdd(title: string, opts: { domain?: Task['domain']; urgency?: Urgency; dueAt?: string } = {}): AppState {
    const trimmed = title.trim();
    if (!trimmed) return this.getState();
    return this.updateTask({
      title: trimmed,
      domain: 'study',
      urgency: opts.urgency ?? 3,
      dueAt: opts.dueAt,
      estMinutes: 45
    });
  }

  /** 供调度器使用：当前快照里的任务 */
  getTasksSnapshot(): Task[] {
    return this.snapshot.tasks;
  }

  getAgendaSnapshot(): AgendaSnapshot {
    return this.snapshot;
  }

  getSettings(): AppSettings {
    return this.settings;
  }
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const store = new Store();
export { today };
