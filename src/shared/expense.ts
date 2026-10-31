/**
 * 记账模块的纯计算：日 / 周 / 月结算、分类超支、柱状图数据。
 *
 * 全部是纯函数，不碰数据库、不碰界面，因此可以直接用 fixture 断言
 * "结余还是超支""周月汇总对不对"这类最容易算错的地方。
 *
 * 几个刻意的设计决定：
 *
 * 1. **只记支出**。用户明确选择"只记支出，柱状图只画花销"。
 *    数据结构因此是单向的，录入时不需要先选"收入还是支出"，路径最短。
 *
 * 2. **预算按天给，周/月预算是"每日目标 × 天数"**，而不是另存一个周预算。
 *    这样只有一个真相来源：改一次每日目标，周月结余自动跟着变，
 *    不会出现"日预算改了但周预算还是旧的"这种自相矛盾。
 *    副作用是同一分类在不同月份的预算总额不同（30 天 vs 31 天），
 *    这是符合直觉的，界面上会写明"按 N 天计"。
 *
 * 3. **超支只看"金额"，不看"笔数"**。一次 200 元的聚餐和十次 20 元的奶茶，
 *    对结余的影响不同，但对"今天还剩多少钱"的影响是一样的。
 */

import { addDays, daysBetween, mondayOf } from './time';

/* ------------------------------------------------------------------ 类型 */

export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** 每日目标额度（元）。0 表示不设目标，只统计不比较 */
  dailyTarget: number;
  sortOrder: number;
}

export interface ExpenseEntry {
  id: string;
  categoryId: string;
  /** YYYY-MM-DD */
  date: string;
  /** 金额（元），恒为正数，方向由"支出"语义决定 */
  amount: number;
  note?: string;
  createdAt: string;
}

export type ExpenseViewMode = 'day' | 'week' | 'month';

/** 某一分类在某区间内的表现 */
export interface CategoryBreakdown {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  total: number;
  /** 该区间内这一类别的预算总额 = dailyTarget × 天数 */
  budget: number;
  /** 正数为结余，负数为超支 */
  remaining: number;
  /** 是否已超出预算 */
  over: boolean;
  /** 占该类预算的比例；未设预算时为 0 */
  ratio: number;
  /** 注意：没有 count 字段——笔数由界面按需自己数，计算模块不关心 */
}

export interface DailyPoint {
  date: string;
  weekday: string;
  total: number;
  budget: number;
  over: boolean;
  /** 是否落在今天之后（柱状图上画成浅色占位） */
  future: boolean;
}

export interface ExpenseSummary {
  mode: ExpenseViewMode;
  /** 区间标题，例如「10月07日 周二」「10月06日 – 10月12日」「2026年10月」 */
  label: string;
  startDate: string;
  endDate: string;
  /** 区间天数，预算按它折算 */
  days: number;
  spent: number;
  /** 总预算 = 每日总预算 × 天数 */
  budget: number;
  /** 正数为结余，负数为超支 */
  remaining: number;
  over: boolean;
  /** 已花掉的比例（0~1+），柱状图与进度条用 */
  ratio: number;
  /** 日均花销（按区间天数） */
  dailyAverage: number;
  /** 今日花销（仅"周/月"视图用于对比） */
  todaySpent: number;
  /** 今日的总预算 */
  todayBudget: number;
  /** 今日是否超支 */
  todayOver: boolean;
  /** 分类明细，按金额从多到少 */
  byCategory: CategoryBreakdown[];
  /** 柱状图数据点：日视图是本日各分类，周/月视图是每天一根柱 */
  series: DailyPoint[];
  /** 超支的分类（金额上超出预算的） */
  overCategories: CategoryBreakdown[];
  /** 本期预算里来自"期初余额"的部分；为 0 表示预算来自按天折算 */
  openingBalance: number;
  /** 预算来源：期初余额 / 按天折算 / 未设 */
  budgetSource: 'opening' | 'daily' | 'none';
  /** 预算来源的可读说明，直接显示给用户 */
  budgetSourceLabel: string;
  /** 按当前日均花销推算，余额还能撑几天；不可推算时为 null */
  daysLeftEstimate: number | null;
}

/* ------------------------------------------------------------------ 区间 */

/** 金额保留两位小数，避免 0.1+0.2 这类浮点误差累积后显示成 12.299999 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 把金额格式化成 "12.30" 这样的字符串（不带货币符号） */
export function fmtAmount(n: number): string {
  return round2(n).toFixed(2);
}

