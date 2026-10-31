import {segmentNumber} from './taskSegments';
import {eventTimeLabel} from './calendarEvents';
/**
 * 悬浮窗与日视图的"当下日程"选取逻辑（设计文档 4.3）。
 * 纯函数：给定数据快照与当前时刻，算出该显示什么。
 */

import type {
  LessonMetadata,
  BusyBlock,
  Course,
  CourseSession,
  CourseSessionOverride,
  DayBlock,
  Exam,
  ScheduleBlock,
  Semester,
  Task,
  TimeSlot,
  Urgency
} from './types';
import { expandDayLessons, upcomingLessons, type UpcomingLesson } from './timetable';
import { isActive, sortTasksByPriority as sortTasksByUrgency, urgencyMeta } from './scoring';
import { addDays, dateOf, humanDuration, localToMinutes, minutesBetween, relativeDay, weekdayCn, weekdayOf } from './time';

/** 周视图里的一天的渲染数据 */
export interface WeekDayView {
  date: string;
  /** "周三" */
  weekday: string;
  /** "10/08" */
  dayLabel: string;
  isToday: boolean;
  blocks: Array<LessonMetadata & {
    eventId?:string;detail?:string;eventType?:import('./calendarEvents').CalendarEvent['type'];
    id: string;
    kind: DayBlock['kind'];
    title: string;
    location?: string;
    color?: string;
    startMinute: number;
    endMinute: number;
    timeLabel: string;
    reason?: string;
    locked?: boolean;
    taskId?: string;
  }>;
}

export interface WeekView {
  /** 这一周每天的课、考试、固定占用与编排块 */
  days: WeekDayView[];
  weekStart: string;
  /** 本周内到期的任务数 */
  dueCount: number;
  /** 最早有课/有事的一天索引，便于默认滚动 */
  firstBusyIndex: number;
}

export interface AgendaSnapshot {
  events?:import('./calendarEvents').CalendarEvent[];
  semester?: Semester;
  courses: Course[];
  sessions: CourseSession[];
  overrides: CourseSessionOverride[];
  timeSlots: TimeSlot[];
  tasks: Task[];
  exams: Exam[];
  blocks: ScheduleBlock[];
  busy: BusyBlock[];
}

export interface AgendaItem {
  id: string;
  kind: DayBlock['kind'];
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  color?: string;
  courseId?: string;
  taskId?: string;
  urgency?: Urgency;
  /** 正在进行 / 即将开始 / 之后的安排 */
  status: 'ongoing' | 'soon' | 'upcoming';
  /** 还有多少分钟开始（进行中为 0） */
  untilStartMinutes: number;
  /** 还有多少分钟结束（已结束为负数） */
  untilEndMinutes: number;
  /** 展示用时间文字 */
  timeLabel: string;
  /** 展示用倒计时文字 */
  countdownLabel: string;
  reason?: string;
}

export interface DueTask {
  task: Task;
  overdue: boolean;
  dueLabel: string;
  /** 距截止还有多少分钟；无截止时间为 null */
  untilDueMinutes: number | null;
}

export interface Agenda {
  now: string;
  date: string;
  dateLabel: string;
  current?: AgendaItem;
  next: AgendaItem[];
  timeline: DayBlock[];
  /** 未来 7 天的概览，供周视图渲染 */
  week: WeekView;
  /** 今日临期：今天到期的 + 已超期未处理的 */
  todayTasks: DueTask[];
  /** 跨天临期：今天之后 7 天内的 */
  urgentTasks: DueTask[];
  /** 上面两组里已超期的部分，供摘要与徽标使用 */
  overdueTasks: DueTask[];
  summary: {
    lessonCount: number;
    dueTodayCount: number;
    overdueCount: number;
    doneTodayCount: number;
    plannedMinutes: number;
  };
}

