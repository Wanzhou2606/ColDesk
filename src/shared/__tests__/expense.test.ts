/**
 * 记账结算的计算测试。
 *
 * 这个模块全是纯函数，所以可以直接构造场景断言"到底是结余还是超支"——
 * 这类判断一旦算错，用户看到的数字就是错的，而且不容易自己发现
 * （人会怀疑自己记错了，而不是怀疑软件算错了）。
 *
 * 重点覆盖三类容易出错的边界：
 *   1. 周/月的区间边界（跨月、跨年、闰年 2 月）
 *   2. 预算折算（每日目标 × 天数，30 天与 31 天不同）
 *   3. 浮点误差（0.1 + 0.2 不能显示成 0.30000000000000004）
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildExpenseSummary,
  daysInRange,
  fmtAmount,
  monthRange,
  rangeOf,
  resolveBudget,
  round2,
  shiftDate,
  type ExpenseCategory,
  type ExpenseEntry
} from '../expense';

/* ------------------------------------------------------------ 夹具 */

const CATS: ExpenseCategory[] = [
  { id: 'c1', name: '餐饮', icon: '🍚', color: '#F2994A', dailyTarget: 30, sortOrder: 0 },
  { id: 'c2', name: '饮料', icon: '🧋', color: '#EB5757', dailyTarget: 10, sortOrder: 1 },
  // 不设目标的分类：只统计，不该出现在"超支"里
  { id: 'c3', name: '其它', icon: '📦', color: '#828282', dailyTarget: 0, sortOrder: 2 }
];

let seq = 0;
function entry(date: string, categoryId: string, amount: number, note = ''): ExpenseEntry {
  seq += 1;
  return { id: `e${seq}`, categoryId, date, amount, note, createdAt: `${date}T12:00` };
}

const TOTAL_BUDGET = 50;

function summary(mode: 'day' | 'week' | 'month', anchorDate: string, today: string, entries: ExpenseEntry[]) {
  return buildExpenseSummary({
    mode,
    anchorDate,
    today,
    categories: CATS,
    entries,
    totalDailyBudget: TOTAL_BUDGET
  });
}

/* ------------------------------------------------------------ 区间 */

