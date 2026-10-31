import type {
  BusyBlock,
  Course,
  CourseSession,
  CourseSessionOverride,
  Exam,
  ScheduleBlock,
  Semester,
  Task,
  TimeSlot
} from '../types';

export const SEMESTER: Semester = {
  id: 'sem1',
  name: '2025-2026 秋季学期',
  startDate: '2025-09-01', // 周一，第 1 教学周
  totalWeeks: 20,
  isActive: true
};

/**
 * 一份通用的 12 节作息，仅用于测试。
 *
 * 真实作息是两校区两套（绍兴 11 节、下沙 15 节），那份数据在
 * `src/main/db/seed-data.ts` 里，并由 realTimetable 测试覆盖。
 * 这里保留"标准 12 节"是为了让纯函数测试与学校无关，便于验证算法本身。
 * campus 必须填：TimeSlot 类型要求它，缺了会让类型检查失败。
 */
const CAMPUS = '测试校区';

export const TIME_SLOTS: TimeSlot[] = [
  { id: 's1', semesterId: 'sem1', slotIndex: 1, period: 'am', startTime: '08:00', endTime: '08:45', campus: CAMPUS },
  { id: 's2', semesterId: 'sem1', slotIndex: 2, period: 'am', startTime: '08:55', endTime: '09:40', campus: CAMPUS },
  { id: 's3', semesterId: 'sem1', slotIndex: 3, period: 'am', startTime: '10:00', endTime: '10:45', campus: CAMPUS },
  { id: 's4', semesterId: 'sem1', slotIndex: 4, period: 'am', startTime: '10:55', endTime: '11:40', campus: CAMPUS },
  { id: 's5', semesterId: 'sem1', slotIndex: 5, period: 'pm', startTime: '14:00', endTime: '14:45', campus: CAMPUS },
  { id: 's6', semesterId: 'sem1', slotIndex: 6, period: 'pm', startTime: '14:55', endTime: '15:40', campus: CAMPUS },
  { id: 's7', semesterId: 'sem1', slotIndex: 7, period: 'pm', startTime: '16:00', endTime: '16:45', campus: CAMPUS },
  { id: 's8', semesterId: 'sem1', slotIndex: 8, period: 'pm', startTime: '16:55', endTime: '17:40', campus: CAMPUS },
  { id: 's9', semesterId: 'sem1', slotIndex: 9, period: 'eve', startTime: '19:00', endTime: '19:45', campus: CAMPUS },
  { id: 's10', semesterId: 'sem1', slotIndex: 10, period: 'eve', startTime: '19:55', endTime: '20:40', campus: CAMPUS },
  { id: 's11', semesterId: 'sem1', slotIndex: 11, period: 'eve', startTime: '20:50', endTime: '21:35', campus: CAMPUS },
  { id: 's12', semesterId: 'sem1', slotIndex: 12, period: 'eve', startTime: '21:45', endTime: '22:30', campus: CAMPUS }
];

export function course(id: string, name: string, color = '#4F7CFF'): Course {
  return { id, semesterId: 'sem1', name, color };
}

export function session(
  id: string,
  courseId: string,
  weekday: number,
  startSlot: number,
  endSlot: number,
  extra: Partial<CourseSession> = {}
): CourseSession {
  return { id, courseId, weekday, startSlot, endSlot, weekMode: 'all', ...extra };
}

export function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    domain: 'study',
    type: 'assignment',
    title,
    source: 'manual',
    urgency: 3,
    status: 'open',
    progress: 0,
    allDay: false,
    splittable: true,
    remindPolicy: 'default',
    autoScheduled: true,
    createdAt: '2025-10-01T09:00',
    updatedAt: '2025-10-01T09:00',
    ...extra
  };
}

export function block(
  id: string,
  taskId: string,
  date: string,
  startAt: string,
  endAt: string,
  extra: Partial<ScheduleBlock> = {}
): ScheduleBlock {
  return {
    id,
    taskId,
    date,
    startAt,
    endAt,
    plannedMinutes: 60,
    locked: false,
    origin: 'auto',
    ...extra
  };
}

export function exam(id: string, subject: string, examAt: string, extra: Partial<Exam> = {}): Exam {
  return {
    id,
    semesterId: 'sem1',
    subject,
    examAt,
    difficulty: 3,
    confidence: 3,
    reviewProgress: 0,
    ...extra
  };
}

export function busy(id: string, title: string, weekday: number, start: string, end: string): BusyBlock {
  return { id, title, weekday, startAt: `2025-09-01T${start}`, endAt: `2025-09-01T${end}`, domain: 'life' };
}

export function override(
  id: string,
  sessionId: string,
  date: string,
  extra: Partial<CourseSessionOverride> = {}
): CourseSessionOverride {
  return { id, sessionId, date, kind: 'cancel', ...extra };
}
