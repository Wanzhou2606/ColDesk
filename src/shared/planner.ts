/**
 * 自动排程引擎（设计文档第 6 节）。
 *
 * 设计要点：
 *  - 纯函数：输入数据快照，输出编排块草案，不接触数据库与 Electron。
 *  - 全自动：排完直接可用；用户拖动过的块（locked）不参与重排。
 *  - 可解释：每个块都带 reason，说明"为什么排在这个时间"。
 *  - 不静默丢弃：排不下的任务回到 unscheduled，并附上原因。
 */

import type {
  BusyBlock,
  Course,
  CourseSession,
  CourseSessionOverride,
  Domain,
  Exam,
  ScheduleBlock,
  Semester,
  Task,
  TimeSlot
} from './types';
import { expandDayLessons } from './timetable';
import { isActive, taskScore, urgencyMeta } from './scoring';
import { addDays, dateOf, hhmmToMinutes, humanDuration, minutesToHhmm, weekdayOf } from './time';

export interface Interval {
  start: number;
  end: number;
}

export interface PlannerPrefs {
  /** 每天各个域允许安排任务的时段（`HH:mm`） */
  windows: Record<Domain, Array<{ start: string; end: string }>>;
  /** 单日单域安排上限（分钟） */
  dailyCapMinutes: Record<Domain, number>;
  minBlockMinutes: number;
  maxBlockMinutes: number;
  /** 块间休息（分钟） */
  breakMinutes: number;
  /** 睡前不排任务的缓冲（分钟） */
  nightBufferMinutes: number;
  /** 周末上限折减系数 */
  weekendFactor: number;
  /** 截止前必须留出的缓冲比例，如 0.2 表示留 20% */
  dueBufferRatio: number;
  /** 每次排程覆盖的天数 */
  horizonDays: number;
}

export const DEFAULT_PREFS: PlannerPrefs = {
  windows: {
    study: [
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
      { start: '19:00', end: '23:00' }
    ],
    life: [
      { start: '12:00', end: '13:30' },
      { start: '18:00', end: '19:00' },
      { start: '21:00', end: '23:00' }
    ]
  },
  dailyCapMinutes: { study: 180, life: 60 },
  minBlockMinutes: 25,
  maxBlockMinutes: 90,
  breakMinutes: 10,
  nightBufferMinutes: 30,
  weekendFactor: 0.5,
  dueBufferRatio: 0.2,
  horizonDays: 14
};

export interface PlannerTaskInput {
  id: string;
  title: string;
  domain: Domain;
  type: Task['type'];
  urgency: Task['urgency'];
  priorityScore: number;
  dueAt?: string;
  estMinutes: number;
  splittable: boolean;
  earliestStart?: string;
  courseId?: string;
}

export interface BlockDraft {
  taskId: string;
  date: string;
  startAt: string;
  endAt: string;
  plannedMinutes: number;
  origin: 'auto';
  /** 保持既有块的 id，便于数据库按 id upsert */
  keepId?: string;
  reason: string;
}

export interface UnscheduledTask {
  taskId: string;
  title: string;
  reason: string;
}

export interface PlanWarning {
  code: 'capacity_shortage' | 'past_due' | 'no_window';
  message: string;
  taskId?: string;
}

export interface PlanInput {
  now: string;
  semester?: Semester;
  courses: Course[];
  sessions: CourseSession[];
  overrides: CourseSessionOverride[];
  timeSlots: TimeSlot[];
  exams: Exam[];
  busy: BusyBlock[];
  /** 保持不动的块（用户锁定或手动指定） */
  lockedBlocks: Pick<ScheduleBlock, 'id' | 'taskId' | 'date' | 'startAt' | 'endAt' | 'plannedMinutes'>[];
  tasks: PlannerTaskInput[];
  prefs?: Partial<PlannerPrefs>;
}

export interface PlanResult {
  blocks: BlockDraft[];
  unscheduled: UnscheduledTask[];
  warnings: PlanWarning[];
}

// ---------------------------------------------------------------- 区间工具