describe('expense: 区间计算', () => {
  it('日区间就是当天', () => {
    assert.deepEqual(rangeOf('day', '2026-10-08'), { start: '2026-10-08', end: '2026-10-08' });
  });

  it('周区间是周一到周日', () => {
    // 2026-10-08 是周四
    assert.deepEqual(rangeOf('week', '2026-10-08'), { start: '2026-10-05', end: '2026-10-11' });
    // 周一当天也应落在同一周
    assert.deepEqual(rangeOf('week', '2026-10-05'), { start: '2026-10-05', end: '2026-10-11' });
    // 周日应归到这一周的最后一天，而不是下一周
    assert.deepEqual(rangeOf('week', '2026-10-11'), { start: '2026-10-05', end: '2026-10-11' });
  });

  it('月区间处理大小月与闰年 2 月', () => {
    assert.deepEqual(monthRange('2026-10-08'), { start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(monthRange('2026-11-15'), { start: '2026-11-01', end: '2026-11-30' });
    // 2028 是闰年
    assert.deepEqual(monthRange('2028-02-10'), { start: '2028-02-01', end: '2028-02-29' });
    // 2026 不是闰年
    assert.deepEqual(monthRange('2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  });

  it('按模式平移日期', () => {
    assert.equal(shiftDate('day', '2026-10-08', 1), '2026-10-09');
    assert.equal(shiftDate('day', '2026-10-08', -1), '2026-10-07');
    assert.equal(shiftDate('week', '2026-10-08', 1), '2026-10-15');
    assert.equal(shiftDate('month', '2026-10-08', 1), '2026-11-08');
    assert.equal(shiftDate('month', '2026-10-08', -1), '2026-09-08');
  });

  it('跨年平移不出错', () => {
    assert.equal(shiftDate('month', '2026-12-15', 1), '2027-01-15');
    assert.equal(shiftDate('month', '2027-01-15', -1), '2026-12-15');
    assert.equal(shiftDate('week', '2026-12-30', 1), '2027-01-06');
  });

  it('月末平移时日期被夹到目标月的最后一天', () => {
    // 1月31日往后一个月：2月没有31日，应落在2月最后一天而不是溢出到3月
    assert.equal(shiftDate('month', '2026-01-31', 1), '2026-02-28');
    // 8月31日往后一个月 → 9月30日
    assert.equal(shiftDate('month', '2026-08-31', 1), '2026-09-30');
  });

  it('区间天数正确（含首尾）', () => {
    assert.equal(daysInRange('2026-10-05', '2026-10-11').length, 7);
    assert.equal(daysInRange('2026-10-05', '2026-10-05').length, 1);
    assert.equal(daysInRange('2026-10-01', '2026-10-31').length, 31);
  });
});

/* ------------------------------------------------------------ 结算 */

describe('expense: 结余与超支', () => {
  it('日视图：花费低于预算为结余', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [
      entry('2026-10-08', 'c1', 18.5),
      entry('2026-10-08', 'c2', 9)
    ]);
    assert.equal(s.spent, 27.5);
    assert.equal(s.budget, 50);
    assert.equal(s.remaining, 22.5);
    assert.equal(s.over, false);
  });

  it('日视图：花费超过预算为超支，remaining 是负数', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c1', 62)]);
    assert.equal(s.remaining, -12);
    assert.equal(s.over, true);
  });

  it('恰好花完预算不算超支（边界）', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c1', 50)]);
    assert.equal(s.remaining, 0);
    assert.equal(s.over, false, '刚好用完不应报超支');
  });

  it('周视图：预算是每日预算 × 7', () => {
    const s = summary('week', '2026-10-08', '2026-10-08', [
      entry('2026-10-05', 'c1', 40),
      entry('2026-10-08', 'c1', 35)
    ]);
    assert.equal(s.days, 7);
    assert.equal(s.budget, 350);
    assert.equal(s.spent, 75);
    assert.equal(s.remaining, 275);
  });

  it('月视图：预算是每日预算 × 当月天数', () => {
    const oct = summary('month', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c1', 100)]);
    assert.equal(oct.days, 31);
    assert.equal(oct.budget, 1550);

    const nov = summary('month', '2026-11-08', '2026-11-08', [entry('2026-11-08', 'c1', 100)]);
    assert.equal(nov.days, 30);
    assert.equal(nov.budget, 1500, '不同月份天数不同，预算也应不同');
  });

  it('只统计区间内的流水', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [
      entry('2026-10-07', 'c1', 999), // 昨天，不该算进来
      entry('2026-10-08', 'c1', 20),
      entry('2026-10-09', 'c1', 888) // 明天，不该算进来
    ]);
    assert.equal(s.spent, 20);
  });

  it('未设总预算时不判超支、也不给误导性的比例', () => {
    const s = buildExpenseSummary({
      mode: 'day',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [entry('2026-10-08', 'c1', 500)],
      totalDailyBudget: 0
    });
    assert.equal(s.budget, 0);
    assert.equal(s.over, false, '没有预算就谈不上超支');
    assert.equal(s.ratio, 0, '预算为 0 时不应产生"花掉了百分之多少"的误导数字');
  });
});

/* ------------------------------------------------------------ 分类 */

describe('expense: 分类明细与超支', () => {
  it('分类预算 = 每日目标 × 天数，超出即标记', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [
      entry('2026-10-08', 'c1', 45), // 餐饮目标 30 → 超 15
      entry('2026-10-08', 'c2', 6) //  饮料目标 10 → 结余 4
    ]);
    const meal = s.byCategory.find((c) => c.categoryId === 'c1')!;
    const drink = s.byCategory.find((c) => c.categoryId === 'c2')!;

    assert.equal(meal.budget, 30);
    assert.equal(meal.remaining, -15);
    assert.equal(meal.over, true);
    assert.equal(drink.remaining, 4);
    assert.equal(drink.over, false);

    assert.deepEqual(s.overCategories.map((c) => c.categoryId), ['c1']);
  });

  it('不设目标的分类永远不会被判为超支', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c3', 500)]);
    const other = s.byCategory.find((c) => c.categoryId === 'c3')!;
    assert.equal(other.total, 500, '金额照常统计');
    assert.equal(other.over, false, '但没有目标就不能说它"超支"');
  });

  it('没花过钱的分类也保留在明细里（能看出目标还在）', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c1', 10)]);
    assert.equal(s.byCategory.length, CATS.length, '所有分类都应出现，零花销也不例外');
    const drink = s.byCategory.find((c) => c.categoryId === 'c2')!;
    assert.equal(drink.total, 0);
    assert.equal(drink.remaining, 10);
  });

  it('分类按金额从多到少排序', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [
      entry('2026-10-08', 'c2', 5),
      entry('2026-10-08', 'c1', 50)
    ]);
    assert.deepEqual(s.byCategory.map((c) => c.categoryId).slice(0, 2), ['c1', 'c2']);
  });
});

/* ------------------------------------------------------------ 柱状图 */