/** 一天内所有块的统一时间线（课程 + 考试 + 编排块 + 生活/固定占用） */
export function buildTimeline(input: {
  date: string;
  snapshot: AgendaSnapshot;
}): DayBlock[] {
  const { date, snapshot } = input;
  const out: DayBlock[] = [];
  const groups=new Map<string,typeof snapshot.blocks>();
  for(const block of snapshot.blocks){const group=groups.get(block.taskId)??[];group.push(block);groups.set(block.taskId,group);}
  const numbers=new Map<string,string>();for(const group of groups.values())if(group.length>1)group.slice().sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.id.localeCompare(b.id)).forEach((block,i)=>numbers.set(block.id,segmentNumber(i+1)));

  if (snapshot.semester) {
    const lessons = expandDayLessons({
      date,
      semester: snapshot.semester,
      courses: snapshot.courses,
      sessions: snapshot.sessions,
      overrides: snapshot.overrides,
      timeSlots: snapshot.timeSlots
    });
    for (const l of lessons) {
      out.push({
        id: `lesson:${l.session.id}:${date}`,
        kind: 'lesson',
        title: l.course.name,
        startAt: l.startAt,
        endAt: l.endAt,
        location: l.room,
        color: l.course.color,
        courseId: l.course.id,
        teacher: l.teacher,
        lessonPeriods: l.lessonPeriods,
        lessonCount: l.lessonCount,
        lessonCountEstimated: l.lessonCountEstimated
      });
    }
  }

  for (const exam of snapshot.exams) {
    if (dateOf(exam.examAt) !== date) continue;
    const dur = exam.durationMinutes ?? 120;
    const d = new Date(exam.examAt);
    d.setMinutes(d.getMinutes() + dur);
    const pad = (n: number) => String(n).padStart(2, '0');
    out.push({
      id: `exam:${exam.id}`,
      kind: 'exam',
      title: `考试 · ${exam.subject}`,
      startAt: exam.examAt,
      endAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      location: exam.location,
      color: '#1F2937',
      examId: exam.id
    });
  }

  for (const b of snapshot.blocks) {
    if (b.date !== date) continue;
    const task = snapshot.tasks.find((t) => t.id === b.taskId);
    if (!task) continue;
    out.push({
      id: `block:${b.id}`,
      kind: 'block',
      title: task.title+(numbers.has(b.id)?' '+numbers.get(b.id):''),
      startAt: b.startAt,
      endAt: b.endAt,
      color: '#4F7CFF',
      taskId: task.id,
      urgency: task.urgency,
      reason: b.reason,
      locked: b.locked || b.origin === 'manual'
    });
  }

  for (const busy of snapshot.busy) {
    const matches = busy.date ? busy.date === date : busy.weekday === weekdayOf(date);
    if (!matches) continue;
    out.push({
      id: `busy:${busy.id}`,
      kind: 'busy',
      title: busy.title,
      startAt: `${date}T${busy.startAt.slice(-5)}`,
      endAt: `${date}T${busy.endAt.slice(-5)}`,
      color: '#9AA1AC',
      taskId: busy.id
    });
  }

  for(const event of snapshot.events??[]){if(event.startAt.slice(0,10)===date)out.push({id:`event:${event.id}`,eventId:event.id,detail:event.detail,eventType:event.type,kind:'busy',title:event.title,startAt:event.startAt,endAt:event.endAt,color:event.type==='class'?'#a9c7e8':event.type==='lecture'?'#c3b6e7':'#a9d7c0',locked:true});}
  return out
    .filter((b) => b.startAt < b.endAt || !!b.eventId && b.startAt===b.endAt)
    .sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
}

function countdownLabel(untilStart: number, untilEnd: number): string {
  if (untilStart <= 0 && untilEnd > 0) {
    return `还有 ${humanDuration(untilEnd)}结束`;
  }
  if (untilStart > 0 && untilStart <= 60) return `${untilStart} 分钟后开始`;
  if (untilStart > 60) return `${humanDuration(untilStart)}后开始`;
  return '已完成';
}

function toAgendaItem(block: DayBlock, now: string): AgendaItem {
  const untilStartMinutes = minutesBetween(now, block.startAt);
  const untilEndMinutes = minutesBetween(now, block.endAt);
  const status: AgendaItem['status'] =
    untilStartMinutes <= 0 && untilEndMinutes > 0
      ? 'ongoing'
      : untilStartMinutes <= 60
        ? 'soon'
        : 'upcoming';
  return {
    id: block.id,
    kind: block.kind,
    title: block.title,
    startAt: block.startAt,
    endAt: block.endAt,
    location: block.location,
    color: block.color,
    courseId: block.courseId,
    taskId: block.taskId,
    urgency: block.urgency,
    status,
    untilStartMinutes,
    untilEndMinutes,
    timeLabel: eventTimeLabel(block),
    countdownLabel: countdownLabel(untilStartMinutes, untilEndMinutes),
    reason: block.reason
  };
}

