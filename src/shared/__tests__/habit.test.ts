/**
 * 自律打卡纯计算的测试。
 *
 * 重点是"某天算完成还是没完成""完成率怎么算""分级怎么标"这三件事的口径，
 * 它们一旦算错，用户看到的月视图颜色就是错的，而且不容易自己发现
 * （人会怀疑自己记错了，而不是怀疑软件算错了）。
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildDayDetail,
  buildMonthlyBoard,
  currentStreak,
  gradeOf,
  GRADE_COLORS,
  habitsDueOn,
  isHabitDueOn,
  monthBounds,
  padToFullWeeks,
  shiftMonth,
  type Habit,
  type HabitCheckin
} from '../habit';

/* ------------------------------------------------------------ 夹具 */

function habit(partial: Partial<Habit> & { id: string }): Habit {
  return {
    name: '习惯',
    icon: '⭐',
    color: '#4F7CFF',
    activeDays: [],
    startDate: '2026-10-01',
    sortOrder: 0,
    archived: false,
    ...partial
  };
}

const dailyHabit = habit({ id: 'h1', name: '早起' });
const weekdayHabit = habit({ id: 'h2', name: '跑步', activeDays: [1, 2, 3, 4, 5] });
const weekendHabit = habit({ id: 'h3', name: '整理房间', activeDays: [6, 7] });

/* ------------------------------------------------------------ 计划日 */

describe('habit: 某天是否要做', () => {
  it('activeDays 为空 = 每天都做', () => {
    assert.equal(isHabitDueOn(dailyHabit, '2026-10-08'), true);
    assert.equal(isHabitDueOn(dailyHabit, '2026-10-11'), true, '周日也算');
  });

  it('只在指定星期做', () => {
    // 2026-10-08 是周四（ISO 4）
    assert.equal(isHabitDueOn(weekdayHabit, '2026-10-08'), true, '周四要做');
    assert.equal(isHabitDueOn(weekdayHabit, '2026-10-11'), false, '周日不做');
    assert.equal(isHabitDueOn(weekendHabit, '2026-10-11'), true, '周日做');
    assert.equal(isHabitDueOn(weekendHabit, '2026-10-08'), false, '周四不做');
  });

  it('开始日期之前不算', () => {
    const late = habit({ id: 'h4', startDate: '2026-10-08' });
    assert.equal(isHabitDueOn(late, '2026-10-07'), false);
    assert.equal(isHabitDueOn(late, '2026-10-08'), true, '当天开始就算');
  });

  it('归档的习惯不计入', () => {
    const archived = habit({ id: 'h5', archived: true });
    assert.equal(isHabitDueOn(archived, '2026-10-08'), false);
    assert.equal(habitsDueOn([dailyHabit, archived], '2026-10-08').length, 1);
  });
});

/* ------------------------------------------------------------ 分级 */

describe('habit: 分级标色', () => {
  it('阈值正确：0 / <40 / 40-80 / 80-100 / 100', () => {
    assert.equal(gradeOf(0, 2), 'none');
    assert.equal(gradeOf(0.2, 5), 'low');
    assert.equal(gradeOf(0.5, 4), 'mid');
    assert.equal(gradeOf(0.8, 5), 'high');
    assert.equal(gradeOf(0.9, 5), 'high');
    assert.equal(gradeOf(1, 3), 'perfect');
  });

  it('用户明确要求：80% 及以上是蓝色，100% 是绿色', () => {
    assert.equal(GRADE_COLORS.high, '#4F7CFF', '80% 及以上应标蓝');
    assert.equal(GRADE_COLORS.perfect, '#12A594', '100% 应标绿');
  });

  it('当天没有安排时为 none，而不是用 0 除出个错误结果', () => {
    assert.equal(gradeOf(0, 0), 'none');
  });
});

/* ------------------------------------------------------------ 月视图 */

describe('habit: 月视图网格', () => {
  it('补齐到完整周（周一起始）', () => {
    // 2026-10-01 是周四，10-31 是周六
    const grid = padToFullWeeks('2026-10-01', '2026-10-31');
    assert.equal(grid[0], '2026-09-28', '首格应是所在周的周一');
    assert.equal(grid.length % 7, 0, '网格必须是整周');
  });

  it('月边界正确（含大小月）', () => {
    assert.deepEqual(monthBounds('2026-10'), { start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(monthBounds('2026-11'), { start: '2026-11-01', end: '2026-11-30' });
  });

  it('月视图累计完成率只统计"过去且有安排"的日子', () => {
    const habits = [dailyHabit];
    // 10-08 做了，10-01 到 10-07 都没做
    const checkins: HabitCheckin[] = [{ habitId: 'h1', date: '2026-10-08' }];
    const board = buildMonthlyBoard({
      month: '2026-10',
      habits,
      checkins,
      today: '2026-10-08'
    });

    // 只统计 10-01 到 10-08（今天），共 8 天，只有 1 天完成
    assert.equal(board.trackedDays, 8);
    assert.equal(board.totals.done, 1);
    assert.equal(board.totals.expected, 8);
    assert.equal(board.monthRatio, 1 / 8);
  });

  it('未来日期不参与统计（不会因为没到就拉低完成率）', () => {
    const board = buildMonthlyBoard({
      month: '2026-10',
      habits: [dailyHabit],
      checkins: [],
      today: '2026-10-08'
    });
    // 10-01 ~ 10-08 共 8 天，10-09 之后都是未来，不计入
    assert.equal(board.trackedDays, 8);
  });

  it('月视图按周分行，每行 7 格', () => {
    const board = buildMonthlyBoard({
      month: '2026-10',
      habits: [dailyHabit],
      checkins: [],
      today: '2026-10-08'
    });
    for (const week of board.weeks) assert.equal(week.length, 7);
    assert.equal(board.weeks.length, 5, '2026 年 10 月应占 5 行');
  });
});

/* ------------------------------------------------------------ 单日与连续 */

describe('habit: 单日明细与连续天数', () => {
  it('单日明细列出每个习惯的完成状态', () => {
    const detail = buildDayDetail('2026-10-08', [dailyHabit, weekdayHabit], [
      { habitId: 'h1', date: '2026-10-08' }
    ]);
    assert.equal(detail.cells.length, 2);
    assert.equal(detail.cells[0].done, true);
    assert.equal(detail.cells[1].done, false);
    assert.equal(detail.ratio, 0.5);
    assert.equal(detail.grade, 'mid');
  });

  it('连续天数：跳过"本来就不用做"的日子，遇到"该做没做"才断', () => {
    const habits = [dailyHabit];
    // 10-06、10-07、10-08 都做了，10-05 没做 → 连续 3 天
    const checkins = [
      { habitId: 'h1', date: '2026-10-06' },
      { habitId: 'h1', date: '2026-10-07' },
      { habitId: 'h1', date: '2026-10-08' }
    ];
    assert.equal(currentStreak(habits, checkins, '2026-10-08'), 3);
  });

  it('连续天数：今天没做完不断（当天尚未结束）', () => {
    const checkins = [
      { habitId: 'h1', date: '2026-10-06' },
      { habitId: 'h1', date: '2026-10-07' }
    ];
    // 今天 10-08 还没做，但不算断：连续应从昨天往前数
    assert.equal(currentStreak([dailyHabit], checkins, '2026-10-08'), 2);
  });

  it('平移月份（跨年）', () => {
    assert.equal(shiftMonth('2026-10', 1), '2026-11');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2027-01', -1), '2026-12');
  });
});
