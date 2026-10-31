/**
 * 提醒时刻生成（设计文档 10.1）：紧迫程度与任务类型共同决定提前量。
 * 纯函数：只负责算出"应该在哪些时刻提醒"，不负责调度。
 */

import type { Exam, Task, Urgency } from './types';
import { addMinutes, humanDuration, minutesBetween } from './time';
import { urgencyMeta } from './scoring';

export interface ReminderDraft {
  /** 触发时刻 `YYYY-MM-DDTHH:mm` */
  fireAt: string;
  /** 提前量（分钟） */
  offsetMinutes: number;
  level: string;
  reason: string;
}

function levelOf(offsetMinutes: number): string {
  if (offsetMinutes >= 2880) return 'd3';
  if (offsetMinutes >= 1440) return 'd1';
  if (offsetMinutes >= 120) return 'h2';
  if (offsetMinutes >= 60) return 'h1';
  if (offsetMinutes >= 30) return 'm30';
  if (offsetMinutes >= 10) return 'm10';
  return 'custom';
}

/** 已过期的提醒点是否还要保留（用于补弹判断，默认保留 24 小时内） */
export function isWithinCatchUp(fireAt: string, now: string, catchUpMinutes = 1440): boolean {
  const diff = minutesBetween(fireAt, now);
  return diff >= 0 && diff <= catchUpMinutes;
}

/**
 * 生成任务的所有提醒点。
 * - remindPolicy='none' → 空
 * - remindPolicy='custom' → 使用 remindOffsets
 * - 默认 → 由紧迫程度决定（紧迫 1 无提醒点，只进每日汇总）
 */
export function reminderDraftsForTask(task: Task): ReminderDraft[] {
  if (task.remindPolicy === 'none') return [];
  if (!task.dueAt) return [];

  let offsets: number[];
  if (task.remindPolicy === 'custom') {
    offsets = [...(task.remindOffsets ?? [])];
  } else {
    offsets = [...urgencyMeta(task.urgency).offsets];
  }

  // 去重 + 从远到近排序
  offsets = [...new Set(offsets.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => b - a);

  return offsets.map((offsetMinutes) => ({
    fireAt: addMinutes(task.dueAt as string, -offsetMinutes),
    offsetMinutes,
    level: levelOf(offsetMinutes),
    reason: `距截止 ${humanDuration(offsetMinutes)}`
  }));
}

/** 考试提醒：前 3 天 / 1 天 / 2 小时 / 30 分钟 */
export function reminderDraftsForExam(exam: Exam): ReminderDraft[] {
  const offsets = exam.difficulty >= 4 ? [4320, 1440, 120, 30] : [1440, 120, 30];
  return offsets.map((offsetMinutes) => ({
    fireAt: addMinutes(exam.examAt, -offsetMinutes),
    offsetMinutes,
    level: levelOf(offsetMinutes),
    reason: `${exam.subject} 距开考 ${humanDuration(offsetMinutes)}`
  }));
}

/** 上课提醒：开始前 15 分钟 */
export function classReminderDraft(lessonStartAt: string, courseName: string, room?: string): ReminderDraft {
  return {
    fireAt: addMinutes(lessonStartAt, -15),
    offsetMinutes: 15,
    level: 'class_15',
    reason: `15 分钟后上 ${courseName}${room ? `（${room}）` : ''}`
  };
}

/** 紧迫度 5 的任务在临近截止时升级为强提醒（不自动消失） */
export function isStrongReminder(task: Task, draft: ReminderDraft): boolean {
  return task.urgency >= 5 && draft.offsetMinutes <= 120;
}

export function urgencyOffsetSummary(u: Urgency): string {
  const offsets = urgencyMeta(u).offsets;
  if (offsets.length === 0) return '仅每日汇总';
  return offsets.map((o) => humanDuration(o)).join(' / ');
}
