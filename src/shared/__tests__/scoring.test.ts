import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isOverdue, sortTasksByUrgency, taskScore, urgencyMeta, typeWeight } from '../scoring';
import { task } from './fixtures';

const NOW = '2025-10-08T12:00';

describe('scoring: 紧迫度语义', () => {
  it('五档都有中文语义与提醒提前量', () => {
    for (const u of [1, 2, 3, 4, 5] as const) {
      const meta = urgencyMeta(u);
      assert.ok(meta.label.length > 0);
      assert.ok(meta.meaning.length > 0);
      assert.ok(Array.isArray(meta.offsets));
    }
    assert.equal(urgencyMeta(5).label, '紧急');
    assert.deepEqual(urgencyMeta(5).offsets, [4320, 1440, 120, 30]);
    assert.deepEqual(urgencyMeta(1).offsets, []);
  });

  it('类型权重：考试复习 > 作业 > 生活', () => {
    assert.ok(typeWeight({ type: 'exam_prep', domain: 'study' }) > typeWeight({ type: 'assignment', domain: 'study' }));
    assert.ok(typeWeight({ type: 'assignment', domain: 'study' }) > typeWeight({ type: 'todo', domain: 'life' }));
  });
});

describe('scoring: 紧急度分数与排序', () => {
  it('超期任务分数最高（+1000 档）', () => {
    const overdue = task('t1', '超期作业', { dueAt: '2025-10-08T09:00', urgency: 2 });
    const soon = task('t2', '两小时后交', { dueAt: '2025-10-08T14:00', urgency: 5 });
    assert.ok(taskScore(overdue, NOW) > taskScore(soon, NOW));
    assert.equal(isOverdue(overdue, NOW), true);
    assert.equal(isOverdue(soon, NOW), false);
  });

  it('24 小时内越接近截止分数越高', () => {
    const a = task('a', 'A', { dueAt: '2025-10-08T18:00', urgency: 3 });
    const b = task('b', 'B', { dueAt: '2025-10-08T23:00', urgency: 3 });
    assert.ok(taskScore(a, NOW) > taskScore(b, NOW));
  });

  it('紧迫程度在截止时间相同时决定先后', () => {
    const urgent = task('u', '紧急', { dueAt: '2025-10-10T18:00', urgency: 5 });
    const normal = task('n', '普通', { dueAt: '2025-10-10T18:00', urgency: 3 });
    assert.ok(taskScore(urgent, NOW) > taskScore(normal, NOW));
  });

  it('排序结果：超期 > 今日 > 本周 > 更远，同分按截止时间升序', () => {
    const list = [
      task('far', '下周', { dueAt: '2025-10-20T18:00', urgency: 3 }),
      task('overdue', '已超期', { dueAt: '2025-10-07T18:00', urgency: 1 }),
      task('today-late', '今晚', { dueAt: '2025-10-08T23:00', urgency: 3 }),
      task('today-soon', '两小时后', { dueAt: '2025-10-08T14:00', urgency: 3 }),
      task('week', '本周五', { dueAt: '2025-10-10T18:00', urgency: 2 })
    ];
    const sorted = sortTasksByUrgency(list, NOW).map((t) => t.id);
    assert.deepEqual(sorted, ['overdue', 'today-soon', 'today-late', 'week', 'far']);
  });

  it('无截止时间的任务排在有时限的后面', () => {
    const list = [
      task('none', '没有期限', { urgency: 5 }),
      task('due', '有期限', { dueAt: '2025-10-30T18:00', urgency: 3 })
    ];
    assert.equal(sortTasksByUrgency(list, NOW)[0].id, 'due');
  });

  it('进行中的任务获得加成', () => {
    const doing = task('d', '进行中', { dueAt: '2025-10-10T18:00', status: 'doing' });
    const open = task('o', '未开始', { dueAt: '2025-10-10T18:00' });
    assert.ok(taskScore(doing, NOW) > taskScore(open, NOW));
  });
});
