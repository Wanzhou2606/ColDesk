import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  addDays,
  hhmmToMinutes,
  humanDuration,
  mondayOf,
  parseWeekList,
  relativeDay,
  weekOf,
  weekdayOf
} from '../time';
import { SEMESTER, TIME_SLOTS, course, override, session } from './fixtures';
import { expandDayLessons, matchesByRule, upcomingLessons } from '../timetable';

describe('time: 教学周与日期基础', () => {
  it('2025-09-01 是周一，且为第 1 教学周', () => {
    assert.equal(weekdayOf('2025-09-01'), 1);
    assert.equal(weekOf('2025-09-01', SEMESTER.startDate), 1);
  });

  it('同一周内任意一天都算第 1 周', () => {
    for (const d of ['2025-09-01', '2025-09-03', '2025-09-07']) {
      assert.equal(weekOf(d, SEMESTER.startDate), 1, d);
    }
    assert.equal(weekOf('2025-09-08', SEMESTER.startDate), 2);
    assert.equal(weekOf('2025-10-06', SEMESTER.startDate), 6);
  });

  it('开学前为第 0 周或负数，学期结束后超出总周数', () => {
    assert.equal(weekOf('2025-08-25', SEMESTER.startDate), 0);
    assert.ok(weekOf('2026-03-01', SEMESTER.startDate) > SEMESTER.totalWeeks);
  });

  it('mondayOf 与 addDays 正确', () => {
    assert.equal(mondayOf('2025-09-04'), '2025-09-01');
    assert.equal(mondayOf('2025-09-07'), '2025-09-01');
    assert.equal(mondayOf('2025-09-08'), '2025-09-08');
    assert.equal(addDays('2025-09-30', 1), '2025-10-01');
    assert.equal(addDays('2025-03-01', -1), '2025-02-28');
  });

  it('周次表达式解析支持区间与列表', () => {
    assert.deepEqual(parseWeekList('1,2,3,5,8-12'), [1, 2, 3, 5, 8, 9, 10, 11, 12]);
    assert.deepEqual(parseWeekList(' 3 、 5至7 '), [3, 5, 6, 7]);
    assert.deepEqual(parseWeekList(''), []);
    assert.deepEqual(parseWeekList(undefined), []);
  });

  it('时长与相对日期文案', () => {
    assert.equal(humanDuration(32), '32 分钟');
    assert.equal(humanDuration(60), '1 小时');
    assert.equal(humanDuration(130), '2 小时 10 分钟');
    assert.equal(humanDuration(4320), '3 天');
    assert.equal(relativeDay('2025-10-08', '2025-10-08'), '今天');
    assert.equal(relativeDay('2025-10-09', '2025-10-08'), '明天');
    assert.equal(relativeDay('2025-10-10', '2025-10-08'), '后天');
    assert.equal(relativeDay('2025-10-07', '2025-10-08'), '昨天');
    // 三天以上才回退到星期/日期，避免"后天"和外推的星期冲突
    assert.equal(relativeDay('2025-10-11', '2025-10-08'), '周六');
    assert.equal(relativeDay('2025-10-20', '2025-10-08'), '10月20日');
  });

  it('hhmm 解析', () => {
    assert.equal(hhmmToMinutes('08:00'), 480);
    assert.equal(hhmmToMinutes('19:45'), 1185);
  });
});

