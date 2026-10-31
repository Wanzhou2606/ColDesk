import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type AgendaSnapshot,
  buildAgenda,
  buildTimeline,
  buildWeek,
  dayProgress,
  nextLessonHint,
  primaryMoment
} from '../agenda';
import { SEMESTER, TIME_SLOTS, block, course, exam, session, task } from './fixtures';

const COURSE_DS = course('c1', '数据结构', '#4F7CFF');
const COURSE_PR = course('c2', '概率论', '#12A594');
const SESSIONS = [
  session('s1', 'c1', 3, 1, 2, { room: 'A301' }), // 周三 08:00-09:40
  session('s2', 'c2', 3, 5, 6, { room: 'B104' }) // 周三 14:00-15:40
];

function snapshot(overrides: Partial<AgendaSnapshot> = {}): AgendaSnapshot {
  return {
    semester: SEMESTER,
    courses: [COURSE_DS, COURSE_PR],
    sessions: SESSIONS,
    overrides: [],
    timeSlots: TIME_SLOTS,
    tasks: [],
    exams: [],
    blocks: [],
    busy: [],
    ...overrides
  };
}

describe('agenda: 时间线', () => {
  it('课程按时间排序进入时间线，带教室与颜色', () => {
    const timeline = buildTimeline({ date: '2025-10-08', snapshot: snapshot() });
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].title, '数据结构');
    assert.equal(timeline[0].startAt, '2025-10-08T08:00');
    assert.equal(timeline[0].location, 'A301');
    assert.equal(timeline[1].title, '概率论');
    assert.equal(timeline[1].color, '#12A594');
  });

  it('考试与编排块也会出现在同一天的时间线上', () => {
    const timeline = buildTimeline({
      date: '2025-10-08',
      snapshot: snapshot({
        exams: [exam('e1', '线性代数', '2025-10-08T19:00', { location: 'A101', durationMinutes: 90 })],
        tasks: [task('t1', '写实验报告')],
        blocks: [block('b1', 't1', '2025-10-08', '2025-10-08T20:00', '2025-10-08T21:00')]
      })
    });
    const kinds = timeline.map((b) => b.kind);
    assert.ok(kinds.includes('exam'));
    assert.ok(kinds.includes('block'));
    const examBlock = timeline.find((b) => b.kind === 'exam')!;
    assert.equal(examBlock.title, '考试 · 线性代数');
    assert.equal(examBlock.endAt, '2025-10-08T20:30');
  });
});

describe('agenda: 当下日程随时刻切换', () => {
  it('上午 08:20：正在上数据结构，接下来是概率论', () => {
    const agenda = buildAgenda(snapshot(), '2025-10-08T08:20');
    assert.equal(agenda.current?.title, '数据结构');
    assert.equal(agenda.current?.status, 'ongoing');
    assert.equal(agenda.current?.location, 'A301');
    assert.ok(agenda.current!.countdownLabel.includes('结束'));
    const moment = primaryMoment(agenda);
    assert.equal(moment?.title, '数据结构');
  });

  it('上午 10:00：今天下午还没上的课出现在"接下来"', () => {
    const agenda = buildAgenda(snapshot(), '2025-10-08T10:00');
    assert.equal(agenda.current, undefined);
    assert.equal(agenda.next[0].title, '概率论');
    assert.equal(agenda.next[0].timeLabel, '14:00-15:40');
    assert.equal(agenda.next[0].status, 'upcoming');
    assert.equal(agenda.next[0].countdownLabel, '4 小时后开始');
  });

  it('下午 13:50：10 分钟后上课，状态为 soon', () => {
    const agenda = buildAgenda(snapshot(), '2025-10-08T13:50');
    assert.equal(agenda.next[0].title, '概率论');
    assert.equal(agenda.next[0].status, 'soon');
    assert.equal(agenda.next[0].countdownLabel, '10 分钟后开始');
  });

  it('下午 14:10：概率论正在进行', () => {
    const agenda = buildAgenda(snapshot(), '2025-10-08T14:10');
    assert.equal(agenda.current?.title, '概率论');
    assert.equal(primaryMoment(agenda)?.title, '概率论');
  });

  it('晚上课程结束后：预览明天的课', () => {
    const agenda = buildAgenda(snapshot(), '2025-10-08T21:00');
    assert.equal(agenda.current, undefined);
    const tomorrowLesson = buildTimeline({ date: '2025-10-09', snapshot: snapshot() });
    assert.equal(tomorrowLesson.length, 0); // 周四没课，所以预览为空
    assert.equal(agenda.next.length, 0);
  });

  it('晚上有课时，"接下来"不会越过今天去看明天', () => {
    const withEvening = snapshot({
      sessions: [...SESSIONS, session('s3', 'c1', 3, 9, 10, { room: 'C201' })] // 周三 19:00-20:40
    });
    const agenda = buildAgenda(withEvening, '2025-10-08T16:00');
    assert.equal(agenda.next[0].title, '数据结构');
    assert.equal(agenda.next[0].startAt, '2025-10-08T19:00');
  });
});