/** 可移动的安排（课程与考试是固定占用，不参与"接下来"的排序竞争） */
function isMovable(block: DayBlock): boolean {
  return block.kind === 'block' || block.kind === 'busy' || block.kind === 'task';
}

export function buildAgenda(snapshot: AgendaSnapshot, now: string): Agenda {
  const date = dateOf(now);
  const timeline = buildTimeline({ date, snapshot });

  // 正在进行的安排：优先课程/考试，其次编排块
  const nowMs = new Date(now).getTime();
  const ongoing = timeline.filter(
    (b) => new Date(b.startAt).getTime() <= nowMs && new Date(b.endAt).getTime() > nowMs
  );
  const currentBlock =
    ongoing.find((b) => b.kind === 'lesson') ??
    ongoing.find((b) => b.kind === 'exam') ??
    ongoing[0];

  // 接下来的安排：尚未开始的块，按开始时间排序（课程/考试与可移动安排一起参与）
  const future = timeline
    .filter((b) => {
      const startsLater = new Date(b.startAt).getTime() > nowMs;
      return startsLater && (b.kind === 'lesson' || b.kind === 'exam' || isMovable(b));
    })
    .sort((a, b) => (a.startAt < b.startAt ? -1 : 1));

  let next: AgendaItem[] = future.slice(0, 3).map((b) => toAgendaItem(b, now));

  // 今天没有后续安排了 → 预览明天
  if (next.length === 0 && snapshot.semester) {
    const tomorrow = addDays(date, 1);
    const tomorrowTimeline = buildTimeline({ date: tomorrow, snapshot });
    next = tomorrowTimeline
      .filter((b) => b.kind === 'lesson' || b.kind === 'exam')
      .slice(0, 2)
      .map((b) => ({
        ...toAgendaItem(b, now),
        timeLabel: `明天 ${eventTimeLabel(b)}`
      }));
  }

  // 今日临期：今天到期的 + 已经超期还没处理的
  // （超期任务必须留在"当下"视野里，否则最该做的事反而看不见）
  const active = snapshot.tasks.filter(isActive);
  const todayTasks: DueTask[] = sortTasksByUrgency(
    active.filter((t) => t.dueAt && (dateOf(t.dueAt) === date || minutesBetween(now, t.dueAt) <= 0)),
    now
  ).map((task) => toDueTask(task, now));

  // 跨天临期：今天之后、7 天内的任务（超期与今日的已在上面）
  const urgentTasks: DueTask[] = sortTasksByUrgency(
    active.filter((t) => {
      if (!t.dueAt) return false;
      const dueDate = dateOf(t.dueAt);
      if (dueDate === date) return false;
      return dueDate > date && minutesBetween(now, t.dueAt) <= 10080;
    }),
    now
  ).map((task) => toDueTask(task, now));

  const doneTodayCount = snapshot.tasks.filter(
    (t) => t.status === 'done' && t.doneAt && dateOf(t.doneAt) === date
  ).length;

  const overdueTasks = todayTasks.filter((d) => d.overdue);
  return {
    now,
    date,
    dateLabel: `${date.slice(5, 7)}月${date.slice(8, 10)}日 ${weekdayCn(date)}`,
    current: currentBlock ? toAgendaItem(currentBlock, now) : undefined,
    next,
    timeline,
    week: buildWeek(snapshot, date),
    todayTasks,
    urgentTasks,
    overdueTasks,
    summary: {
      lessonCount: timeline.filter((b) => b.kind === 'lesson').length,
      dueTodayCount: todayTasks.length,
      overdueCount: overdueTasks.length,
      doneTodayCount,
      plannedMinutes: snapshot.blocks
        .filter((b) => b.date === date)
        .reduce((sum, b) => sum + b.plannedMinutes, 0)
    }
  };
}

/**
 * 未来 7 天的概览（周视图数据源）。
 * 与日视图同源：都走 buildTimeline，所以课程调课、考试、编排块两处永远一致。
 */