export function mergeIntervals(list: Interval[]): Interval[] {
  if (list.length === 0) return [];
  const sorted = [...list]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function subtractIntervals(base: Interval[], cut: Interval[]): Interval[] {
  const cuts = mergeIntervals(cut);
  let result = mergeIntervals(base);
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const seg of result) {
      if (c.end <= seg.start || c.start >= seg.end) {
        next.push(seg);
        continue;
      }
      if (c.start > seg.start) next.push({ start: seg.start, end: c.start });
      if (c.end < seg.end) next.push({ start: c.end, end: seg.end });
    }
    result = next;
  }
  return result.filter((i) => i.end - i.start > 0);
}

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end - start > 0) out.push({ start, end });
    }
  }
  return mergeIntervals(out);
}

// ---------------------------------------------------------------- 可用时段

function toMinutes(hhmm: string): number {
  return hhmmToMinutes(hhmm);
}

/** 把某一天所有硬占用（课程、考试、固定占用、已锁定块）合并成区间 */
export function busyIntervalsOfDay(input: {
  date: string;
  semester?: Semester;
  courses: Course[];
  sessions: CourseSession[];
  overrides: CourseSessionOverride[];
  timeSlots: TimeSlot[];
  exams: Exam[];
  busy: BusyBlock[];
  lockedBlocks: PlanInput['lockedBlocks'];
}): Interval[] {
  const { date } = input;
  const intervals: Interval[] = [];

  if (input.semester) {
    const lessons = expandDayLessons({
      date,
      semester: input.semester,
      courses: input.courses,
      sessions: input.sessions,
      overrides: input.overrides,
      timeSlots: input.timeSlots
    });
    for (const l of lessons) {
      intervals.push({ start: toMinutes(l.startAt.slice(11, 16)), end: toMinutes(l.endAt.slice(11, 16)) });
    }
  }

  for (const exam of input.exams) {
    if (dateOf(exam.examAt) !== date) continue;
    const start = toMinutes(exam.examAt.slice(11, 16));
    intervals.push({ start, end: start + (exam.durationMinutes ?? 120) });
  }

  for (const b of input.busy) {
    const matches = b.date ? b.date === date : b.weekday === weekdayOf(date);
    if (!matches) continue;
    intervals.push({
      start: toMinutes(b.startAt.slice(11, 16)),
      end: toMinutes(b.endAt.slice(11, 16))
    });
  }

  for (const lock of input.lockedBlocks) {
    if (lock.date !== date) continue;
    intervals.push({
      start: toMinutes(lock.startAt.slice(11, 16)),
      end: toMinutes(lock.endAt.slice(11, 16))
    });
  }

  return mergeIntervals(intervals);
}

/** 某一天某个域真正可用的空闲区间 */
export function freeSlotsOfDay(input: {
  date: string;
  domain: Domain;
  prefs: PlannerPrefs;
  busyIntervals: Interval[];
  /** 用于判断周末折减 */
  nowDate: string;
}): Interval[] {
  const { date, domain, prefs, busyIntervals } = input;
  const isWeekend = weekdayOf(date) >= 6;

  let windows: Interval[] = prefs.windows[domain].map((w) => ({
    start: toMinutes(w.start),
    end: toMinutes(w.end)
  }));

  if (isWeekend) {
    // 周末只保留每个窗口的前 1/2 段，等效于单日上限折减
    windows = windows.map((w) => ({
      start: w.start,
      end: w.start + Math.max(prefs.minBlockMinutes, Math.round((w.end - w.start) * (1 - prefs.weekendFactor)))
    }));
  }

  const free = subtractIntervals(windows, busyIntervals);
  if (free.length === 0) return [];

  // 睡前缓冲只裁掉当天最后一个空闲段的末尾，不能影响下午等其他时段
  const last = free[free.length - 1];
  const trimmedEnd = Math.max(last.start, last.end - prefs.nightBufferMinutes);
  const result = [...free.slice(0, -1), { start: last.start, end: trimmedEnd }];

  // 这里不再按最短块过滤：排程会用"每块不超过单日额度"的方式整体分配，
  // 过滤掉短空闲段反而会让任务余量永远排不完。
  return result.filter((i) => i.end - i.start > 0);
}

// ---------------------------------------------------------------- 排序

/** 排程优先级：与界面排序同源，保证"看起来最急的排得最早" */
export function plannerPriority(task: PlannerTaskInput): number {
  return task.priorityScore + urgencyMeta(task.urgency).weight;
}

