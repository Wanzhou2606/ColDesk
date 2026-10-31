/**
 * 自律打卡的纯计算：月视图数据、当日完成率、分级标色。
 *
 * 全部是纯函数，因此"某天算完成还是没完成""百分比怎么算"这些
 * 最容易口径不一致的地方可以直接用 fixture 断言。
 *
 * 三个刻意的设计决定：
 *
 * 1. **完成率的分母只数"当天该做的"**。
 *    不是每天都做的习惯（比如只在周一三五），
 *    在周二不该拉低当天的完成率——否则用户会觉得自己"天天没做完"。
 *
 * 2. **没打卡的日子用中性灰，不用红色**。
 *    一开始什么都没有（或某天忘了打开）就用红色警告，会让人产生挫败感，
 *    这跟"自律打卡"想达到的效果正好相反。灰色表示"这天没有记录"，
 *    红色只在"做了但完成得很少"时出现。
 *
 * 3. **分级只由完成率决定，配色不参与判断**。
 *    分数与颜色分开，将来想换配色不用动逻辑，测试也不用跟着改。
 */

import { addDays, daysBetween } from './time';

/* ------------------------------------------------------------------ 类型 */

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** 每周哪几天要做：1=周一 … 7=周日。空数组视为每天 */
  activeDays: number[];
  /** 从哪一天开始（此前的日期不参与统计） */
  startDate: string;
  sortOrder: number;
  archived: boolean;
}

export interface HabitCheckin {
  habitId: string;
  /** YYYY-MM-DD */
  date: string;
}

/** 完成度分级：none 表示当天没有可用记录 */
export type DayGrade = 'none' | 'low' | 'mid' | 'high' | 'perfect';

export interface DayCell {
  date: string;
  /** 当天应做的习惯数（分母） */
  total: number;
  /** 当天已打卡数（分子） */
  done: number;
  /** 完成率 0~1；total 为 0 时是 0 */
  ratio: number;
  grade: DayGrade;
  /** 是否属于展示的月份（月视图首尾会补上相邻月的日期） */
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface MonthlyBoard {
  /** YYYY-MM */
  month: string;
  label: string;
  /** 完整的周网格：从所在周周一开始，到所在周周日结束 */
  weeks: DayCell[][];
  /** 本月已过去的、有记录需求的天数 */
  trackedDays: number;
  /** 本月累计完成率（各天 done 之和 / 各天 total 之和） */
  monthRatio: number;
  /** 各分级的天数分布，用于图例与"这个月怎么样"的一句话总结 */
  gradeCounts: Record<DayGrade, number>;
  /** 本月习惯的总体统计 */
  totals: { done: number; expected: number };
}

/* ------------------------------------------------------------------ 分级 */

/**
 * 完成率 → 分级。
 *
 * 阈值：0 未开始 / <40% 低 / 40~80% 中 / 80~100% 高 / 100% 完成。
 * 用户明确要求"完成 80% 以上标蓝色、100% 标绿色"，这里是那条要求的实现。
 */
export function gradeOf(ratio: number, total: number): DayGrade {
  if (total <= 0) return 'none';
  if (ratio >= 1) return 'perfect';
  if (ratio >= 0.8) return 'high';
  if (ratio >= 0.4) return 'mid';
  if (ratio > 0) return 'low';
  return 'none';
}

/** 分级 → 展示用色（与 CSS 里的变量名保持一致，界面只读这里的映射） */
export const GRADE_COLORS: Record<DayGrade, string> = {
  none: 'transparent',
  low: '#EB5757',
  mid: '#F2994A',
  high: '#4F7CFF',
  perfect: '#12A594'
};

export const GRADE_LABELS: Record<DayGrade, string> = {
  none: '未开始',
  low: '不足 40%',
  mid: '40% ~ 80%',
  high: '80% 及以上',
  perfect: '全部完成'
};

/* ------------------------------------------------------------------ 计划 */

/** 某一天是否要做某个习惯 */
export function isHabitDueOn(habit: Habit, date: string): boolean {
  if (habit.archived) return false;
  // 还没开始的习惯不参与；这样"今天新建的习惯"不会让过去的日子变成未完成
  if (date < habit.startDate) return false;
  if (habit.activeDays.length === 0) return true;
  const jsDay = new Date(`${date}T00:00`).getDay(); // 0=周日
  const iso = jsDay === 0 ? 7 : jsDay;
  return habit.activeDays.includes(iso);
}

/** 某一天需要做的习惯 */
export function habitsDueOn(habits: Habit[], date: string): Habit[] {
  return habits.filter((habit) => isHabitDueOn(habit, date));
}

/* ------------------------------------------------------------------ 月视图 */

export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

export function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** 把日期网格向两端补齐到完整周（周一起始），月视图才不会是残缺的矩形 */
export function padToFullWeeks(start: string, end: string): string[] {
  const jsStart = new Date(`${start}T00:00`).getDay();
  const lead = jsStart === 0 ? 6 : jsStart - 1;
  const gridStart = addDays(start, -lead);

  const jsEnd = new Date(`${end}T00:00`).getDay();
  const trail = jsEnd === 0 ? 0 : 7 - jsEnd;
  const gridEnd = addDays(end, trail);

  const total = daysBetween(gridStart, gridEnd) + 1;
  return Array.from({ length: total }, (_, i) => addDays(gridStart, i));
}

export interface BuildBoardInput {
  month: string;
  habits: Habit[];
  checkins: HabitCheckin[];
  today: string;
}

export function buildMonthlyBoard(input: BuildBoardInput): MonthlyBoard {
  const { month, habits, checkins, today } = input;
  const { start, end } = monthBounds(month);
  const grid = padToFullWeeks(start, end);

  // 用 Set 做 O(1) 查询，避免在"天数 × 习惯数"的两层循环里反复扫数组
  const doneSet = new Set(checkins.map((c) => `${c.date}|${c.habitId}`));

  const gradeCounts: Record<DayGrade, number> = { none: 0, low: 0, mid: 0, high: 0, perfect: 0 };
  let monthDone = 0;
  let monthExpected = 0;
  let trackedDays = 0;

  const cells: DayCell[] = grid.map((date) => {
    const due = habitsDueOn(habits, date);
    const done = due.filter((h) => doneSet.has(`${date}|${h.id}`)).length;
    const total = due.length;
    const ratio = total > 0 ? done / total : 0;
    const inMonth = date >= start && date <= end;

    // 未来日期不参与统计，否则"这个月完成率"会因为还没到的日子被拉低
    const isFuture = date > today;
    const counted = inMonth && !isFuture && total > 0;

    if (counted) {
      trackedDays += 1;
      monthDone += done;
      monthExpected += total;
      gradeCounts[gradeOf(ratio, total)] += 1;
    }

    return {
      date,
      total,
      done,
      ratio,
      grade: gradeOf(ratio, total),
      inMonth,
      isToday: date === today,
      isFuture
    };
  });

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    month,
    label: `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`,
    weeks,
    trackedDays,
    monthRatio: monthExpected > 0 ? monthDone / monthExpected : 0,
    gradeCounts,
    totals: { done: monthDone, expected: monthExpected }
  };
}

