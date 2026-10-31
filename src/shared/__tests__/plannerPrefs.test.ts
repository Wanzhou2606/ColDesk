/**
 * 排程偏好收敛测试。
 *
 * 这些断言针对的是"用户在设置页乱填"的情况：
 * 界面上的数字框可以被输入 0、负数、比最大值还大的数，或者把时段写成 25:00。
 * 如果这些值直接进排程引擎，会出现 0 分钟的块、排不进去的任务、甚至死循环，
 * 所以必须在进引擎之前收敛掉，并且要能证明它确实收敛了。
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_PREFS_VIEW,
  sanitizePrefsView,
  toPlannerPrefs
} from '../plannerPrefs';
import { DEFAULT_PREFS, freeSlotsOfDay, planSchedule } from '../planner';

describe('plannerPrefs: 收敛用户输入', () => {
  it('空输入回退到默认值', () => {
    assert.deepEqual(sanitizePrefsView(undefined), DEFAULT_PREFS_VIEW);
    assert.deepEqual(sanitizePrefsView(null), DEFAULT_PREFS_VIEW);
    assert.deepEqual(sanitizePrefsView({}), DEFAULT_PREFS_VIEW);
  });

  it('数字被夹到合理区间', () => {
    const p = sanitizePrefsView({
      dailyCapMinutes: { study: 99999, life: -20 },
      minBlockMinutes: 0,
      maxBlockMinutes: 9999,
      breakMinutes: 999,
      dueBufferRatio: 5
    });
    assert.equal(p.dailyCapMinutes.study, 720, '学习上限封顶 720');
    assert.equal(p.dailyCapMinutes.life, 0, '生活上限下限 0');
    assert.equal(p.minBlockMinutes, 10, '单块最短下限 10');
    assert.equal(p.maxBlockMinutes, 360, '单块最长封顶 360');
    assert.equal(p.breakMinutes, 60, '块间休息封顶 60');
    assert.equal(p.dueBufferRatio, 0.5, '缓冲封顶 50%');
  });

  it('清空输入框（null / 空串）按"没填"处理，不能当成 0', () => {
    // 这是真实会踩到的坑：Number(null) === 0、Number('') === 0，
    // 一旦当成 0，单块最长时间会变 0，还会连带把最短时间也压小。
    const p = sanitizePrefsView({
      minBlockMinutes: '' as unknown as number,
      maxBlockMinutes: null as unknown as number,
      breakMinutes: '' as unknown as number,
      dailyCapMinutes: { study: '' as unknown as number, life: null as unknown as number }
    } as never);
    assert.equal(p.minBlockMinutes, DEFAULT_PREFS_VIEW.minBlockMinutes, '空串应按默认值处理');
    assert.equal(p.maxBlockMinutes, DEFAULT_PREFS_VIEW.maxBlockMinutes, 'null 应按默认值处理');
    assert.equal(p.breakMinutes, DEFAULT_PREFS_VIEW.breakMinutes);
    assert.equal(p.dailyCapMinutes.study, DEFAULT_PREFS_VIEW.dailyCapMinutes.study);
    assert.equal(p.dailyCapMinutes.life, DEFAULT_PREFS_VIEW.dailyCapMinutes.life);
    assert.ok(p.minBlockMinutes <= p.maxBlockMinutes);
  });

  it('非数字输入不会破坏默认值', () => {
    const p = sanitizePrefsView({
      dailyCapMinutes: { study: 'abc' as unknown as number, life: Number.NaN },
      breakMinutes: {} as unknown as number,
      dueBufferRatio: 'half' as unknown as number
    });
    assert.equal(p.dailyCapMinutes.study, DEFAULT_PREFS_VIEW.dailyCapMinutes.study);
    assert.equal(p.dailyCapMinutes.life, DEFAULT_PREFS_VIEW.dailyCapMinutes.life);
    assert.equal(p.breakMinutes, DEFAULT_PREFS_VIEW.breakMinutes);
    assert.equal(p.dueBufferRatio, DEFAULT_PREFS_VIEW.dueBufferRatio);
  });

  it('单块最短超过最长时会被纠正，不会留下矛盾区间', () => {
    const p = sanitizePrefsView({ minBlockMinutes: 200, maxBlockMinutes: 30 });
    assert.ok(p.minBlockMinutes <= p.maxBlockMinutes, `最短 ${p.minBlockMinutes} 应不大于最长 ${p.maxBlockMinutes}`);
    assert.equal(p.maxBlockMinutes, 30);
    assert.equal(p.minBlockMinutes, 30, '最短被压到与最长相同');
  });

  it('时段：时间格式错误的项被丢弃', () => {
    const p = sanitizePrefsView({
      studyWindows: [
        { start: '08:00', end: '12:00' },
        { start: '25:00', end: '26:00' },
        { start: 'abc', end: '12:00' },
        { start: '9:5', end: '10:00' }
      ]
    });
    assert.deepEqual(p.studyWindows, [{ start: '08:00', end: '12:00' }]);
  });

  it('时段：结束早于或等于开始的项被丢弃，并按开始时间排序', () => {
    const p = sanitizePrefsView({
      studyWindows: [
        { start: '19:00', end: '23:00' },
        { start: '14:00', end: '14:00' },
        { start: '16:00', end: '15:00' },
        { start: '08:00', end: '12:00' }
      ]
    });
    assert.deepEqual(p.studyWindows, [
      { start: '08:00', end: '12:00' },
      { start: '19:00', end: '23:00' }
    ]);
  });

  it('时段：重叠区间会被合并（否则同一段时间会被重复计算）', () => {
    const p = sanitizePrefsView({
      studyWindows: [
        { start: '08:00', end: '12:00' },
        { start: '10:00', end: '14:00' },
        { start: '19:00', end: '20:00' },
        { start: '20:00', end: '22:00' }
      ]
    });
    assert.deepEqual(p.studyWindows, [
      { start: '08:00', end: '14:00' },
      { start: '19:00', end: '22:00' }
    ]);
  });

  it('时段：全部非法时回退到默认，而不是变成"什么都排不进去"', () => {
    const p = sanitizePrefsView({ studyWindows: [{ start: 'bad', end: 'worse' }] });
    assert.deepEqual(p.studyWindows, DEFAULT_PREFS_VIEW.studyWindows);
  });

  it('未提供的字段沿用默认', () => {
    const p = sanitizePrefsView({ minBlockMinutes: 30 });
    assert.equal(p.minBlockMinutes, 30);
    assert.deepEqual(p.studyWindows, DEFAULT_PREFS_VIEW.studyWindows);
    assert.deepEqual(p.lifeWindows, DEFAULT_PREFS_VIEW.lifeWindows);
    assert.equal(p.dailyCapMinutes.study, DEFAULT_PREFS_VIEW.dailyCapMinutes.study);
  });
});

describe('plannerPrefs: 转成排程引擎参数并真正生效', () => {
  it('toPlannerPrefs 只覆盖可调子集，其余交给引擎默认', () => {
    const view = sanitizePrefsView({
      studyWindows: [{ start: '09:00', end: '11:00' }],
      dailyCapMinutes: { study: 90, life: 30 },
      minBlockMinutes: 30,
      maxBlockMinutes: 60,
      breakMinutes: 5,
      dueBufferRatio: 0.1
    });
    const prefs = toPlannerPrefs(view);

    assert.deepEqual(prefs.windows?.study, [{ start: '09:00', end: '11:00' }]);
    assert.deepEqual(prefs.dailyCapMinutes, { study: 90, life: 30 });
    assert.equal(prefs.minBlockMinutes, 30);
    assert.equal(prefs.maxBlockMinutes, 60);
    assert.equal(prefs.breakMinutes, 5);
    assert.equal(prefs.dueBufferRatio, 0.1);
    // 没有暴露给用户的参数不应出现，让引擎用自己的默认值
    assert.equal(prefs.nightBufferMinutes, undefined);
    assert.equal(prefs.horizonDays, undefined);
  });

  it('自定义时段确实改变了可用空闲区间', () => {
    const view = sanitizePrefsView({ studyWindows: [{ start: '20:00', end: '22:00' }] });
    const prefs = { ...DEFAULT_PREFS, ...toPlannerPrefs(view) };
    const free = freeSlotsOfDay({
      date: '2025-10-08',
      domain: 'study',
      prefs,
      busyIntervals: [],
      nowDate: '2025-10-08'
    });
    // 20:00-22:00 减去睡前缓冲 30 分钟 → 20:00-21:30
    assert.equal(free.length, 1);
    assert.equal(free[0].start, 20 * 60);
    assert.equal(free[0].end, 22 * 60 - prefs.nightBufferMinutes);
  });

  it('自定义单块上限会体现在排出的块上', () => {
    const view = sanitizePrefsView({
      studyWindows: [{ start: '08:00', end: '19:00' }],
      dailyCapMinutes: { study: 480, life: 60 },
      minBlockMinutes: 20,
      maxBlockMinutes: 60,
      breakMinutes: 10,
      dueBufferRatio: 0.2
    });
    const result = planSchedule({
      now: '2025-10-08T08:00',
      courses: [],
      sessions: [],
      overrides: [],
      timeSlots: [],
      exams: [],
      busy: [],
      lockedBlocks: [],
      prefs: toPlannerPrefs(view),
      tasks: [
        {
          id: 't1',
          title: '写论文',
          domain: 'study',
          type: 'paper',
          urgency: 4,
          priorityScore: 300,
          estMinutes: 150,
          splittable: true,
          dueAt: '2025-10-10T18:00'
        }
      ]
    });

    assert.ok(result.blocks.length >= 3, `150 分钟按 60 分钟上限应至少 3 块，实际 ${result.blocks.length}`);
    assert.equal(
      result.blocks.reduce((sum, b) => sum + b.plannedMinutes, 0),
      150,
      '总时长必须等于预估'
    );
    // 除收尾的短块外，都不超过用户设定的单块上限
    for (const b of result.blocks.slice(0, -1)) {
      assert.ok(b.plannedMinutes <= 60, `块 ${b.startAt} 有 ${b.plannedMinutes} 分钟，超过上限 60`);
    }
  });
});