/**
 * 把计划量排进空闲段（贪心 + 收尾允许短块）。
 *
 * 规则：
 *  - 每块不超过 maxBlockMinutes，块间留 breakMinutes；
 *  - 只要还剩时间就继续往后找空闲段，因此不会出现"排不完的余量"；
 *  - 收尾那一块允许短于 minBlockMinutes（例如 100 分钟＝90+10），
 *    这比把 10 分钟推到第二天、或永远排不完更符合直觉。
 *  - 不可拆分的任务优先只占一个连续空闲段；实在放不下才允许跨段，调用方据此提示用户。
 */
function allocateFrom(
  slots: Interval[],
  budget: { remaining: number },
  prefs: PlannerPrefs,
  splittable: boolean
): Array<{ start: number; end: number }> {
  const planned: Array<{ start: number; end: number }> = [];
  const maxLen = prefs.maxBlockMinutes;
  const minLen = prefs.minBlockMinutes;
  let usedSlot = false;

  for (const slot of slots) {
    if (budget.remaining <= 0) break;
    if (!splittable && usedSlot) break;

    let cursor = slot.start;
    while (budget.remaining > 0 && cursor < slot.end) {
      const available = slot.end - cursor;
      if (available <= 0) break;

      // 收尾：余量不足最小时长时，优先并入刚排的块（同一天、相邻），否则才新开一小块
      if (budget.remaining < minLen) {
        const take = Math.min(budget.remaining, available);
        const prev = planned[planned.length - 1] as { start: number; end: number } | undefined;
        const sameSlotGap = prev ? cursor - prev.end : Number.POSITIVE_INFINITY;
        const grown = prev ? prev.end - prev.start + take : Number.POSITIVE_INFINITY;
        if (prev && sameSlotGap <= prefs.breakMinutes && grown <= Math.round(maxLen * 1.33)) {
          prev.end += take;
        } else {
          planned.push({ start: cursor, end: cursor + take });
        }
        budget.remaining -= take;
        usedSlot = true;
        break;
      }

      if (available < minLen) break;
      const take = Math.min(maxLen, budget.remaining, available);
      planned.push({ start: cursor, end: cursor + take });
      budget.remaining -= take;
      cursor += take + (budget.remaining > 0 ? prefs.breakMinutes : 0);
      usedSlot = true;
      if (!splittable) break;
    }
    if (!splittable && usedSlot) break;
  }

  return planned;
}

/**
 * 主入口：把任务编排到日程。
 * 不修改任何输入，返回全新的块草案。
 */