/* ------------------------------------------------------------------ 单日 */

export interface DayDetail {
  date: string;
  cells: Array<{ habit: Habit; done: boolean }>;
  ratio: number;
  grade: DayGrade;
}

/** 某一天的打卡明细：哪些做了、哪些没做（用于"今天"那一栏） */
export function buildDayDetail(
  date: string,
  habits: Habit[],
  checkins: HabitCheckin[]
): DayDetail {
  const doneSet = new Set(checkins.filter((c) => c.date === date).map((c) => c.habitId));
  const cells = habitsDueOn(habits, date).map((habit) => ({ habit, done: doneSet.has(habit.id) }));
  const done = cells.filter((c) => c.done).length;
  const ratio = cells.length > 0 ? done / cells.length : 0;
  return { date, cells, ratio, grade: gradeOf(ratio, cells.length) };
}

/** 连续打卡天数：从今天往回数，直到某天"该做的没做全"为止 */
export function currentStreak(habits: Habit[], checkins: HabitCheckin[], today: string): number {
  const doneSet = new Set(checkins.map((c) => `${c.date}|${c.habitId}`));
  let streak = 0;
  let cursor = today;

  // 上限一年，防止数据异常时无限循环
  for (let i = 0; i < 366; i += 1) {
    const due = habitsDueOn(habits, cursor);
    if (due.length === 0) {
      // 这天本来就不用做，跳过而不是中断
      cursor = addDays(cursor, -1);
      continue;
    }
    const allDone = due.every((h) => doneSet.has(`${cursor}|${h.id}`));
    // 今天还没做完不算断：当天尚未结束，逼着用户现在就完成不合理
    if (!allDone) {
      if (cursor === today) {
        cursor = addDays(cursor, -1);
        continue;
      }
      break;
    }
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 平移月份（月视图左右翻页） */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