describe('timetable: 单双周 / 自定义周次 / 调课停课', () => {
  const courseA = course('c1', '数据结构', '#4F7CFF');
  const base = {
    semester: SEMESTER,
    courses: [courseA],
    timeSlots: TIME_SLOTS,
    overrides: []
  };

  it('自然周课程在每周同一天都命中', () => {
    const s = session('s1', 'c1', 3, 1, 2); // 周三 1-2 节
    assert.equal(matchesByRule(s, '2025-09-03', SEMESTER), true);
    assert.equal(matchesByRule(s, '2025-09-10', SEMESTER), true);
  });

  it('单周课只在奇数周出现，双周课只在偶数周出现', () => {
    const odd = session('s2', 'c1', 3, 1, 2, { weekMode: 'odd' });
    const even = session('s3', 'c1', 3, 1, 2, { weekMode: 'even' });
    assert.equal(matchesByRule(odd, '2025-09-03', SEMESTER), true); // 第 1 周
    assert.equal(matchesByRule(odd, '2025-09-10', SEMESTER), false); // 第 2 周
    assert.equal(matchesByRule(even, '2025-09-10', SEMESTER), true);
    assert.equal(matchesByRule(even, '2025-09-03', SEMESTER), false);
  });

  it('自定义周次按列表命中', () => {
    const custom = session('s4', 'c1', 3, 1, 2, { weekMode: 'custom', weekList: '1,3,5' });
    assert.equal(matchesByRule(custom, '2025-09-03', SEMESTER), true); // 第 1 周
    assert.equal(matchesByRule(custom, '2025-09-10', SEMESTER), false); // 第 2 周
    assert.equal(matchesByRule(custom, '2025-09-17', SEMESTER), true); // 第 3 周
  });

  it('展开一天：连堂渲染为一个块，含教室', () => {
    const lessons = expandDayLessons({
      date: '2025-09-03',
      sessions: [session('s1', 'c1', 3, 1, 2, { room: 'A301' })],
      ...base
    });
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].startAt, '2025-09-03T08:00');
    assert.equal(lessons[0].endAt, '2025-09-03T09:40');
    assert.equal(lessons[0].room, 'A301');
  });

  it('停课不再出现在时间线上', () => {
    const lessons = expandDayLessons({
      date: '2025-09-03',
      sessions: [session('s1', 'c1', 3, 1, 2)],
      ...base,
      overrides: [override('o1', 's1', '2025-09-03')]
    });
    assert.equal(lessons.length, 0);
  });

  it('调课把课搬到另一天，且原时间不再出现', () => {
    const moved = expandDayLessons({
      date: '2025-09-04',
      sessions: [session('s1', 'c1', 3, 1, 2)],
      ...base,
      overrides: [override('o1', 's1', '2025-09-03', { kind: 'reschedule', newDate: '2025-09-04' })]
    });
    assert.equal(moved.length, 1);
    assert.equal(moved[0].rescheduled, true);
    assert.equal(moved[0].startAt, '2025-09-04T08:00');

    const origin = expandDayLessons({
      date: '2025-09-03',
      sessions: [session('s1', 'c1', 3, 1, 2)],
      ...base,
      overrides: [override('o1', 's1', '2025-09-03', { kind: 'reschedule', newDate: '2025-09-04' })]
    });
    assert.equal(origin.length, 0);
  });

  it('换教室覆盖当天的教室', () => {
    const lessons = expandDayLessons({
      date: '2025-09-03',
      sessions: [session('s1', 'c1', 3, 1, 2, { room: 'A301' })],
      ...base,
      overrides: [override('o1', 's1', '2025-09-03', { kind: 'room_change', newRoom: 'B104' })]
    });
    assert.equal(lessons[0].room, 'B104');
  });
});

describe('timetable: 当下日程（上午/下午/上课中）', () => {
  const courseA = course('c1', '数据结构');
  const courseB = course('c2', '概率论');
  const sessions = [
    session('s1', 'c1', 3, 1, 2, { room: 'A301' }), // 周三 08:00-09:40
    session('s2', 'c2', 3, 5, 6, { room: 'B104' }) // 周三 14:00-15:40
  ];
  const common = {
    semester: SEMESTER,
    courses: [courseA, courseB],
    sessions,
    overrides: [],
    timeSlots: TIME_SLOTS
  };

  it('上午 10:00：下一节是下午的概率论', () => {
    const r = upcomingLessons({ now: '2025-09-03T10:00', ...common });
    assert.equal(r.current, undefined);
    assert.equal(r.next.length, 1);
    assert.equal(r.next[0].course.name, '概率论');
    assert.equal(r.next[0].untilStartMinutes, 240);
  });

  it('08:20 正在上数据结构', () => {
    const r = upcomingLessons({ now: '2025-09-03T08:20', ...common });
    assert.equal(r.current?.course.name, '数据结构');
    assert.equal(r.next[0].course.name, '概率论');
  });

  it('下午 14:10：下午的课正在进行，不再出现在"接下来"', () => {
    const r = upcomingLessons({ now: '2025-09-03T14:10', ...common });
    assert.equal(r.current?.course.name, '概率论');
    assert.equal(r.next.length, 0);
  });

  it('跨到下周仍能给出下一节课', () => {
    const r = upcomingLessons({ now: '2025-09-03T20:00', ...common, days: 8 });
    assert.equal(r.next[0].course.name, '数据结构');
    assert.equal(r.next[0].startAt, '2025-09-10T08:00');
  });
});