describe('expense: 柱状图数据', () => {
  it('日视图按分类出柱', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [
      entry('2026-10-08', 'c1', 20),
      entry('2026-10-08', 'c2', 5)
    ]);
    const bar = s.series.find((p) => p.weekday === '餐饮')!;
    assert.equal(bar.total, 20);
    assert.equal(bar.budget, 30, '每根柱的参考线是这一类自己的每日目标');
  });

  it('周视图按天出柱，共 7 根，且标注未来', () => {
    const s = summary('week', '2026-10-08', '2026-10-08', [entry('2026-10-05', 'c1', 30)]);
    assert.equal(s.series.length, 7);
    assert.equal(s.series[0].date, '2026-10-05');

    const monday = s.series[0];
    assert.equal(monday.total, 30);
    assert.equal(monday.future, false);

    // 10-09 之后都还没到（today 是 10-08）
    assert.equal(s.series.find((p) => p.date === '2026-10-08')!.future, false, '今天不算未来');
    assert.equal(s.series.find((p) => p.date === '2026-10-09')!.future, true);
    assert.equal(s.series.find((p) => p.date === '2026-10-11')!.future, true);
  });

  it('月视图出满整月天数', () => {
    const s = summary('month', '2026-10-08', '2026-10-08', []);
    assert.equal(s.series.length, 31);
    assert.equal(s.series[0].date, '2026-10-01');
    assert.equal(s.series[30].date, '2026-10-31');
  });

  it('某天超出每日总预算时该柱被标记', () => {
    const s = summary('week', '2026-10-08', '2026-10-08', [
      entry('2026-10-05', 'c1', 80) // 超过每日总预算 50
    ]);
    assert.equal(s.series[0].over, true);
    assert.equal(s.series[1].over, false);
  });
});

/* ------------------------------------------------------------ 今日 / 均值 */

describe('expense: 今日花销与日均', () => {
  it('今日花销独立于所选区间', () => {
    // 视图停在 9 月，但"今天"是 10-08，仍应算出今天的实际花销
    const s = summary('month', '2026-09-15', '2026-10-08', [entry('2026-10-08', 'c1', 33)]);
    assert.equal(s.spent, 0, '9 月的区间里没有流水');
    assert.equal(s.todaySpent, 33);
    assert.equal(s.todayBudget, 50);
    assert.equal(s.todayOver, false);
  });

  it('今日超支会被标出', () => {
    const s = summary('day', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c1', 70)]);
    assert.equal(s.todayOver, true);
  });

  it('日均按区间天数折算', () => {
    const s = summary('week', '2026-10-08', '2026-10-08', [entry('2026-10-05', 'c1', 70)]);
    assert.equal(s.dailyAverage, 10, '70 元 / 7 天 = 10');
  });
});

/* ------------------------------------------------------------ 数值 */

describe('expense: 金额精度', () => {
  it('浮点累加不产生长尾小数', () => {
    // 0.1 + 0.2 在 IEEE754 下是 0.30000000000000004
    assert.equal(round2(0.1 + 0.2), 0.3);
    assert.equal(fmtAmount(0.1 + 0.2), '0.30');
  });

  it('多笔零钱的合计仍然干净', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry('2026-10-08', 'c1', 0.1 + i * 0.01));
    const s = summary('day', '2026-10-08', '2026-10-08', entries);
    assert.equal(fmtAmount(s.spent), '1.45');
    // 结余也必须跟着干净，不能出现 -0.00000000000001 之类
    assert.equal(fmtAmount(s.remaining), '48.55');
  });

  it('金额始终显示两位小数', () => {
    assert.equal(fmtAmount(12), '12.00');
    assert.equal(fmtAmount(12.5), '12.50');
    assert.equal(fmtAmount(12.567), '12.57');
  });
});

/* ------------------------------------------------------------ 标签 */

describe('expense: 区间标题', () => {
  it('带星期', () => {
    assert.equal(summary('day', '2026-10-08', '2026-10-08', []).label, '10月08日 周四');
  });

  it('周标题是起止日期', () => {
    assert.equal(summary('week', '2026-10-08', '2026-10-08', []).label, '10月05日 – 10月11日');
  });

  it('月标题带年份', () => {
    assert.equal(summary('month', '2026-10-08', '2026-10-08', []).label, '2026年10月');
  });
});

/* ------------------------------------------------------------ 期初余额 */