describe('agenda: 今日临期与超期', () => {
  it('今日临期包含今天到期的与已超期的，跨天列表只放未来 7 天', () => {
    const agenda = buildAgenda(
      snapshot({
        tasks: [
          task('t1', '交实验报告', { urgency: 5, dueAt: '2025-10-08T18:00' }),
          task('t2', '早该交的作业', { urgency: 2, dueAt: '2025-10-07T18:00' }),
          task('t3', '下周的事', { urgency: 3, dueAt: '2025-10-15T18:00' }),
          task('t4', '三天后交', { urgency: 3, dueAt: '2025-10-11T18:00' })
        ]
      }),
      '2025-10-08T12:00'
    );
    // 超期任务排在最前，必须留在"当下"视野里
    assert.deepEqual(
      agenda.todayTasks.map((d) => d.task.id),
      ['t2', 't1']
    );
    assert.equal(agenda.todayTasks[0].overdue, true);
    assert.equal(agenda.todayTasks[1].overdue, false);
    assert.equal(agenda.todayTasks[1].dueLabel, '今天 18:00');
    assert.deepEqual(
      agenda.urgentTasks.map((d) => d.task.id),
      ['t4']
    );
    assert.deepEqual(
      agenda.overdueTasks.map((d) => d.task.id),
      ['t2']
    );
    assert.equal(agenda.summary.overdueCount, 1);
    assert.equal(agenda.summary.dueTodayCount, 2);
  });

  it('已完成与已取消的任务不会出现在临期列表', () => {
    const agenda = buildAgenda(
      snapshot({
        tasks: [
          task('done', '已完成', { status: 'done', doneAt: '2025-10-08T10:00', dueAt: '2025-10-08T18:00' }),
          task('canceled', '已取消', { status: 'canceled', dueAt: '2025-10-08T18:00' }),
          task('open', '待办', { dueAt: '2025-10-08T18:00' })
        ]
      }),
      '2025-10-08T12:00'
    );
    assert.deepEqual(
      agenda.todayTasks.map((d) => d.task.id),
      ['open']
    );
    assert.equal(agenda.summary.doneTodayCount, 1);
  });

  it('汇总统计包含课数、已编排时长', () => {
    const agenda = buildAgenda(
      snapshot({
        tasks: [task('t1', '写报告', { dueAt: '2025-10-09T18:00' })],
        blocks: [
          block('b1', 't1', '2025-10-08', '2025-10-08T16:00', '2025-10-08T17:00', { plannedMinutes: 60 }),
          block('b2', 't1', '2025-10-09', '2025-10-09T09:00', '2025-10-09T10:00', { plannedMinutes: 60 })
        ]
      }),
      '2025-10-08T12:00'
    );
    assert.equal(agenda.summary.lessonCount, 2);
    assert.equal(agenda.summary.plannedMinutes, 60); // 只统计今天
  });
});