export function planSchedule(input: PlanInput): PlanResult {
  const prefs: PlannerPrefs = {
    ...DEFAULT_PREFS,
    ...input.prefs,
    windows: { ...DEFAULT_PREFS.windows, ...(input.prefs?.windows ?? {}) },
    dailyCapMinutes: { ...DEFAULT_PREFS.dailyCapMinutes, ...(input.prefs?.dailyCapMinutes ?? {}) }
  };

  const startDate = dateOf(input.now);
  const nowMinutes = toMinutes(input.now.slice(11, 16));
  const days: string[] = [];
  for (let i = 0; i < prefs.horizonDays; i += 1) days.push(addDays(startDate, i));

  // 预计算每天的硬占用与剩余可用
  const busyByDay = new Map<string, Interval[]>();
  const freeByDay = new Map<string, Interval[]>();
  const usedByDay = new Map<string, number>();

  for (const date of days) {
    const busyIntervals = busyIntervalsOfDay({
      date,
      semester: input.semester,
      courses: input.courses,
      sessions: input.sessions,
      overrides: input.overrides,
      timeSlots: input.timeSlots,
      exams: input.exams,
      busy: input.busy,
      lockedBlocks: input.lockedBlocks
    });
    busyByDay.set(date, busyIntervals);
    freeByDay.set(
      date,
      freeSlotsOfDay({ date, domain: 'study', prefs, busyIntervals, nowDate: startDate })
    );
    // 生活域单独计算，按需生成
    usedByDay.set(`${date}|study`, 0);
    usedByDay.set(`${date}|life`, 0);
  }

  // 已被锁定块占用的额度也要计入单日上限
  for (const lock of input.lockedBlocks) {
    const task = input.tasks.find((t) => t.id === lock.taskId);
    if (!task) continue;
    const key = `${lock.date}|${task.domain}`;
    usedByDay.set(key, (usedByDay.get(key) ?? 0) + lock.plannedMinutes);
  }

  const blocks: BlockDraft[] = [];
  const unscheduled: UnscheduledTask[] = [];
  const warnings: PlanWarning[] = [];
  const tasks = [...input.tasks].sort((a, b) => plannerPriority(b) - plannerPriority(a));

  const pushWarning = (w: PlanWarning) => {
    if (!warnings.some((x) => x.code === w.code && x.taskId === w.taskId)) warnings.push(w);
  };

  for (const task of tasks) {
    if (task.estMinutes <= 0) continue;
    // 手动安排代表用户已经确定这项任务的时间，不再给它生成额外的自动副本。
    if (input.lockedBlocks.some(block=>block.taskId===task.id)) continue;
    const remainingMinutes = task.estMinutes;
    if (task.dueAt && task.dueAt < input.now) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        reason: '截止时间已过，需要立即处理或延期 DDL'
      });
      pushWarning({
        code: 'past_due',
        taskId: task.id,
        message: `「${task.title}」已过截止时间，未排入日程`
      });
      continue;
    }

    const dueMinuteOfDay = task.dueAt ? toMinutes(task.dueAt.slice(11, 16)) : undefined;
    const earliest = task.earliestStart ? toMinutes(task.earliestStart.slice(11, 16)) : 0;

    const planned: Array<{ date: string; start: number; end: number }> = [];
    const budget = { remaining: remainingMinutes };

    for (const date of days) {
      if (budget.remaining <= 0) break;
      // 截止当天仍然可以安排，只有过了截止日才停
      if (task.dueAt && date > dateOf(task.dueAt)) break;

      const freeAll = freeByDay.get(date) ?? [];
      const free =
        task.domain === 'study'
          ? freeAll
          : freeSlotsOfDay({
              date,
              domain: 'life',
              prefs,
              busyIntervals: busyByDay.get(date) ?? [],
              nowDate: startDate
            });

      let slots = free;
      if (date === startDate) {
        // 今天只保留"现在之后"的部分：
        //  - 尚未开始的时段，起点推迟到 now+5（留一点准备时间）
        //  - 正在进行中的时段，起点保持不动，否则会出现 start > end 被整段丢弃
        slots = slots
          .filter((s) => s.end > nowMinutes)
          .map((s) => ({
            start: s.start <= nowMinutes ? Math.max(s.start, nowMinutes) : Math.max(s.start, nowMinutes + 5),
            end: s.end
          }))
          .filter((s) => s.end - s.start >= prefs.minBlockMinutes);
      }
      if (earliest > 0) {
        slots = slots
          .map((s) => ({ start: Math.max(s.start, earliest), end: s.end }))
          .filter((s) => s.end - s.start >= prefs.minBlockMinutes);
      }

      // 单日上限：今天只花掉当日剩余额度，未排完的部分自然留到后面几天继续排
      const capKey = `${date}|${task.domain}`;
      const used = usedByDay.get(capKey) ?? 0;
      const capLeft = prefs.dailyCapMinutes[task.domain] - used;
      if (capLeft < 1) continue;
      const want = Math.min(budget.remaining, capLeft);

      // 截止当天为校准缓冲留出空间
      if (task.dueAt && date === dateOf(task.dueAt) && dueMinuteOfDay !== undefined) {
        const buffer = Math.round(prefs.dueBufferRatio * task.estMinutes);
        const deadline = dueMinuteOfDay - buffer;
        slots = slots
          .map((s) => ({ start: s.start, end: Math.min(s.end, deadline) }))
          .filter((s) => s.end - s.start >= prefs.minBlockMinutes);
        if (slots.length === 0) {
          // 今天留不出缓冲，不代表前面几天也排不下，继续看下一天
          continue;
        }
      }

      const before = budget.remaining;
      const localBudget = { remaining: want };
      const allocated = allocateFrom(slots, localBudget, prefs, task.splittable);
      if (allocated.length === 0) continue;

      let assigned = 0;
      for (const a of allocated) {
        planned.push({ date, start: a.start, end: a.end });
        assigned += a.end - a.start;
      }
      // 只有真正排进去的时间才从总预算里扣除
      budget.remaining -= assigned;
      usedByDay.set(capKey, used + assigned);
      // 已安排的自动块也占用时间，后续任务必须避开，不能只扣容量。
      const occupied = allocated.map(block => ({ start: block.start, end: Math.min(1440, block.end + prefs.breakMinutes) }));
      busyByDay.set(date, mergeIntervals([...(busyByDay.get(date) ?? []), ...occupied]));
      freeByDay.set(date, subtractIntervals(freeByDay.get(date) ?? [], occupied));
      if (before === budget.remaining) break;
    }

    if (planned.length === 0) {
      if (!unscheduled.some((u) => u.taskId === task.id)) {
        const noWindow = Boolean(task.dueAt) && dateOf(task.dueAt as string) === startDate;
        if (noWindow) {
          unscheduled.push({
            taskId: task.id,
            title: task.title,
            reason: `截止前留不出 ${humanDuration(prefs.minBlockMinutes)} 的完整时段`
          });
          pushWarning({
            code: 'no_window',
            taskId: task.id,
            message: `「${task.title}」在截止前没有可用时段，请提前开始或调整截止时间`
          });
        } else {
          unscheduled.push({
            taskId: task.id,
            title: task.title,
            reason: '未来可安排时段已被占满'
          });
          pushWarning({
            code: 'capacity_shortage',
            taskId: task.id,
            message: `「${task.title}」排不进未来 ${prefs.horizonDays} 天的可执行时段`
          });
        }
      }
      continue;
    }

    const reason = buildReason(task, planned, budget.remaining);
    for (const p of planned) {
      blocks.push({
        taskId: task.id,
        date: p.date,
        startAt: `${p.date}T${minutesToHhmm(p.start)}`,
        endAt: `${p.date}T${minutesToHhmm(p.end)}`,
        plannedMinutes: p.end - p.start,
        origin: 'auto',
        reason
      });
    }

    if (budget.remaining > 0) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        reason: `仅安排了 ${humanDuration(task.estMinutes - budget.remaining)}，还差 ${humanDuration(budget.remaining)}`
      });
      pushWarning({
        code: 'capacity_shortage',
        taskId: task.id,
        message: `「${task.title}」只排下一部分，建议延长可执行时段或拆成子任务`
      });
    }
  }

  return { blocks, unscheduled, warnings };
}