/** 某个日期所在月的第一天与最后一天 */
export function monthRange(date: string): { start: string; end: string } {
  const [year, month] = date.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  // 下个月第 0 天 = 本月最后一天，交给 Date 处理闰年与大小月，不手写规则
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** 区间：日 = 当天；周 = 周一至周日；月 = 当月 */
export function rangeOf(mode: ExpenseViewMode, date: string): { start: string; end: string } {
  if (mode === 'day') return { start: date, end: date };
  if (mode === 'week') {
    const start = mondayOf(date);
    return { start, end: addDays(start, 6) };
  }
  return monthRange(date);
}

/** 生成区间内的每一天（含首尾） */
export function daysInRange(start: string, end: string): string[] {
  const count = daysBetween(start, end) + 1;
  const list: string[] = [];
  for (let i = 0; i < count; i += 1) list.push(addDays(start, i));
  return list;
}

/** 按模式平移日期：日 ±1 天、周 ±7 天、月 ±1 月 */
export function shiftDate(mode: ExpenseViewMode, date: string, delta: number): string {
  if (mode === 'day') return addDays(date, delta);
  if (mode === 'week') return addDays(date, delta * 7);
  const [year, month] = date.split('-').map(Number);
  const target = new Date(year, month - 1 + delta, 1);
  const day = Math.min(Number(date.slice(8, 10)), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ 结算 */

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

function weekdayLabel(date: string): string {
  const jsDay = new Date(`${date}T00:00`).getDay(); // 0=周日
  return WEEKDAY_CN[(jsDay + 6) % 7];
}

function labelOf(mode: ExpenseViewMode, start: string, end: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}月${d.slice(8, 10)}日`;
  if (mode === 'day') return `${md(start)} 周${weekdayLabel(start)}`;
  if (mode === 'week') return `${md(start)} – ${md(end)}`;
  return `${start.slice(0, 4)}年${Number(start.slice(5, 7))}月`;
}

export interface BuildSummaryInput {
  mode: ExpenseViewMode;
  /** 作为区间基准的日期（视图当前停留的那天） */
  anchorDate: string;
  /** 今天，用于标注"未来"的柱子与今日对比 */
  today: string;
  categories: ExpenseCategory[];
  entries: ExpenseEntry[];
  /** 每日总预算。0 表示不设总目标 */
  totalDailyBudget: number;
  /**
   * 基准日期所在月的**期初余额**（用户月初自己填的生活费）。
   * 一旦提供，它就是该月的预算来源，优先级高于「每日总预算 × 天数」——
   * 因为"我这个月有 2000 块"比"每天 70 块 × 30 天"更贴近真实可动用的钱。
   * 未提供（该月没填）时自动退回按天折算，避免忘了填就完全没有预算。
   */
  openingBalance?: number;
  /** 该月期初余额是否由用户显式设置过（用于界面说明预算来源） */
  hasOpeningBalance?: boolean;
}

/**
 * 解析某个区间的预算，并说明它是怎么来的。
 *
 * 抽成独立函数的原因：日/周/月的区间可能**跨月**，
 * 这时"用哪个月的期初余额"就成了必须明确的规则。这里定的规则是：
 *   · 单月区间（日、月，以及不跨月的周）→ 用该月的期初余额
 *   · 跨月区间 → 退回按天折算
 * 之所以不把两个月余额相加：那需要按天拆分归属，规则复杂且容易让用户困惑
 * （"我的周预算是 500，可这个月只过了 3 天"）。宁可退回一个可解释的口径。
 */
export function resolveBudget(input: {
  start: string;
  end: string;
  days: number;
  totalDailyBudget: number;
  openingBalance?: number;
  hasOpeningBalance?: boolean;
}): { budget: number; source: 'opening' | 'daily' | 'none' } {
  const startMonth = input.start.slice(0, 7);
  const endMonth = input.end.slice(0, 7);
  const sameMonth = startMonth === endMonth;
  const hasOpening = input.hasOpeningBalance === true && Number.isFinite(input.openingBalance);

  if (sameMonth && hasOpening) {
    return { budget: round2(Math.max(0, input.openingBalance as number)), source: 'opening' };
  }
  if (input.totalDailyBudget > 0) {
    return { budget: round2(input.totalDailyBudget * input.days), source: 'daily' };
  }
  return { budget: 0, source: 'none' };
}

/** 预算来源的界面说明文案 */
export function budgetSourceLabel(source: 'opening' | 'daily' | 'none', days: number): string {
  if (source === 'opening') return '本月期初余额';
  if (source === 'daily') return `每日总预算 × ${days} 天`;
  return '未设预算';
}

export function buildExpenseSummary(input: BuildSummaryInput): ExpenseSummary {
  const { mode, anchorDate, today, categories, entries, totalDailyBudget } = input;
  const { start, end } = rangeOf(mode, anchorDate);
  const days = daysBetween(start, end) + 1;

  const inRange = entries.filter((e) => e.date >= start && e.date <= end);
  const spent = round2(inRange.reduce((sum, e) => sum + e.amount, 0));

  const resolved = resolveBudget({
    start,
    end,
    days,
    totalDailyBudget,
    openingBalance: input.openingBalance,
    hasOpeningBalance: input.hasOpeningBalance
  });
  const budget = resolved.budget;
  const remaining = round2(budget - spent);
  // 未设预算时不算比例，避免出现"除以 0"或误导性的百分比
  const ratio = budget > 0 ? spent / budget : 0;
  const opening = resolved.source === 'opening' ? budget : 0;

  // 分类明细：即使某分类本期没花钱也保留，这样"目标还在、花销为 0"一眼可见。
  // 注意分类目标仍按「每日目标 × 天数」算，不受期初余额影响：
  // 期初余额是"这个月总共能花多少"，分类目标是"这一类每天大概花多少"，两者维度不同。
  const byCategory: CategoryBreakdown[] = categories
    .map((category) => {
      const total = round2(
        inRange.filter((e) => e.categoryId === category.id).reduce((sum, e) => sum + e.amount, 0)
      );
      const categoryBudget = round2(category.dailyTarget * days);
      return {
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        total,
        budget: categoryBudget,
        remaining: round2(categoryBudget - total),
        // 只有设了目标才谈"超出"；目标是 0 的分类只统计
        over: category.dailyTarget > 0 && total > categoryBudget,
        ratio: categoryBudget > 0 ? total / categoryBudget : 0
      };
    })
    // 花得多的排前面，方便一眼看到钱去哪了
    .sort((a, b) => b.total - a.total || a.categoryId.localeCompare(b.categoryId));

  /*
   * 柱状图的参考线：一律是"每天能用多少"，好让每根日柱都有可比的标准。
   *
   * 这里必须用**区间开始那天所在的整月**来解析预算，而不是直接用区间的 start–end：
   * 月视图的区间本身就是整月，直接拿它算会得到"整月预算"（例如 2000），
   * 用它当每日参考线会让所有柱子都趴在地上，完全失去意义。
   * 正确做法是取出该月的期初余额，再摊到当月天数。
   */
  const monthStart = `${start.slice(0, 7)}-01`;
  const monthResolved = resolveBudget({
    start: monthStart,
    end: monthStart,
    days: 1,
    totalDailyBudget,
    openingBalance: input.openingBalance,
    hasOpeningBalance: input.hasOpeningBalance
  });
  const dailyReference =
    monthResolved.source === 'opening'
      ? round2(monthResolved.budget / daysInMonthOf(monthStart))
      : round2(Math.max(0, totalDailyBudget));

  const series: DailyPoint[] =
    mode === 'day'
      ? byCategory
          .filter((c) => c.total > 0 || c.budget > 0)
          .map((c) => ({
            date: start,
            weekday: c.name,
            total: c.total,
            budget: c.budget,
            over: c.over,
            future: false
          }))
      : daysInRange(start, end).map((date) => {
          const total = round2(entries.filter((e) => e.date === date).reduce((sum, e) => sum + e.amount, 0));
          return {
            date,
            weekday: weekdayLabel(date),
            total,
            budget: dailyReference,
            over: dailyReference > 0 && total > dailyReference,
            future: date > today
          };
        });

  const todaySpent = round2(entries.filter((e) => e.date === today).reduce((sum, e) => sum + e.amount, 0));
  const todayBudget = dailyReference;

  return {
    mode,
    label: labelOf(mode, start, end),
    startDate: start,
    endDate: end,
    days,
    spent,
    budget,
    remaining,
    over: budget > 0 && spent > budget,
    ratio,
    dailyAverage: days > 0 ? round2(spent / days) : spent,
    todaySpent,
    todayBudget,
    todayOver: todayBudget > 0 && todaySpent > todayBudget,
    byCategory,
    series,
    overCategories: byCategory.filter((c) => c.over),
    openingBalance: opening,
    budgetSource: resolved.source,
    budgetSourceLabel: budgetSourceLabel(resolved.source, days),
    /** 按当前日均花销推算，期初余额还能撑几天；余额为 0 或不适用时返回 null */
    daysLeftEstimate: (() => {
      if (opening <= 0) return null;
      if (remaining <= 0) return 0;
      // 用"本区间已过天数"的日均推算；当天也算一天，避免除以 0
      const elapsed = Math.max(1, Math.min(days, daysBetween(start, today) + 1));
      const perDay = spent > 0 ? spent / elapsed : 0;
      if (perDay <= 0) return null;
      return Math.floor(remaining / perDay);
    })()
  };
}

/** 某天所在月共有多少天（用于把月预算摊成日均参考线） */
function daysInMonthOf(date: string): number {
  const range = monthRange(date);
  return daysBetween(range.start, range.end) + 1;
}

/**
 * 在给定日期上累加一笔金额，返回新的流水数组。
 * 单纯为了在测试里构造场景方便，界面不直接用。
 */
export function withEntry(entries: ExpenseEntry[], entry: ExpenseEntry): ExpenseEntry[] {
  return [...entries, entry];
}