describe('agenda: 辅助信息', () => {
  it('dayProgress 统计今天应完成与已完成', () => {
    const snap = snapshot({
      tasks: [
        task('a', 'A', { status: 'done', doneAt: '2025-10-08T09:00', dueAt: '2025-10-08T18:00' }),
        task('b', 'B', { dueAt: '2025-10-08T20:00' }),
        task('c', 'C', { dueAt: '2025-10-09T20:00' })
      ]
    });
    assert.deepEqual(dayProgress(snap, '2025-10-08'), { done: 1, total: 2 });
  });

  it('nextLessonHint 给出下一节课的地点，超过 12 小时则不提示', () => {
    const hint = nextLessonHint(snapshot(), '2025-10-08T10:00');
    assert.ok(hint?.includes('概率论'));
    assert.ok(hint?.includes('B104'));
    assert.equal(nextLessonHint(snapshot(), '2025-10-08T21:00'), undefined);
  });
});

describe('agenda: 周视图数据', () => {
  it('从今天起给出 7 天，且标记今天', () => {
    const week = buildWeek(snapshot(), '2025-10-08');
    assert.equal(week.days.length, 7);
    assert.equal(week.days[0].date, '2025-10-08');
    assert.equal(week.days[0].isToday, true);
    assert.equal(week.days[0].weekday, '周三');
    assert.equal(week.days[0].dayLabel, '10/08');
    assert.equal(week.days[6].date, '2025-10-14');
    assert.equal(week.days[6].weekday, '周二');
  });

  it('每天带上当天的课程块，时间换算成分钟便于定位', () => {
    const week = buildWeek(snapshot(), '2025-10-08');
    const today = week.days[0];
    assert.equal(today.blocks.length, 2);
    assert.equal(today.blocks[0].title, '数据结构');
    assert.equal(today.blocks[0].startMinute, 8 * 60);
    assert.equal(today.blocks[0].endMinute, 9 * 60 + 40);
    assert.equal(today.blocks[0].timeLabel, '08:00-09:40');
    assert.equal(today.blocks[0].location, 'A301');
    assert.ok(today.blocks[0].color, '课程应带颜色');
  });

  it('编排块与固定占用也会进入周视图', () => {
    const week = buildWeek(
      snapshot({
        tasks: [task('t1', '写报告')],
        blocks: [block('b1', 't1', '2025-10-09', '2025-10-09T19:00', '2025-10-09T20:00', { reason: '紧迫度 4' })],
        busy: [
          {
            id: 'busy1',
            title: '兼职',
            weekday: 4,
            startAt: '2025-10-09T14:00',
            endAt: '2025-10-09T18:00',
            domain: 'life'
          }
        ]
      }),
      '2025-10-08'
    );
    const thursday = week.days[1];
    assert.equal(thursday.date, '2025-10-09');
    assert.equal(thursday.blocks.length, 2);
    assert.ok(thursday.blocks.some((b) => b.kind === 'block' && b.reason === '紧迫度 4'));
    assert.ok(thursday.blocks.some((b) => b.kind === 'busy' && b.title === '兼职'));
  });

  it('统计本周到期任务数，并给出第一个有安排的位置', () => {
    const week = buildWeek(
      snapshot({
        tasks: [
          task('t1', '今天交', { dueAt: '2025-10-08T18:00' }),
          task('t2', '后天交', { dueAt: '2025-10-10T18:00' }),
          task('t3', '下周交', { dueAt: '2025-10-20T18:00' }),
          task('t4', '已完成的', { dueAt: '2025-10-09T18:00', status: 'done' })
        ]
      }),
      '2025-10-08'
    );
    assert.equal(week.dueCount, 2, '只统计本周内且未完成的');
    assert.equal(week.firstBusyIndex, 0, '今天有课，应为 0');
  });

  it('没有任何安排的周返回 firstBusyIndex 0 且各天块为空', () => {
    const empty = snapshot({
      courses: [],
      sessions: [],
      tasks: [],
      blocks: [],
      busy: []
    });
    const week = buildWeek(empty, '2025-10-08');
    assert.equal(week.firstBusyIndex, 0);
    assert.ok(week.days.every((d) => d.blocks.length === 0));
    assert.equal(week.dueCount, 0);
  });

  it('buildAgenda 会把周视图数据一起返回', () => {
    const agenda = buildAgenda(snapshot(), '2025-10-08T08:20');
    assert.equal(agenda.week.days.length, 7);
    assert.equal(agenda.week.days[0].date, agenda.date);
  });
});