function buildReason(
  task: PlannerTaskInput,
  planned: Array<{ date: string; start: number; end: number }>,
  remaining: number
): string {
  const parts: string[] = [];
  parts.push(`紧迫度 ${task.urgency}`);
  if (task.dueAt) parts.push(`截止 ${task.dueAt.slice(5, 10).replace('-', '月')}日 ${task.dueAt.slice(11, 16)}`);
  parts.push(`预估 ${humanDuration(task.estMinutes)}`);
  if (planned.length > 1) {
    const ranges = planned
      .map((p) => `${p.date.slice(5, 10).replace('-', '/')} ${minutesToHhmm(p.start)}-${minutesToHhmm(p.end)}`)
      .join('、');
    parts.push(`拆为 ${planned.length} 块（${ranges}）`);
  } else {
    const p = planned[0];
    parts.push(`安排 ${p.date.slice(5, 10).replace('-', '/')} ${minutesToHhmm(p.start)}-${minutesToHhmm(p.end)}`);
  }
  if (remaining > 0) parts.push(`仍有 ${humanDuration(remaining)} 未排入`);
  return parts.join(' · ');
}

/** 把仓储层的 Task 转成排程输入（界面排序与排程共用同一分数） */
export function toPlannerTask(task: Task, now: string): PlannerTaskInput {
  return {
    id: task.id,
    title: task.title,
    domain: task.domain,
    type: task.type,
    urgency: task.urgency,
    priorityScore: taskScore(task, now),
    dueAt: task.dueAt,
    estMinutes: task.estMinutes ?? 45,
    splittable: task.splittable,
    earliestStart: task.earliestStart,
    courseId: task.courseId
  };
}

export function selectPlannableTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => isActive(t) && t.autoScheduled && t.urgency > 1);
}
