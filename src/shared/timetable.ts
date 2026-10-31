/**
 * 课表展开：教学周换算、单双周、调课/停课（设计文档 3.4）。
 * 纯函数，被日程、悬浮窗、排程引擎共同使用。
 */

import type {
  LessonMetadata,
  Course,
  CourseSession,
  CourseSessionOverride,
  Semester,
  TimeSlot
} from './types';
import { dateOf, hhmmToMinutes, parseWeekList, weekOf } from './time';

/** 规则命中判断：该 session 是否在自然落在 date 这一天（不考虑调课搬移） */
export function matchesByRule(session: CourseSession, date: string, semester: Semester): boolean {
  const teachingWeek = weekOf(date, semester.startDate);
  if (teachingWeek < 1 || teachingWeek > semester.totalWeeks) return false;
  if (session.weekMode === 'odd' || session.weekMode === 'even') {
    const week = weekOf(date, semester.startDate);
    if (week < 1 || week > semester.totalWeeks) return false;
    if (session.weekMode === 'odd' && week % 2 === 0) return false;
    if (session.weekMode === 'even' && week % 2 === 1) return false;
    return true;
  }
  if (session.weekMode === 'custom') {
    const week = weekOf(date, semester.startDate);
    return week >= 1 && week <= semester.totalWeeks && parseWeekList(session.weekList).includes(week);
  }
  // 默认按自然周重复
  return true;
}

function weekdayMatches(session: CourseSession, date: string): boolean {
  const wd = dateOf(date);
  const jsDay = new Date(`${wd}T00:00`).getDay();
  return (jsDay === 0 ? 7 : jsDay) === session.weekday;
}

export interface DayLesson extends LessonMetadata {
  session: CourseSession;
  course: Course;
  date: string;
  startAt: string;
  endAt: string;
  room?: string;
  /** 由 reschedule 覆盖而来 */
  rescheduled?: boolean;
}

function buildLesson(
  session: CourseSession,
  course: Course,
  date: string,
  slotMap: Map<number, TimeSlot>,
  room?: string,
  rescheduled?: boolean
): DayLesson | null {
  const start = slotMap.get(session.startSlot);
  const end = slotMap.get(session.endSlot);
  const startTime=session.startTime??start?.startTime,endTime=session.endTime??end?.endTime;
  if (!startTime || !endTime) return null;
  const available=[...slotMap.values()].filter(s=>!s.isPrepareBell);
  const bySlots=!session.startTime&&!session.endTime;
  const matched=available.filter(s=>bySlots ? s.slotIndex>=session.startSlot&&s.slotIndex<=session.endSlot : s.startTime>=startTime&&s.endTime<=endTime).sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const exact=bySlots||matched.length>0&&matched[0].startTime===startTime&&matched[matched.length-1].endTime===endTime;
  const lessonPeriods=exact?matched.map(s=>({slotIndex:s.slotIndex,startTime:s.startTime,endTime:s.endTime})):undefined;
  return {
    teacher: course.teacher,
    lessonPeriods,
    lessonCount: bySlots?session.endSlot-session.startSlot+1:exact?matched.length:Math.max(1,Math.round((hhmmToMinutes(endTime)-hhmmToMinutes(startTime))/45)),
    lessonCountEstimated: !exact,
    session,
    course,
    date,
    startAt: `${date}T${startTime}`,
    endAt: `${date}T${endTime}`,
    room: room ?? session.room,
    rescheduled
  };
}

/**
 * 展开某一天实际要上的课（含调课搬入、排除停课与已搬走的课）。
 */
export function expandDayLessons(input: {
  date: string;
  semester: Semester;
  courses: Course[];
  sessions: CourseSession[];
  overrides: CourseSessionOverride[];
  timeSlots: TimeSlot[];
}): DayLesson[] {
  const { date, semester, courses, sessions, overrides, timeSlots } = input;
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const slotMap = new Map(timeSlots.map((s) => [s.slotIndex, s]));
  const out: DayLesson[] = [];

  for (const session of sessions) {
    const course = courseMap.get(session.courseId);
    if (!course) continue;

    const dayOverrides = overrides.filter((o) => o.sessionId === session.id);

    // 1) 规则命中本日
    if (weekdayMatches(session, date) && matchesByRule(session, date, semester)) {
      const cancel = dayOverrides.find((o) => o.date === date && o.kind === 'cancel');
      const movedAway = dayOverrides.find((o) => o.date === date && o.kind === 'reschedule');
      const roomChange = dayOverrides.find((o) => o.date === date && o.kind === 'room_change');

      if (!cancel && !movedAway) {
        const lesson = buildLesson(session, course, date, slotMap, roomChange?.newRoom);
        if (lesson) out.push(lesson);
      }
    }

    // 2) 别的日子调课搬入本日
    for (const o of dayOverrides) {
      if (o.kind !== 'reschedule' || o.newDate !== date) continue;
      const moved: CourseSession = {
        ...session,
        startSlot: o.newStartSlot ?? session.startSlot,
        endSlot: o.newEndSlot ?? session.endSlot,
        ...(o.newStartSlot!==undefined?{startTime:undefined}:{}),
        ...(o.newEndSlot!==undefined?{endTime:undefined}:{})
      };
      const lesson = buildLesson(moved, course, date, slotMap, o.newRoom ?? session.room, true);
      if (lesson) out.push(lesson);
    }
  }

  return out.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
}

export interface UpcomingLesson extends DayLesson {
  /** 相对参考时刻的分钟数：负数=正在进行或已结束 */
  untilStartMinutes: number;
}

/**
 * 当前正在上的课，以及接下来 n 节还没上的课（设计文档 4.3 的"当下日程"）。
 * 返回的正在进行项即便已接近下课也仍然返回，由调用方决定展示方式。
 */
export function upcomingLessons(input: {
  now: string;
  days?: number;
  limit?: number;
  semester: Semester;
  courses: Course[];
  sessions: CourseSession[];
  overrides: CourseSessionOverride[];
  timeSlots: TimeSlot[];
}): { current?: UpcomingLesson; next: UpcomingLesson[] } {
  const { now, days = 7, limit = 3 } = input;
  const todayStr = dateOf(now);
  const nowMs = new Date(now).getTime();

  const all: UpcomingLesson[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = i === 0 ? todayStr : addDaysLocal(todayStr, i);
    const lessons = expandDayLessons({
      date,
      semester: input.semester,
      courses: input.courses,
      sessions: input.sessions,
      overrides: input.overrides,
      timeSlots: input.timeSlots
    });
    for (const l of lessons) {
      all.push({ ...l, untilStartMinutes: Math.round((new Date(l.startAt).getTime() - nowMs) / 60000) });
    }
  }

  all.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));

  const current = all.find(
    (l) => new Date(l.startAt).getTime() <= nowMs && new Date(l.endAt).getTime() > nowMs
  );
  const next = all
    .filter((l) => new Date(l.startAt).getTime() > nowMs)
    .slice(0, limit);

  return { current, next };
}

function addDaysLocal(date: string, days: number): string {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 节次时间表 → 一天的渲染行（用于课表网格） */
export function slotRows(timeSlots: TimeSlot[]): Array<TimeSlot & { startMinutes: number }> {
  return [...timeSlots]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((s) => ({ ...s, startMinutes: hhmmToMinutes(s.startTime) }));
}
