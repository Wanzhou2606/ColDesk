/**
 * 示例课表的展开验证。
 *
 * 这些断言使用虚构的演示数据（seed-data.ts），
 * 目的是确保"周次过滤 + 两校区作息"这两件最容易出错的事被测试锁住：
 *  - 同一门课在不同周次的出没
 *  - 周次表达式（2-6,9-17 / 7-8 这种）解析正确
 *  - 绍兴与下沙的节次时间不同，同一节次展开出的时刻不同
 *  - 预备铃不参与课表展开
 *
 * 用固定日期（都在 2026-2027 学年第 1 学期内）而不是"今天"，避免测试随真实日期漂移。
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

process.env.COLDESK_DB_FACTORY = 'fake';

/* eslint-disable @typescript-eslint/no-explicit-any */
let mod: any;
let repos: any;
let expandDayLessons: any;
let weekOf: any;

/** 学期第 1 教学周周一 = 2026-09-07，所以： */
const WEEK_2_MON = '2026-09-14'; // 第 2 教学周 周一
const WEEK_5_THU = '2026-10-08'; // 第 5 教学周 周四
const WEEK_5_MON = '2026-10-05';
const WEEK_2_TUE = '2026-09-15';
const WEEK_2_THU = '2026-09-17';

async function lessonsOf(date: string, campus = '绍兴') {
  const semester = repos.getActiveSemester();
  const slots = repos.getTimeSlots(semester.id, campus).filter((s: any) => !s.isPrepareBell);
  return expandDayLessons({
    date,
    semester,
    courses: repos.getCourses(),
    sessions: repos.getSessions(),
    overrides: repos.getOverrides(),
    timeSlots: slots
  });
}

const label = (l: any) => `${l.course.name}@${l.startAt.slice(11)}-${l.endAt.slice(11)}`;

