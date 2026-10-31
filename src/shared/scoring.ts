/**
 * 紧迫度相关：排序权重与语义（设计文档 7.1）。
 * 紧迫度既影响排程优先级（见 planner.ts），也影响提醒频率（见 reminders.ts）。
 */

import type { Task, Urgency } from './types';
import { minutesBetween } from './time';

export interface UrgencyMeta {
  value: Urgency;
  label: string;
  meaning: string;
  /** 排程倾向的中文说明，用于界面提示 */
  scheduling: string;
  /** 权重，越大越优先 */
  weight: number;
  /** 提醒提前量（分钟），由近到远 */
  offsets: number[];
  color: string;
}

export const URGENCY_TABLE: Record<Urgency, UrgencyMeta> = {
  5: {
    value: 5,
    label: '紧急',
    meaning: '今天必须交 / 必须做完',
    scheduling: '最高优先，占用你的高效时段，允许拆成多块连排',
    weight: 50,
    offsets: [4320, 1440, 120, 30],
    color: '#E5484D'
  },
  4: {
    value: 4,
    label: '很急',
    meaning: '本周内必须完成',
    scheduling: '次高优先，排在普通任务之前',
    weight: 35,
    offsets: [1440, 120, 30],
    color: '#F76B15'
  },
  3: {
    value: 3,
    label: '正常',
    meaning: '按计划推进即可',
    scheduling: '按截止时间顺序排队',
    weight: 20,
    offsets: [1440, 60],
    color: '#4F7CFF'
  },
  2: {
    value: 2,
    label: '不急',
    meaning: '有空再做',
    scheduling: '填充剩余空闲，必要时可被挤后',
    weight: 10,
    offsets: [480],
    color: '#12A594'
  },
  1: {
    value: 1,
    label: '随意',
    meaning: '想做就做，无硬截止',
    scheduling: '只在真正空闲时安排，默认不排入日程',
    weight: 3,
    offsets: [],
    color: '#8A8F98'
  }
};

export function urgencyMeta(u: Urgency): UrgencyMeta {
  return URGENCY_TABLE[u] ?? URGENCY_TABLE[3];
}
/** Smooth priority: 60% deadline proximity (48h decay), 40% urgency; overdue +30. */
export function taskPriority(task:Task,now:string){const hours=task.dueAt?minutesBetween(now,task.dueAt)/60:Infinity;return 60/(1+Math.max(0,hours)/48)+40*(task.urgency-1)/4+(hours<=0?30:0);}
export function sortTasksByPriority(tasks:Task[],now:string):Task[]{return tasks.slice().sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||taskPriority(b,now)-taskPriority(a,now)||(a.dueAt??'9999').localeCompare(b.dueAt??'9999')||a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));}

/** 任务类型的排程权重：考试复习 > 作业 > 生活 */
export function typeWeight(task: Pick<Task, 'type' | 'domain'>): number {
  if (task.type === 'exam_prep') return 15;
  if (task.type === 'assignment' || task.type === 'experiment' || task.type === 'paper') return 10;
  if (task.type === 'event') return 8;
  if (task.domain === 'life') return 2;
  return 5;
}

/**
 * 紧急度分数（设计文档 3.3 的排序公式）。
 * 超期 +1000；24h 内最高 +500；7 天内 +100；更远 +10。
 * 分数越大越靠前。
 */
export function taskScore(task: Task, now: string): number {
  let score = 0;
  let urgencyBoost = 0;

  if (task.dueAt) {
    const mins = minutesBetween(now, task.dueAt);
    if (mins <= 0) {
      score += 1000;
      urgencyBoost = 50;
    } else if (mins <= 1440) {
      score += 500 * (1 - mins / 1440);
      urgencyBoost = 30;
    } else if (mins <= 10080) {
      score += 100 * (1 - mins / 10080);
      urgencyBoost = 12;
    } else {
      score += 10;
      urgencyBoost = 4;
    }
  }

  score += urgencyBoost;
  score += urgencyMeta(task.urgency).weight;
  score += typeWeight(task);

  if (task.status === 'doing') score += 25;
  return score;
}

/** 是否已超期（未完成且过了截止时间） */
export function isOverdue(task: Task, now: string): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'done' || task.status === 'canceled') return false;
  return minutesBetween(now, task.dueAt) <= 0;
}

/** 是否为需要出现在"今日临期"里的活跃任务 */
export function isActive(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'canceled';
}

/** 无截止时间的任务之间，紧迫度高的靠前 */
function byUrgencyWeight(a: Task, b: Task): number {
  return urgencyMeta(b.urgency).weight - urgencyMeta(a.urgency).weight;
}

/**
 * 排序总入口（设计文档 3.3）：
 *  1. 已超期的排最前（逾期越久越前），与"今天/明天到期的"分开看
 *  2. 其余有截止时间的按紧急度分数降序，同分按截止时间升序
 *  3. 没有截止时间的沉到后面，内部按紧迫度排
 *
 * 注意：这里刻意不把 taskScore 混着超期一起排——否则"紧迫度 5、下周才交"的任务
 * 会压过"昨天就该交"的任务，与用户直觉不符。
 */
export function sortTasksByUrgency(tasks: Task[], now: string): Task[] {
  const overdue = tasks.filter((t) => isOverdue(t, now));
  const rest = tasks.filter((t) => !isOverdue(t, now));

  overdue.sort((a, b) => {
    if (a.dueAt !== b.dueAt) return (a.dueAt as string) < (b.dueAt as string) ? -1 : 1;
    return urgencyMeta(b.urgency).weight - urgencyMeta(a.urgency).weight;
  });

  const withDue = rest.filter((t) => t.dueAt);
  const withoutDue = rest.filter((t) => !t.dueAt);

  withDue.sort((a, b) => {
    const diff = taskScore(b, now) - taskScore(a, now);
    if (Math.abs(diff) > 1e-6) return diff > 0 ? 1 : -1;
    if (a.dueAt !== b.dueAt) return (a.dueAt as string) < (b.dueAt as string) ? -1 : 1;
    return a.title.localeCompare(b.title, 'zh-CN');
  });

  withoutDue.sort((a, b) => byUrgencyWeight(a, b) || a.title.localeCompare(b.title, 'zh-CN'));

  return [...overdue, ...withDue, ...withoutDue];
}