export function buildWeek(snapshot: AgendaSnapshot, fromDate: string, days = 7, currentDate = fromDate): WeekView {
  const out: WeekDayView[] = [];
  let dueCount = 0;

  for (let i = 0; i < days; i += 1) {
    const date = addDays(fromDate, i);
    const blocks = buildTimeline({ date, snapshot })
      .map((b) => ({
        id: b.id,
        kind: b.kind,
        ...(b.kind==='lesson'?{teacher:b.teacher,lessonPeriods:b.lessonPeriods,lessonCount:b.lessonCount,lessonCountEstimated:b.lessonCountEstimated}:{}),
        title: b.title,
        location: b.location,
        color: b.color,
        startMinute: localToMinutes(b.startAt),
        endMinute: localToMinutes(b.endAt),
        timeLabel: eventTimeLabel(b),
        reason: b.reason,
        locked: b.locked,
        taskId: b.taskId,eventId:b.eventId,detail:b.detail,eventType:b.eventType
      }))
      .sort((a, b) => a.startMinute - b.startMinute);

    out.push({
      date,
      weekday: weekdayCn(date),
      dayLabel: `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`,
      isToday: date === currentDate,
      blocks
    });

    dueCount += snapshot.tasks.filter(
      (t) => t.dueAt && dateOf(t.dueAt) === date && t.status !== 'done' && t.status !== 'canceled'
    ).length;
  }

  const firstBusyIndex = out.findIndex((d) => d.blocks.length > 0);
  return {
    days: out,
    weekStart: fromDate,
    dueCount,
    firstBusyIndex: firstBusyIndex === -1 ? 0 : firstBusyIndex
  };
}

function toDueTask(task: Task, now: string): DueTask {
  const untilDueMinutes = task.dueAt ? minutesBetween(now, task.dueAt) : null;
  const overdue = untilDueMinutes !== null && untilDueMinutes <= 0;
  return {
    task,
    overdue,
    untilDueMinutes,
    dueLabel: task.dueAt
      ? `${relativeDay(dateOf(task.dueAt), dateOf(now))} ${task.dueAt.slice(11, 16)}`
      : '无截止时间'
  };
}

/**
 * 悬浮窗"当下"一段的口径：先看正在上的课，再看最近一小时内的安排，
 * 都没有则退回最近的临期任务。返回 undefined 表示真的没事可做。
 */
export function primaryMoment(agenda: Agenda): AgendaItem | undefined {
  if (agenda.current) return agenda.current;
  const soon = agenda.next.find((n) => n.untilStartMinutes <= 60 && n.kind !== 'busy');
  if (soon) return soon;
  return undefined;
}

/** 首页顶部信息条所需的课程数（含明天预告用的数量） */
export function lessonCountOf(snapshot: AgendaSnapshot, date: string): number {
  return buildTimeline({ date, snapshot }).filter((b) => b.kind === 'lesson').length;
}

/** 悬浮窗今日统计的"已完成/总数" */
export function dayProgress(snapshot: AgendaSnapshot, date: string): { done: number; total: number } {
  const relevant = snapshot.tasks.filter(
    (t) => isActive(t) || (t.status === 'done' && t.doneAt && dateOf(t.doneAt) === date)
  );
  const scoped = relevant.filter((t) => (t.dueAt ? dateOf(t.dueAt) === date : false));
  return {
    done: scoped.filter((t) => t.status === 'done').length,
    total: scoped.length
  };
}

/** "下一节课"用于中午/上课前的提示文案 */
export function nextLessonHint(snapshot: AgendaSnapshot, now: string): string | undefined {
  if (!snapshot.semester) return undefined;
  const { next } = upcomingLessons({
    now,
    semester: snapshot.semester,
    courses: snapshot.courses,
    sessions: snapshot.sessions,
    overrides: snapshot.overrides,
    timeSlots: snapshot.timeSlots,
    limit: 1
  });
  const lesson = next[0];
  if (!lesson) return undefined;
  if (lesson.untilStartMinutes > 720) return undefined;
  const when = dateOf(lesson.startAt) === dateOf(now) ? '' : `${relativeDay(dateOf(lesson.startAt), dateOf(now))} `;
  return `${when}${lesson.startAt.slice(11, 16)} ${lesson.course.name}${lesson.room ? ` · ${lesson.room}` : ''}`;
}

export function urgencyColor(u: Urgency): string {
  return urgencyMeta(u).color;
}

export type { UpcomingLesson };
