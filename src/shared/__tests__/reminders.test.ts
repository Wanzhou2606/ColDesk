import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  classReminderDraft,
  isStrongReminder,
  isWithinCatchUp,
  reminderDraftsForExam,
  reminderDraftsForTask
} from '../reminders';
import { exam, task } from './fixtures';

describe('reminders: 任务提醒点', () => {
  it('紧迫 5：前 3 天 / 1 天 / 2 小时 / 30 分钟', () => {
    const drafts = reminderDraftsForTask(
      task('t1', '火烧眉毛', { urgency: 5, dueAt: '2025-10-10T18:00' })
    );
    assert.equal(drafts.length, 4);
    assert.deepEqual(
      drafts.map((d) => d.offsetMinutes),
      [4320, 1440, 120, 30]
    );
    assert.equal(drafts[0].fireAt, '2025-10-07T18:00');
    assert.equal(drafts[3].fireAt, '2025-10-10T17:30');
    assert.ok(drafts[0].reason.includes('3 天'));
  });

  it('紧迫 1：没有提醒点，只进每日汇总', () => {
    const drafts = reminderDraftsForTask(task('t1', '随意', { urgency: 1, dueAt: '2025-10-30T18:00' }));
    assert.equal(drafts.length, 0);
  });

  it('没有截止时间就没有提醒点', () => {
    assert.equal(reminderDraftsForTask(task('t1', '无期限', { urgency: 5 })).length, 0);
  });

  it('remindPolicy=none 时不提醒', () => {
    const drafts = reminderDraftsForTask(
      task('t1', '静音', { urgency: 5, dueAt: '2025-10-10T18:00', remindPolicy: 'none' })
    );
    assert.equal(drafts.length, 0);
  });

  it('自定义提前量会被去重并从远到近排序', () => {
    const drafts = reminderDraftsForTask(
      task('t1', '自定义', {
        urgency: 3,
        dueAt: '2025-10-10T18:00',
        remindPolicy: 'custom',
        remindOffsets: [30, 120, 120, 60]
      })
    );
    assert.deepEqual(
      drafts.map((d) => d.offsetMinutes),
      [120, 60, 30]
    );
    assert.equal(drafts[0].level, 'h2');
  });

  it('紧迫 5 在临近截止时升级为强提醒（不自动消失）', () => {
    const t = task('t1', '火烧眉毛', { urgency: 5, dueAt: '2025-10-10T18:00' });
    const drafts = reminderDraftsForTask(t);
    const near = drafts.find((d) => d.offsetMinutes === 120)!;
    const far = drafts.find((d) => d.offsetMinutes === 1440)!;
    assert.equal(isStrongReminder(t, near), true);
    assert.equal(isStrongReminder(t, far), false);
  });
});

describe('reminders: 考试与上课', () => {
  it('难度 >= 4 的考试提前 3 天开始提醒', () => {
    const drafts = reminderDraftsForExam(exam('e1', '数据结构', '2025-10-20T09:00', { difficulty: 4 }));
    assert.deepEqual(
      drafts.map((d) => d.offsetMinutes),
      [4320, 1440, 120, 30]
    );
    assert.equal(drafts[0].fireAt, '2025-10-17T09:00');
    assert.ok(drafts[0].reason.includes('数据结构'));
  });

  it('难度低的考试只用 1 天 / 2 小时 / 30 分钟', () => {
    const drafts = reminderDraftsForExam(exam('e2', '体育', '2025-10-20T09:00', { difficulty: 2 }));
    assert.deepEqual(
      drafts.map((d) => d.offsetMinutes),
      [1440, 120, 30]
    );
  });

  it('上课提醒固定提前 15 分钟并带上教室', () => {
    const draft = classReminderDraft('2025-10-08T08:00', '数据结构', 'A301');
    assert.equal(draft.fireAt, '2025-10-08T07:45');
    assert.equal(draft.level, 'class_15');
    assert.ok(draft.reason.includes('A301'));
  });
});

describe('reminders: 补弹窗口', () => {
  it('错过 24 小时内的提醒会在唤醒后补弹', () => {
    assert.equal(isWithinCatchUp('2025-10-08T09:00', '2025-10-08T12:00'), true);
    assert.equal(isWithinCatchUp('2025-10-06T09:00', '2025-10-08T12:00'), false);
    assert.equal(isWithinCatchUp('2025-10-08T13:00', '2025-10-08T12:00'), false);
  });
});