describe('expense: 期初余额与预算口径', () => {
  it('没填期初余额时退回"每日总预算 × 天数"', () => {
    const r = resolveBudget({ start: '2026-10-01', end: '2026-10-31', days: 31, totalDailyBudget: 50 });
    assert.equal(r.source, 'daily');
    assert.equal(r.budget, 1550);
  });

  it('填了期初余额时优先用它，而不是按天折算', () => {
    const r = resolveBudget({
      start: '2026-10-01',
      end: '2026-10-31',
      days: 31,
      totalDailyBudget: 50,
      openingBalance: 2000,
      hasOpeningBalance: true
    });
    assert.equal(r.source, 'opening');
    assert.equal(r.budget, 2000, '月预算就是用户月初填的那个数');
  });

  it('期初余额为 0 也算"填过"，不会退回按天折算', () => {
    // 用户可能月初确实一分钱没有；这时候按天折算出一个预算反而是错的
    const r = resolveBudget({
      start: '2026-10-01',
      end: '2026-10-31',
      days: 31,
      totalDailyBudget: 50,
      openingBalance: 0,
      hasOpeningBalance: true
    });
    assert.equal(r.source, 'opening');
    assert.equal(r.budget, 0);
  });

  it('跨月区间退回按天折算（不把两个月余额相加）', () => {
    // 9月28日 – 10月4日 横跨两个月
    const r = resolveBudget({
      start: '2026-09-28',
      end: '2026-10-04',
      days: 7,
      totalDailyBudget: 50,
      openingBalance: 2000,
      hasOpeningBalance: true
    });
    assert.equal(r.source, 'daily', '跨月时余额归属无法简单拆分，退回可解释的口径');
    assert.equal(r.budget, 350);
  });

  it('既没期初余额也没每日预算时预算为 0，且不判超支', () => {
    const s = buildExpenseSummary({
      mode: 'month',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [entry('2026-10-08', 'c1', 999)],
      totalDailyBudget: 0
    });
    assert.equal(s.budgetSource, 'none');
    assert.equal(s.budget, 0);
    assert.equal(s.over, false);
  });

  it('月视图用期初余额算结余', () => {
    const s = buildExpenseSummary({
      mode: 'month',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [entry('2026-10-03', 'c1', 100), entry('2026-10-08', 'c2', 120)],
      totalDailyBudget: 50,
      openingBalance: 2000,
      hasOpeningBalance: true
    });
    assert.equal(s.budget, 2000);
    assert.equal(s.spent, 220);
    assert.equal(s.remaining, 1780);
    assert.equal(s.openingBalance, 2000);
    assert.equal(s.budgetSource, 'opening');
    assert.equal(s.budgetSourceLabel, '本月期初余额');
  });

  it('填了期初余额后，柱状图的参考线改成"月预算摊到当月天数"', () => {
    // 10月有31天：2000 / 31 ≈ 64.52
    const s = buildExpenseSummary({
      mode: 'month',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [],
      totalDailyBudget: 50,
      openingBalance: 2000,
      hasOpeningBalance: true
    });
    assert.equal(s.series[0].budget, 64.52, '参考线应与结算卡的预算口径一致');
  });

  it('日视图里"今日预算"也遵循同一口径', () => {
    const s = buildExpenseSummary({
      mode: 'day',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [],
      totalDailyBudget: 50,
      openingBalance: 3100,
      hasOpeningBalance: true
    });
    // 3100 / 31 = 100
    assert.equal(s.todayBudget, 100);
  });

  it('按当前日均推算余额还能撑几天', () => {
    const s = buildExpenseSummary({
      mode: 'month',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [
        // 10月1日到8日（8 天）花了 400，日均 50；余额 2000 - 400 = 1600
        entry('2026-10-01', 'c1', 200),
        entry('2026-10-08', 'c1', 200)
      ],
      totalDailyBudget: 0,
      openingBalance: 2000,
      hasOpeningBalance: true
    });
    assert.equal(s.spent, 400);
    assert.equal(s.remaining, 1600);
    assert.equal(s.daysLeftEstimate, 32, '1600 / 50 = 32 天');
  });

  it('没有期初余额时不推算剩余天数（该口径不适用）', () => {
    const s = summary('month', '2026-10-08', '2026-10-08', [entry('2026-10-08', 'c1', 10)]);
    assert.equal(s.daysLeftEstimate, null);
  });

  it('余额已超支时剩余天数记 0，不返回负数', () => {
    const s = buildExpenseSummary({
      mode: 'month',
      anchorDate: '2026-10-08',
      today: '2026-10-08',
      categories: CATS,
      entries: [entry('2026-10-08', 'c1', 2500)],
      totalDailyBudget: 0,
      openingBalance: 2000,
      hasOpeningBalance: true
    });
    assert.equal(s.daysLeftEstimate, 0);
    assert.equal(s.over, true);
  });
});
