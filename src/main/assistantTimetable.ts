import type {DatabaseSync} from 'node:sqlite';
import type {Course, CourseSession, CourseSessionOverride, Semester, TimeSlot} from '@shared/types';
import {expandDayLessons} from '@shared/timetable';
import {addDays, mondayOf, today, weekOf} from '@shared/time';
import {validHomeDate} from '@shared/home';

/** Read-only integration boundary. Reuse the application's exact calendar rules. */
export function readAssistantCourses(db: Pick<DatabaseSync, 'prepare'>, options: {date?: string; week?: boolean; weekday?: number} = {}) {
  const date = options.date ?? today();
  if (!validHomeDate(date)) throw Error('请选择有效的课表日期');
  if (options.weekday !== undefined && (!Number.isInteger(options.weekday) || options.weekday < 1 || options.weekday > 7)) throw Error('星期需要是 1–7');
  const row = db.prepare('SELECT * FROM semester WHERE deleted_at IS NULL ORDER BY is_active DESC,start_date DESC,id LIMIT 1').get() as any;
  if (!row) return {date, semester: null, teachingWeek: null, courses: []};
  const semester: Semester = {id: row.id, name: row.name, startDate: row.start_date, totalWeeks: row.total_weeks, isActive: !!row.is_active};
  const campus = (db.prepare("SELECT value FROM setting WHERE key='campus'").get() as any)?.value ?? '绍兴';
  const courses: Course[] = db.prepare('SELECT id,semester_id AS semesterId,name,teacher,color FROM course WHERE semester_id=? AND deleted_at IS NULL').all(semester.id) as any;
  const sessions: CourseSession[] = db.prepare(`SELECT s.id,s.course_id AS courseId,s.weekday,s.start_slot AS startSlot,s.end_slot AS endSlot,
    s.start_time AS startTime,s.end_time AS endTime,s.room,s.week_mode AS weekMode,s.week_list AS weekList
    FROM course_session s JOIN course c ON c.id=s.course_id WHERE c.semester_id=? AND c.deleted_at IS NULL AND s.deleted_at IS NULL`).all(semester.id) as any;
  // Null direct times must become undefined for slot-based sessions, just as in repositories.ts.
  for (const session of sessions) {session.startTime ||= undefined; session.endTime ||= undefined;}
  const timeSlots: TimeSlot[] = db.prepare(`SELECT id,semester_id AS semesterId,slot_index AS slotIndex,period,start_time AS startTime,end_time AS endTime,campus
    FROM time_slot WHERE semester_id=? AND campus=? AND is_prepare_bell=0 ORDER BY slot_index`).all(semester.id, campus) as any;
  const overrides: CourseSessionOverride[] = db.prepare(`SELECT o.id,o.session_id AS sessionId,o.date,o.kind,o.new_date AS newDate,
    o.new_start_slot AS newStartSlot,o.new_end_slot AS newEndSlot,o.new_room AS newRoom,o.reason
    FROM course_session_override o JOIN course_session s ON s.id=o.session_id JOIN course c ON c.id=s.course_id
    WHERE o.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL AND c.semester_id=?`).all(semester.id) as any;
  for (const override of overrides) {override.newStartSlot ??= undefined; override.newEndSlot ??= undefined; override.newRoom ??= undefined;}
  const start = options.week ? mondayOf(date) : date;
  const days = Array.from({length: options.week ? 7 : 1}, (_, index) => addDays(start, index));
  const result = days.flatMap(day => expandDayLessons({date: day, semester, courses, sessions, timeSlots, overrides})).map(lesson => ({
    date: lesson.date, weekday: new Date(lesson.date + 'T12:00').getDay() || 7,
    time: `${lesson.startAt.slice(11, 16)}-${lesson.endAt.slice(11, 16)}`, startAt: lesson.startAt, endAt: lesson.endAt,
    name: lesson.course.name, teacher: lesson.course.teacher ?? '', room: lesson.room ?? '', rescheduled: !!lesson.rescheduled
  })).filter(lesson => options.weekday === undefined || lesson.weekday === options.weekday);
  // Defensive identity deduplication does not merge distinct dates, rooms or times.
  const unique = [...new Map(result.map(lesson => [JSON.stringify([lesson.date, lesson.name, lesson.teacher, lesson.room, lesson.startAt, lesson.endAt]), lesson])).values()];
  return {date, semester: {id: semester.id, name: semester.name}, teachingWeek: weekOf(date, semester.startDate), courses: unique};
}