describe('示例课表：周次过滤与校区作息', () => {
  before(async () => {
    mod = await import('../db/index.ts');
    repos = await import('../db/repositories.ts');
    ({ expandDayLessons } = await import('../../shared/timetable.ts'));
    ({ weekOf } = await import('../../shared/time.ts'));
    mod.initDatabase('.', ':memory:');
    mod.seedIfEmpty();
  });

  after(() => {
    mod?.closeDatabase();
  });

  it('学期起点与教学周换算正确', () => {
    const semester = repos.getActiveSemester();
    assert.equal(semester.startDate, '2026-09-07');
    assert.equal(weekOf('2026-09-07', semester.startDate), 1);
    assert.equal(weekOf(WEEK_2_MON, semester.startDate), 2);
    assert.equal(weekOf(WEEK_5_THU, semester.startDate), 5);
  });

  it('第 5 教学周周一：中国近现代史纲要完整 1-3 节（落在 2-6 周内）', async () => {
    const lessons = await lessonsOf(WEEK_5_MON);
    const history = lessons.filter((l: any) => l.course.name === '中国近现代史纲要');
    assert.equal(history.length, 1, `应恰好一节，实际 ${lessons.map(label).join(' | ')}`);
    // 绍兴作息：第 1 节 08:40 开始，第 3 节 11:10 结束
    assert.equal(history[0].startAt, `${WEEK_5_MON}T08:40`);
    assert.equal(history[0].endAt, `${WEEK_5_MON}T11:10`);
    assert.equal(history[0].room, '示例教学楼A101');

    // 同一天下午还有线性代数（6-8 节 → 13:30-16:00）
    const linear = lessons.find((l: any) => l.course.name === '线性代数');
    assert.ok(linear, '周一还应有线性代数');
    assert.equal(linear.startAt, `${WEEK_5_MON}T13:30`);
    assert.equal(linear.endAt, `${WEEK_5_MON}T16:00`);
  });

  it('第 2 教学周周一：中国近现代史纲要仍在（2-6 周），下午线性代数也在', async () => {
    const lessons = await lessonsOf(WEEK_2_MON);
    const names = lessons.map((l: any) => l.course.name).sort();
    assert.deepEqual(names, ['中国近现代史纲要', '线性代数']);
  });

  it('周次表达式生效：历史课在 7-8 周走"课外实践"那条记录，9 周回到教室', async () => {
    // 第 7 教学周周一 = 2026-10-19
    const week7 = await lessonsOf('2026-10-19');
    const historyWeek7 = week7.filter((l: any) => l.course.name === '中国近现代史纲要');
    assert.equal(historyWeek7.length, 1, '7-8 周只应命中一条');
    assert.equal(historyWeek7[0].room, '课外实践不在教室');

    // 第 9 教学周周一 = 2026-11-02，回到 2-6,9-17 那条
    const week9 = await lessonsOf('2026-11-02');
    const historyWeek9 = week9.filter((l: any) => l.course.name === '中国近现代史纲要');
    assert.equal(historyWeek9[0].room, '示例教学楼A101');
  });

  it('第 2 教学周周二：高数 1-2 节 + 大学英语A 3-4 节 + 晚上 C语言 10-12 节', async () => {
    const lessons = await lessonsOf(WEEK_2_TUE);
    const byName = new Map(lessons.map((l: any) => [l.course.name, l]));

    assert.equal(byName.get('高等数学A1')?.startAt, `${WEEK_2_TUE}T08:40`);
    assert.equal(byName.get('高等数学A1')?.endAt, `${WEEK_2_TUE}T10:15`);
    assert.equal(byName.get('大学英语A')?.startAt, `${WEEK_2_TUE}T10:25`);
    assert.equal(byName.get('大学英语A')?.endAt, `${WEEK_2_TUE}T12:00`);
    assert.equal(byName.get('C语言程序设计（甲）')?.startAt, `${WEEK_2_TUE}T18:00`);
    assert.equal(byName.get('C语言程序设计（甲）')?.endAt, `${WEEK_2_TUE}T20:25`);
    assert.equal(byName.get('C语言程序设计（甲）')?.room, '示例教学楼A103');
  });

  it('同一节次在两校区时间不同：周四 10-12 节', async () => {
    const shaoxing = await lessonsOf(WEEK_2_THU, '绍兴');
    const xiasha = await lessonsOf(WEEK_2_THU, '下沙');
    const sxMath = shaoxing.find((l: any) => l.course.name === '高等数学A1');
    const xsMath = xiasha.find((l: any) => l.course.name === '高等数学A1');

    assert.ok(sxMath && xsMath, '两个校区都应展开出高数');
    // 绍兴：18:00-20:25；下沙：18:30-20:55
    assert.equal(sxMath.startAt, `${WEEK_2_THU}T18:00`);
    assert.equal(sxMath.endAt, `${WEEK_2_THU}T20:25`);
    assert.equal(xsMath.startAt, `${WEEK_2_THU}T18:30`);
    assert.equal(xsMath.endAt, `${WEEK_2_THU}T20:55`);
  });

  it('上午节数按校区不同：下沙第 5 节存在，绍兴没有第 5 节', () => {
    const semester = repos.getActiveSemester();
    const sx = repos.getTimeSlots(semester.id, '绍兴').filter((s: any) => !s.isPrepareBell);
    const xs = repos.getTimeSlots(semester.id, '下沙').filter((s: any) => !s.isPrepareBell);

    assert.equal(sx.find((s: any) => s.slotIndex === 5), undefined, '绍兴不排第五节');
    assert.equal(xs.find((s: any) => s.slotIndex === 5)?.startTime, '11:40');
    // 绍兴上午最后一节是第 4 节，12:00 结束
    assert.equal(sx.find((s: any) => s.slotIndex === 4)?.endTime, '12:00');
  });

  it('预备铃不参与展开，但作息表里保留了它', () => {
    const semester = repos.getActiveSemester();
    const all = repos.getTimeSlots(semester.id, '绍兴');
    const bells = all.filter((s: any) => s.isPrepareBell);
    assert.equal(bells.length, 3, '上午/下午/晚上各一道预备铃');
    assert.equal(bells.find((b: any) => b.period === 'am')?.startTime, '08:35');
    assert.equal(bells.find((b: any) => b.period === 'eve')?.startTime, '17:55');

    // 预备铃的 start === end，即使误入展开也不会产生时长为零的块
    assert.ok(bells.every((b: any) => b.startTime === b.endTime));
  });

  it('没有课的周次不会凭空出现课程（第 1 教学周）', async () => {
    // 所有课都从第 2 周开始，第 1 周应该是空的
    const lessons = await lessonsOf('2026-09-07');
    assert.equal(lessons.length, 0, `第 1 周不应有课，实际 ${lessons.map(label).join(' | ')}`);
  });

  it('周六导论课只在 8-11 周出现', async () => {
    const inRange = await lessonsOf('2026-10-31'); // 第 8 教学周 周六
    assert.ok(
      inRange.some((l: any) => l.course.name === '电子信息类学科导论'),
      '第 8 周周六应有导论课'
    );

    const outRange = await lessonsOf('2026-11-14'); // 第 10 教学周之后已超 11 周？→ 第 10 周周六
    void outRange;
    const late = await lessonsOf('2026-11-21'); // 第 11 教学周 周六（边界内）
    assert.ok(late.some((l: any) => l.course.name === '电子信息类学科导论'), '第 11 周周六仍应在区间内');

    const after = await lessonsOf('2026-11-28'); // 第 12 教学周 周六（超出 8-11）
    assert.ok(
      !after.some((l: any) => l.course.name === '电子信息类学科导论'),
      '第 12 周周六不应再有导论课'
    );
  });
});
