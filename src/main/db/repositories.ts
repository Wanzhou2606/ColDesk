/**
 * 数据仓储层：领域类型 ↔ SQLite 行。
 * 时间在库里存 `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` 字符串，与共享纯函数层的约定一致。
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
  TimeSlot,
  Urgency
} from '@shared/types';
import type { ExpenseCategory, ExpenseEntry } from '@shared/expense';
import type { Habit, HabitCheckin } from '@shared/habit';
import { validateTaskPatch, type TaskPatch } from '@shared/taskActions';
import { getDb } from './index';
import { addDays, nowLocal, today } from '@shared/time';
import {nextCourseColor,softCourseColor,courseColorAt} from '@shared/courseColors';

const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface NotificationRecord {
  id: string;
  taskId?: string;
  examId?: string;
  reminderId?: string;
  kind: string;
  dedupeKey: string;
  firedAt: string;
  action?: string;
  title?: string;
  body?: string;
  urgency?: number;
  strong?: boolean;
}

const bool = (v: unknown): boolean => v === 1 || v === true;
const toBoolInt = (v: boolean | undefined, fallback = false): number =>
  (v ?? fallback) ? 1 : 0;

/* ------------------------------------------------------------------ 学期 */

export function getActiveSemester(): Semester | undefined {
  const row = getDb()
    .prepare('SELECT * FROM semester WHERE deleted_at IS NULL AND is_active = 1 ORDER BY start_date DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;
  if (!row) {
    const any = getDb()
      .prepare('SELECT * FROM semester WHERE deleted_at IS NULL ORDER BY start_date DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return any ? mapSemester(any) : undefined;
  }
  return mapSemester(row);
}

function mapSemester(r: Record<string, unknown>): Semester {
  return {
    id: String(r.id),
    name: String(r.name),
    startDate: String(r.start_date),
    totalWeeks: Number(r.total_weeks),
    isActive: bool(r.is_active)
  };
}

/* ------------------------------------------------------------------ 课程 */

export function getCourses(semesterId?: string): Course[] {
  const rows = (semesterId
    ? getDb().prepare('SELECT * FROM course WHERE deleted_at IS NULL AND semester_id = ? ORDER BY name').all(semesterId)
    : getDb().prepare('SELECT * FROM course WHERE deleted_at IS NULL ORDER BY name').all()) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    semesterId: String(r.semester_id),
    name: String(r.name),
    teacher: (r.teacher as string) ?? undefined,
    color: String(r.color ?? '#4F7CFF'),
    credit: r.credit === null || r.credit === undefined ? undefined : Number(r.credit),
    note: (r.note as string) ?? undefined
  }));
}

export function upsertCourse(input: {
  id?: string;
  semesterId: string;
  name: string;
  teacher?: string;
  color?: string;
  credit?: number;
}): Course {
  const ts = nowLocal();
  const id = input.id ?? uid('course');
  const existing=getDb().prepare('SELECT color,color_custom FROM course WHERE id=?').get(id) as {color:string;color_custom:number}|undefined;
  // Replacement imports temporarily soft-delete old rows. Reserve their colors too,
  // so a newly introduced course cannot take a returning course's saved color.
  const used=(getDb().prepare('SELECT color FROM course WHERE semester_id=? AND id<>?').all(input.semesterId,id) as Array<{color:string}>).map(course=>course.color);
  const color=input.color!==undefined?softCourseColor(input.color):existing?.color??nextCourseColor(used),custom=input.color!==undefined?1:existing?.color_custom??0;
  getDb()
    .prepare(
      `INSERT INTO course (id, semester_id, name, teacher, color, credit, created_at, updated_at)
       VALUES (@id, @semesterId, @name, @teacher, @color, @credit, @ts, @ts)
       ON CONFLICT(id) DO UPDATE SET name=@name, teacher=@teacher, color=@color, credit=@credit, updated_at=@ts`
    )
    .run({
      id,
      semesterId: input.semesterId,
      name: input.name,
      teacher: input.teacher ?? null,
      color,
      credit: input.credit ?? null,
      ts
    });
  getDb().prepare('UPDATE course SET color_custom=? WHERE id=?').run(custom,id);
  return getCourses().find((c) => c.id === id)!;
}

export function setCourseColor(value:unknown,color:unknown){
 if(typeof value!=='string'||!value||value.length>200)throw Error('请选择有效的课程');
 const course=getCourses().find(course=>course.id===value);if(!course)throw Error('这门课程已不存在，请重新打开设置');
 const chosen=color===null?nextCourseColor(getCourses(course.semesterId).filter(item=>item.id!==value).map(item=>item.color)):softCourseColor(color);
 getDb().prepare('UPDATE course SET color=?,color_custom=?,updated_at=? WHERE id=?').run(chosen,color===null?0:1,nowLocal(),value);return chosen;
}
export function resetCourseColors(){return getDb().transaction(()=>{const counts=new Map<string,number>();for(const course of getCourses(getActiveSemester()?.id)){const index=counts.get(course.semesterId)??0;getDb().prepare('UPDATE course SET color=?,color_custom=0,updated_at=? WHERE id=?').run(courseColorAt(index),nowLocal(),course.id);counts.set(course.semesterId,index+1);}return true;})();}

/* -------------------------------------------------------------- 课表时段 */

export function getSessions(): CourseSession[] {
  const rows = getDb()
    .prepare('SELECT * FROM course_session WHERE deleted_at IS NULL')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    courseId: String(r.course_id),
    weekday: Number(r.weekday),
    startSlot: Number(r.start_slot),
    endSlot: Number(r.end_slot),
    ...(r.start_time&&r.end_time?{startTime:String(r.start_time),endTime:String(r.end_time)}:{}),
    room: (r.room as string) ?? undefined,
    weekMode: String(r.week_mode ?? 'all') as CourseSession['weekMode'],
    weekList: (r.week_list as string) ?? undefined
  }));
}

export function upsertSession(input: Omit<CourseSession, 'id'> & { id?: string }): CourseSession {
  const ts = nowLocal();
  const id = input.id ?? uid('sess');
  getDb()
    .prepare(
      `INSERT INTO course_session (id, course_id, weekday, start_slot, end_slot, start_time, end_time, room, week_mode, week_list, created_at, updated_at)
       VALUES (@id, @courseId, @weekday, @startSlot, @endSlot, @startTime, @endTime, @room, @weekMode, @weekList, @ts, @ts)
       ON CONFLICT(id) DO UPDATE SET course_id=@courseId, weekday=@weekday, start_slot=@startSlot,
         end_slot=@endSlot, start_time=@startTime, end_time=@endTime, room=@room, week_mode=@weekMode, week_list=@weekList, updated_at=@ts`
    )
    .run({
      id,
      courseId: input.courseId,
      weekday: input.weekday,
      startSlot: input.startSlot,
      endSlot: input.endSlot,
      startTime: input.startTime??null,
      endTime: input.endTime??null,
      room: input.room ?? null,
      weekMode: input.weekMode ?? 'all',
      weekList: input.weekList ?? null,
      ts
    });
  return getSessions().find((s) => s.id === id)!;
}

export function getOverrides(): CourseSessionOverride[] {
  const rows = getDb()
    .prepare('SELECT * FROM course_session_override WHERE deleted_at IS NULL')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    sessionId: String(r.session_id),
    date: String(r.date),
    kind: String(r.kind) as CourseSessionOverride['kind'],
    newDate: (r.new_date as string) ?? undefined,
    newStartSlot: r.new_start_slot === null ? undefined : Number(r.new_start_slot),
    newEndSlot: r.new_end_slot === null ? undefined : Number(r.new_end_slot),
    newRoom: (r.new_room as string) ?? undefined,
    reason: (r.reason as string) ?? undefined
  }));
}

export function getTimeSlots(semesterId: string, campus?: string): TimeSlot[] {
  const rows = (campus
    ? getDb()
        .prepare('SELECT * FROM time_slot WHERE semester_id = ? AND campus = ? ORDER BY slot_index')
        .all(semesterId, campus)
    : getDb()
        .prepare('SELECT * FROM time_slot WHERE semester_id = ? ORDER BY campus, slot_index')
        .all(semesterId)) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    semesterId: String(r.semester_id),
    slotIndex: Number(r.slot_index),
    period: String(r.period) as TimeSlot['period'],
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    campus: String(r.campus ?? '本部'),
    isPrepareBell: bool(r.is_prepare_bell)
  }));
}

/** 当前启用的校区（设置项，决定用哪套节次时间） */
export function getActiveCampus(): string {
  return getSetting('campus') ?? '绍兴';
}

export function setActiveCampus(campus: string): void {
  setSetting('campus', campus);
}

/** 所有出现过的校区，供设置页做切换 */
export function getCampuses(): string[] {
  const semester=getActiveSemester();
  const rows = getDb()
    .prepare('SELECT DISTINCT campus FROM time_slot WHERE semester_id=? ORDER BY campus')
    .all(semester?.id??'') as Array<{ campus: string }>;
  const list = rows.map((r) => r.campus).filter(Boolean);
  return list.length > 0 ? list : ['绍兴'];
}

export interface TimeSlotInput {
  slotIndex: number;
  period: TimeSlot['period'];
  startTime: string;
  endTime: string;
  isPrepareBell?: boolean;
}

/**
 * 整表替换某个校区的作息时间（用户自定义课程时间用）。
 * 在事务中替换选定校区的整套时间，而不是逐条更新，
 * 这样增删节次都不需要额外处理，逻辑最简单也最不容易出错。
 */
export function saveTimeSlots(
  semesterId: string,
  campus: string,
  slots: TimeSlotInput[]
): TimeSlot[] {
  const d = getDb();
  const tx = d.transaction((list: TimeSlotInput[]) => {
    d.prepare(
      'DELETE FROM time_slot WHERE semester_id = @semesterId AND campus = @campus'
    ).run({ semesterId, campus });

    const insert = d.prepare(
      `INSERT INTO time_slot (id, semester_id, slot_index, period, start_time, end_time, campus, is_prepare_bell)
       VALUES (@id, @semesterId, @slotIndex, @period, @startTime, @endTime, @campus, @isPrepareBell)`
    );
    for (const slot of list) {
      insert.run({
        id: uid('slot'),
        semesterId,
        slotIndex: slot.slotIndex,
        period: slot.period,
        startTime: slot.startTime,
        endTime: slot.endTime,
        campus,
        isPrepareBell: slot.isPrepareBell ? 1 : 0
      });
    }
  });
  tx(slots);

  return getTimeSlots(semesterId, campus);
}

/* ------------------------------------------------------------------ 任务 */

const TASK_COLUMNS = `
  id, domain, type, title, detail, source, source_raw AS sourceRaw, course_id AS courseId,
  exam_id AS examId, parent_id AS parentId, urgency, status, progress, start_at AS startAt,
  due_at AS dueAt, all_day AS allDay, location, est_minutes AS estMinutes,
  splittable, earliest_start AS earliestStart, fixed_at AS fixedAt,
  remind_policy AS remindPolicy, remind_offsets AS remindOffsets,
  auto_scheduled AS autoScheduled, is_pinned AS pinned, done_at AS doneAt, created_at AS createdAt, updated_at AS updatedAt
`;

export function getTasks(domain?: Domain): Task[] {
  const sql = `SELECT ${TASK_COLUMNS} FROM task WHERE deleted_at IS NULL ${
    domain ? 'AND domain = @domain' : ''
  } ORDER BY due_at IS NULL, due_at`;
  const rows = (domain ? getDb().prepare(sql).all({ domain }) : getDb().prepare(sql).all()) as Record<
    string,
    unknown
  >[];
  return rows.map(mapTask);
}

export function getTask(id: string): Task | undefined {
  const row = getDb()
    .prepare(`SELECT ${TASK_COLUMNS} FROM task WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapTask(row) : undefined;
}

function mapTask(r: Record<string, unknown>): Task {
  return {
    id: String(r.id),
    domain: String(r.domain) as Domain,
    pinned: bool(r.pinned),
    type: String(r.type) as Task['type'],
    title: String(r.title),
    detail: (r.detail as string) ?? undefined,
    source: String(r.source ?? 'manual') as Task['source'],
    sourceRaw: (r.sourceRaw as string) ?? undefined,
    courseId: (r.courseId as string) ?? undefined,
    examId: (r.examId as string) ?? undefined,
    parentId: (r.parentId as string) ?? undefined,
    urgency: Number(r.urgency) as Urgency,
    status: String(r.status) as Task['status'],
    progress: Number(r.progress ?? 0),
    startAt: (r.startAt as string) ?? undefined,
    dueAt: (r.dueAt as string) ?? undefined,
    allDay: bool(r.allDay),
    location: (r.location as string) ?? undefined,
    estMinutes: r.estMinutes === null || r.estMinutes === undefined ? undefined : Number(r.estMinutes),
    splittable: bool(r.splittable),
    earliestStart: (r.earliestStart as string) ?? undefined,
    fixedAt: (r.fixedAt as string) ?? undefined,
    remindPolicy: String(r.remindPolicy ?? 'default') as Task['remindPolicy'],
    remindOffsets: r.remindOffsets ? String(r.remindOffsets).split(',').map(Number) : undefined,
    autoScheduled: bool(r.autoScheduled),
    doneAt: (r.doneAt as string) ?? undefined,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt)
  };
}

export interface TaskInput {
  id?: string;
  domain?: Domain;
  type?: Task['type'];
  title: string;
  detail?: string;
  source?: Task['source'];
  courseId?: string;
  urgency: Urgency;
  status?: Task['status'];
  dueAt?: string;
  estMinutes?: number;
  splittable?: boolean;
  earliestStart?: string;
  remindPolicy?: Task['remindPolicy'];
  remindOffsets?: number[];
  autoScheduled?: boolean;
}

export function saveTask(input: TaskInput): Task {
  const ts = nowLocal();
  const existing = input.id ? getTask(input.id) : undefined;
  const id = input.id ?? uid('task');
  const row = {
    id,
    domain: input.domain ?? existing?.domain ?? 'study',
    type: input.type ?? existing?.type ?? 'todo',
    title: input.title,
    detail: input.detail ?? existing?.detail ?? null,
    source: input.source ?? existing?.source ?? 'manual',
    courseId: input.courseId ?? existing?.courseId ?? null,
    urgency: input.urgency,
    status: input.status ?? existing?.status ?? 'open',
    dueAt: input.dueAt ?? existing?.dueAt ?? null,
    estMinutes: input.estMinutes ?? existing?.estMinutes ?? null,
    splittable: toBoolInt(input.splittable, existing?.splittable ?? true),
    earliestStart: input.earliestStart ?? existing?.earliestStart ?? null,
    remindPolicy: input.remindPolicy ?? existing?.remindPolicy ?? 'default',
    remindOffsets: (input.remindOffsets ?? existing?.remindOffsets)?.join(',') ?? null,
    autoScheduled: toBoolInt(input.autoScheduled, existing?.autoScheduled ?? true),
    ts
  };

  getDb()
    .prepare(
      `INSERT INTO task (id, domain, type, title, detail, source, course_id, urgency, status,
                         due_at, est_minutes, splittable, earliest_start, remind_policy,
                         remind_offsets, auto_scheduled, created_at, updated_at)
       VALUES (@id, @domain, @type, @title, @detail, @source, @courseId, @urgency, @status,
               @dueAt, @estMinutes, @splittable, @earliestStart, @remindPolicy,
               @remindOffsets, @autoScheduled, @ts, @ts)
       ON CONFLICT(id) DO UPDATE SET domain=@domain, type=@type, title=@title, detail=@detail,
         source=@source, course_id=@courseId, urgency=@urgency, status=@status, due_at=@dueAt,
         est_minutes=@estMinutes, splittable=@splittable, earliest_start=@earliestStart,
         remind_policy=@remindPolicy, remind_offsets=@remindOffsets,
         auto_scheduled=@autoScheduled, updated_at=@ts`
    )
    .run(row);

  return getTask(id)!;
}

export function setTaskStatus(id: string, status: Task['status']): Task | undefined {
  const ts = nowLocal();
  getDb()
    .prepare('UPDATE task SET status = @status, done_at = @doneAt, updated_at = @ts WHERE id = @id')
    .run({ id, status, doneAt: status === 'done' ? ts : null, ts });
  return getTask(id);
}

export function deleteTask(id: string): void {
  const ts = nowLocal();
  const d = getDb();
  d.transaction(() => {
    d.prepare('UPDATE task SET deleted_at = @ts, updated_at = @ts WHERE id = @id').run({ id, ts });
    d.prepare('UPDATE schedule_block SET deleted_at = @ts, updated_at = @ts WHERE task_id = @id').run({ id, ts });
    d.prepare('DELETE FROM reminder WHERE task_id = ?').run(id);
  })();
}

export function patchTask(id: string, input: TaskPatch): Task {
  const patch = validateTaskPatch(input);
  const task = getTask(id);
  if (!task) throw new Error('任务已不存在，请刷新后重试');
  const next = { ...task, ...patch };
  getDb().prepare(`UPDATE task SET title=@title, urgency=@urgency, due_at=@dueAt,
    est_minutes=@estMinutes, splittable=@splittable, detail=@detail, all_day=@allDay, updated_at=@ts
    WHERE id=@id AND deleted_at IS NULL`).run({id,title:next.title,urgency:next.urgency,dueAt:next.dueAt ?? null,estMinutes:next.estMinutes ?? null,
    splittable:next.splittable ? 1 : 0,detail:next.detail ?? null,allDay:patch.dueAt !== undefined ? 0 : task.allDay ? 1 : 0,ts:nowLocal()});
  return getTask(id)!;
}
export function setTaskPinned(id: string, pinned: boolean): Task {
  if (!getTask(id)) throw new Error('任务已不存在，请刷新后重试');
  getDb().prepare('UPDATE task SET is_pinned=?,updated_at=? WHERE id=? AND deleted_at IS NULL').run(pinned ? 1 : 0,nowLocal(),id);
  return getTask(id)!;
}

/* -------------------------------------------------------------- 编排块 */

export function getBlocks(): ScheduleBlock[] {
  const rows = getDb()
    .prepare('SELECT * FROM schedule_block WHERE deleted_at IS NULL ORDER BY date, start_at')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    taskId: String(r.task_id),
    date: String(r.date),
    startAt: String(r.start_at),
    endAt: String(r.end_at),
    plannedMinutes: Number(r.planned_minutes),
    locked: bool(r.locked),
    origin: String(r.origin) as ScheduleBlock['origin'],
    reason: (r.reason as string) ?? undefined
  }));
}

export function getBlocksForTask(taskId: string): ScheduleBlock[] {
  return getBlocks().filter((b) => b.taskId === taskId);
}

export interface PlannerBlock {
  taskId: string;
  date: string;
  startAt: string;
  endAt: string;
  plannedMinutes: number;
  origin: 'auto';
  reason: string;
}

/**
 * 应用一次自动排程结果：
 *  - 已锁定/手动的块原样保留，并占用容量；
 *  - 其余自动块按新结果整体替换（先软删除，再插入）。
 */
export function applyAutoPlan(blocks: PlannerBlock[]): void {
  const d = getDb();
  const ts = nowLocal();
  const tx = d.transaction((list: PlannerBlock[]) => {
    d.prepare(
      "UPDATE schedule_block SET deleted_at = @ts, updated_at = @ts WHERE origin = 'auto' AND locked = 0 AND deleted_at IS NULL"
    ).run({ ts });

    const insert = d.prepare(
      `INSERT INTO schedule_block (id, task_id, date, start_at, end_at, planned_minutes, locked, origin, reason, created_at, updated_at)
       VALUES (@id, @taskId, @date, @startAt, @endAt, @plannedMinutes, 0, 'auto', @reason, @ts, @ts)`
    );
    for (const b of list) {
      insert.run({ id: uid('blk'), ...b, ts });
    }
  });
  tx(blocks);
}

export function lockBlock(id: string, startAt: string, endAt: string): void {
  const ts = nowLocal();
  getDb()
    .prepare(
      `UPDATE schedule_block SET start_at=@startAt, end_at=@endAt, date=@date,
         planned_minutes=@minutes, locked=1, origin='manual', reason='由你手动调整，重排时不再移动', updated_at=@ts
       WHERE id=@id`
    )
    .run({
      id,
      startAt,
      endAt,
      date: startAt.slice(0, 10),
      minutes: minutesBetweenStr(startAt, endAt),
      ts
    });
}

export function saveManualBlock(input: { taskId: string; date: string; startAt: string; endAt: string; plannedMinutes: number; blockId?: string }): ScheduleBlock {
  const d = getDb(), ts = nowLocal();
  const id = input.blockId ?? uid('blk');
  d.transaction(()=>{
    if (input.blockId) lockBlock(id, input.startAt, input.endAt);
    else d.prepare(`INSERT INTO schedule_block (id,task_id,date,start_at,end_at,planned_minutes,locked,origin,reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,'manual','由你拖拽安排，自动重排不会移动',?,?)`).run(id,input.taskId,input.date,input.startAt,input.endAt,input.plannedMinutes,ts,ts);
  })();
  return getBlocks().find(block => block.id === id)!;
}
export function removeManualBlock(id: string): void {
  const ts = nowLocal();
  getDb().prepare("UPDATE schedule_block SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND (locked=1 OR origin='manual')").run(ts,ts,id);
}
export function replaceTaskSegments(taskId:string,segments:import('@shared/taskSegments').TaskSegment[]):void{
 const d=getDb(),ts=nowLocal();
 d.transaction(()=>{
  const retained=new Set(segments.flatMap(row=>row.id?[row.id]:[]));
  for(const old of getBlocksForTask(taskId))if(!retained.has(old.id))d.prepare('UPDATE schedule_block SET deleted_at=?,updated_at=? WHERE id=?').run(ts,ts,old.id);
  for(const row of segments)saveManualBlock({taskId,blockId:row.id,date:row.date,startAt:row.startAt,endAt:row.endAt,plannedMinutes:row.plannedMinutes});
 })();
}
export function normalizeManualPlacements():boolean{
  const d=getDb();const rows=d.prepare("SELECT id,task_id,start_at,end_at FROM schedule_block WHERE deleted_at IS NULL AND (locked=1 OR origin='manual') ORDER BY updated_at DESC,created_at DESC,rowid DESC").all() as Array<{id:string;task_id:string;start_at:string;end_at:string}>;
  const seen=new Set<string>(),duplicates:string[]=[];
  for(const row of rows){const key=JSON.stringify([row.task_id,row.start_at,row.end_at]);if(seen.has(key))duplicates.push(row.id);else seen.add(key);}
  if(!duplicates.length)return false;const ts=nowLocal();d.transaction(()=>{for(const id of duplicates)d.prepare('UPDATE schedule_block SET deleted_at=?,updated_at=? WHERE id=?').run(ts,ts,id);})();return true;
}

function minutesBetweenStr(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

/* ------------------------------------------------------------------ 考试 */

export function getExams(): Exam[] {
  const rows = getDb()
    .prepare('SELECT * FROM exam WHERE deleted_at IS NULL ORDER BY exam_at')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    courseId: (r.course_id as string) ?? undefined,
    semesterId: String(r.semester_id),
    subject: String(r.subject),
    examAt: String(r.exam_at),
    durationMinutes: r.duration_minutes === null ? undefined : Number(r.duration_minutes),
    location: (r.location as string) ?? undefined,
    format: (r.format as string) ?? undefined,
    difficulty: Number(r.difficulty),
    confidence: Number(r.confidence),
    creditWeight: r.credit_weight === null ? undefined : Number(r.credit_weight),
    reviewProgress: Number(r.review_progress),
    note: (r.note as string) ?? undefined
  }));
}

/* ------------------------------------------------------------------ 占用 */

export function getBusyBlocks(): BusyBlock[] {
  const rows = getDb()
    .prepare('SELECT * FROM busy_block WHERE deleted_at IS NULL')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    weekday: r.weekday === null ? undefined : Number(r.weekday),
    date: (r.date as string) ?? undefined,
    startAt: String(r.start_at),
    endAt: String(r.end_at),
    domain: String(r.domain) as Domain
  }));
}

/* ------------------------------------------------------------------ 提醒 */

export interface ReminderRow {
  id: string;
  taskId?: string;
  examId?: string;
  fireAt: string;
  level: string;
  state: string;
  title?: string;
  body?: string;
  urgency?: number;
  strong: boolean;
}

export function getPendingReminders(): ReminderRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM reminder WHERE state = 'pending' ORDER BY fire_at")
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    taskId: (r.task_id as string) ?? undefined,
    examId: (r.exam_id as string) ?? undefined,
    fireAt: String(r.fire_at),
    level: String(r.level),
    state: String(r.state),
    title: (r.title as string) ?? undefined,
    body: (r.body as string) ?? undefined,
    urgency: r.urgency === null ? undefined : Number(r.urgency),
    strong: bool(r.strong)
  }));
}
export function createSnoozedReminder(item:{taskId?:string;examId?:string;title:string;body?:string;urgency?:number},fireAt:string):void{
  const ts=nowLocal();getDb().prepare(`INSERT INTO reminder (id,task_id,exam_id,fire_at,level,state,title,body,urgency,strong,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?,?,0,?,?)`).run(uid('rem'),item.taskId??null,item.examId??null,fireAt,'snooze',item.title,item.body??null,item.urgency??3,ts,ts);
}

/** Only obsolete generated cache is purged. Manual arrangements and user records stay intact. */
export function cleanDerivedData(): void {
  getDb().transaction(()=>{
    pruneInactiveTaskReminders();
    getDb().prepare("DELETE FROM schedule_block WHERE origin='auto' AND locked=0 AND deleted_at IS NOT NULL").run();
  })();
}

/** Derived reminders for finished/deleted tasks are not personal history; notify_log retains delivery history. */
export function pruneInactiveTaskReminders(): void {
  getDb().prepare(`DELETE FROM reminder WHERE task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task WHERE task.id=reminder.task_id AND task.deleted_at IS NULL AND task.status NOT IN ('done','canceled'))`).run();
}

export function replaceRemindersForTask(
  taskId: string,
  drafts: Array<{ fireAt: string; level: string; reason: string }>,
  meta: { title: string; urgency: number; strongFrom?: number }
): void {
  const d = getDb(), ts = nowLocal();
  d.transaction(() => {
    // Preserve snoozes and terminal states. Re-reading data must not resurrect a fired reminder.
    const existing = d.prepare(`SELECT id,fire_at,level,state,title,body,urgency,strong FROM reminder
      WHERE task_id=? AND level<>'snooze'
      ORDER BY CASE WHEN state='pending' THEN 1 ELSE 0 END,updated_at DESC,id DESC`).all(taskId) as Array<{
        id:string;fire_at:string;level:string;state:string;title:string;body:string;urgency:number;strong:number
      }>;
    const key = (fireAt:string,level:string) => JSON.stringify([fireAt,level]);
    const wanted = new Map(drafts.map(draft => [key(draft.fireAt,draft.level),draft]));
    const retained = new Map<string,typeof existing[number]>();
    const remove = d.prepare('DELETE FROM reminder WHERE id=?');
    for(const row of existing){
      const identity=key(row.fire_at,row.level);
      if(!wanted.has(identity)||retained.has(identity)){remove.run(row.id);continue;}
      retained.set(identity,row);
    }
    for(const [identity,draft] of wanted){
      const old=retained.get(identity),strong=meta.strongFrom!==undefined&&draft.fireAt>=ts&&meta.urgency>=5?1:0;
      if(old){
        if(old.state==='pending'&&(old.title!==meta.title||old.body!==draft.reason||old.urgency!==meta.urgency||old.strong!==strong)){
          d.prepare('UPDATE reminder SET title=?,body=?,urgency=?,strong=?,updated_at=? WHERE id=?').run(meta.title,draft.reason,meta.urgency,strong,ts,old.id);
        }
        continue;
      }
      d.prepare(`INSERT INTO reminder(id,task_id,fire_at,level,state,title,body,urgency,strong,created_at,updated_at)
        VALUES(?,?,?,?,'pending',?,?,?,?,?,?)`).run(uid('rem'),taskId,draft.fireAt,draft.level,meta.title,draft.reason,meta.urgency,strong,ts,ts);
    }
  })();
}

export function setReminderState(id: string, state: 'fired' | 'snoozed' | 'dismissed', snoozeUntil?: string): void {
  const ts = nowLocal();
  getDb()
    .prepare('UPDATE reminder SET state=@state, snooze_until=@snoozeUntil, updated_at=@ts WHERE id=@id')
    .run({ id, state, snoozeUntil: snoozeUntil ?? null, ts });
}

/** 稍后提醒：新建一条临时提醒，保留原提醒的已触发状态 */
export function snoozeReminder(sourceId: string, fireAt: string): void {
  const d = getDb();
  const ts = nowLocal();
  const src = d.prepare('SELECT * FROM reminder WHERE id = ?').get(sourceId) as
    | Record<string, unknown>
    | undefined;
  if (!src) return;
  d.prepare(
    `INSERT INTO reminder (id, task_id, exam_id, fire_at, level, state, title, body, urgency, strong, created_at, updated_at)
     VALUES (@id, @taskId, @examId, @fireAt, @level, 'pending', @title, @body, @urgency, 0, @ts, @ts)`
  ).run({
    id: uid('rem'),
    taskId: src.task_id ?? null,
    examId: src.exam_id ?? null,
    fireAt,
    level: 'snooze',
    title: src.title ?? null,
    body: '稍后提醒',
    urgency: src.urgency ?? null,
    ts
  });
  setReminderState(sourceId, 'snoozed', fireAt);
}

/* -------------------------------------------------------- 通知去重记录 */

export function hasNotified(dedupeKey: string): boolean {
  const row = getDb().prepare('SELECT 1 AS x FROM notify_log WHERE dedupe_key = ? LIMIT 1').get(dedupeKey);
  return Boolean(row);
}

export function recordNotification(record: NotificationRecord): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO notify_log (id, task_id, exam_id, reminder_id, kind, dedupe_key, fired_at, action)
       VALUES (@id, @taskId, @examId, @reminderId, @kind, @dedupeKey, @firedAt, @action)`
    )
    .run({
      id: record.id || uid('log'),
      taskId: record.taskId ?? null,
      examId: record.examId ?? null,
      reminderId: record.reminderId ?? null,
      kind: record.kind,
      dedupeKey: record.dedupeKey,
      firedAt: record.firedAt,
      action: record.action ?? null
    });
}

export function getRecentNotifications(limit = 30): NotificationRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT l.*, r.title AS title, r.body AS body, r.urgency AS urgency, r.strong AS strong
       FROM notify_log l LEFT JOIN reminder r ON r.id = l.reminder_id
       ORDER BY l.fired_at DESC LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    taskId: (r.task_id as string) ?? undefined,
    examId: (r.exam_id as string) ?? undefined,
    reminderId: (r.reminder_id as string) ?? undefined,
    kind: String(r.kind),
    dedupeKey: String(r.dedupe_key),
    firedAt: String(r.fired_at),
    action: (r.action as string) ?? undefined,
    title: (r.title as string) ?? undefined,
    body: (r.body as string) ?? undefined,
    urgency: r.urgency === null ? undefined : Number(r.urgency),
    strong: bool(r.strong)
  }));
}

/** 上课提醒的去重键：同一次课只提醒一次 */
export function classDedupeKey(courseId: string, startAt: string): string {
  return `class:${courseId}:${startAt}`;
}

export function taskReminderDedupeKey(taskId: string, level: string, dueAt?: string): string {
  return `task:${taskId}:${level}:${dueAt ?? ''}`;
}

export function dailyDigestDedupeKey(date = today()): string {
  return `digest:${date}`;
}

/* ------------------------------------------------------------------ 设置 */

export function getSetting(key: string): string | undefined {
  return getDb().getSetting(key);
}

export function setSetting(key: string, value: string): void {
  getDb().setSetting(key, value);
}

export function getSettingsJson<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

export function setSettingsJson(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}

/* ------------------------------------------------------------------ 记账 */

function rowToCategory(row: Record<string, unknown>): ExpenseCategory {
  return {
    id: String(row.id),
    name: String(row.name),
    icon: String(row.icon ?? ''),
    color: String(row.color ?? '#4F7CFF'),
    dailyTarget: Number(row.daily_target ?? 0),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function rowToEntry(row: Record<string, unknown>): ExpenseEntry {
  return {
    id: String(row.id),
    categoryId: String(row.category_id),
    date: String(row.occurred_on),
    amount: Number(row.amount ?? 0),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? '')
  };
}

export function getExpenseCategories(): ExpenseCategory[] {
  const rows = getDb()
    .prepare('SELECT * FROM expense_category ORDER BY sort_order, name')
    .all() as Record<string, unknown>[];
  return rows.map(rowToCategory);
}

export interface ExpenseCategoryInput {
  name: string;
  icon?: string;
  color?: string;
  dailyTarget?: number;
}

/** 新增分类，排在最后 */
export function createExpenseCategory(input: ExpenseCategoryInput): ExpenseCategory {
  const d = getDb();
  const ts = nowLocal();
  const maxRow = d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM expense_category').get() as { m: number };
  const id = uid('cat');
  d.prepare(
    `INSERT INTO expense_category (id, name, icon, color, daily_target, sort_order, created_at, updated_at)
     VALUES (@id, @name, @icon, @color, @daily_target, @sort_order, @ts, @ts)`
  ).run({
    id,
    name: input.name,
    icon: input.icon ?? '📦',
    color: input.color ?? '#4F7CFF',
    daily_target: input.dailyTarget ?? 0,
    sort_order: Number(maxRow.m) + 1,
    ts
  });
  return getExpenseCategories().find((c) => c.id === id)!;
}

export function updateExpenseCategory(id: string, patch: Partial<ExpenseCategoryInput>): void {
  const d = getDb();
  const current = d.prepare('SELECT * FROM expense_category WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!current) throw new Error(`分类不存在：${id}`);

  const merged = rowToCategory(current);
  d.prepare(
    `UPDATE expense_category
     SET name = @name, icon = @icon, color = @color, daily_target = @daily_target, updated_at = @ts
     WHERE id = @id`
  ).run({
    id,
    name: patch.name ?? merged.name,
    icon: patch.icon ?? merged.icon,
    color: patch.color ?? merged.color,
    daily_target: patch.dailyTarget ?? merged.dailyTarget,
    ts: nowLocal()
  });
}

/** 该分类下已有多少条流水：用于判断能否删除 */
export function countEntriesOfCategory(categoryId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM expense_entry WHERE category_id = ?')
    .get(categoryId) as { c: number };
  return Number(row.c);
}

/**
 * 删除分类。
 *
 * 有流水时**拒绝删除**（外键是 ON DELETE RESTRICT，这里先给出可读的错误信息）。
 * 这样历史账目不会因为删掉一个分类而失去归属——
 * 记账数据一旦对不上就失去意义了，宁可让用户先处理流水。
 */
export function deleteExpenseCategory(id: string): void {
  const used = countEntriesOfCategory(id);
  if (used > 0) {
    throw new Error(`这个分类下还有 ${used} 笔记录，先把它们删掉或改到别的分类再删分类`);
  }
  getDb().prepare('DELETE FROM expense_category WHERE id = ?').run(id);
}

/** 取某区间的流水（按日期倒序，同日按创建时间倒序） */
export function getExpenseEntries(fromDate: string, toDate: string): ExpenseEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM expense_entry
       WHERE occurred_on >= ? AND occurred_on <= ?
       ORDER BY occurred_on DESC, created_at DESC`
    )
    .all(fromDate, toDate) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

/** 最近 n 天的流水（含今天），用于柱状图与周月结算 */
export function getRecentExpenseEntries(days: number): ExpenseEntry[] {
  const d = getDb();
  const row = d.prepare('SELECT MAX(occurred_on) AS maxDate FROM expense_entry').get() as {
    maxDate: string | null;
  };
  // 以"最后一条流水"为基准而非今天：翻看历史时不会因为今天没记账而看到空图
  const anchor = row.maxDate && row.maxDate > today() ? row.maxDate : today();
  const start = addDays(anchor, -(Math.max(1, days) - 1));
  return getExpenseEntries(start, anchor);
}

export interface ExpenseEntryInput {
  categoryId: string;
  amount: number;
  date?: string;
  note?: string;
}

export function addExpenseEntry(input: ExpenseEntryInput): ExpenseEntry {
  const d = getDb();
  const ts = nowLocal();
  const id = uid('exp');
  d.prepare(
    `INSERT INTO expense_entry (id, category_id, amount, note, occurred_on, created_at)
     VALUES (@id, @category_id, @amount, @note, @occurred_on, @ts)`
  ).run({
    id,
    category_id: input.categoryId,
    amount: input.amount,
    note: input.note ?? '',
    occurred_on: input.date ?? today(),
    ts
  });
  return { id, categoryId: input.categoryId, amount: input.amount, date: input.date ?? today(), note: input.note ?? '', createdAt: ts };
}

export function deleteExpenseEntry(id: string): void {
  getDb().prepare("DELETE FROM journal_link WHERE source_kind='expense' AND source_id=?").run(id);
  getDb().prepare('DELETE FROM expense_entry WHERE id = ?').run(id);
}

/** 每日总预算（元）。0 表示不设总目标 */
export function getExpenseDailyBudget(): number {
  const raw = getSetting('expense_daily_budget');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function setExpenseDailyBudget(amount: number): void {
  setSetting('expense_daily_budget', String(Math.max(0, amount)));
}

/* ------------------------------------------------ 每月期初余额 */

export interface MonthBudget {
  /** YYYY-MM */
  month: string;
  openingBalance: number;
  note: string;
}

export function getMonthBudget(month: string): MonthBudget | undefined {
  const row = getDb()
    .prepare('SELECT month, opening_balance, note FROM expense_month_budget WHERE month = ?')
    .get(month) as { month: string; opening_balance: number; note: string } | undefined;
  if (!row) return undefined;
  return { month: row.month, openingBalance: Number(row.opening_balance ?? 0), note: String(row.note ?? '') };
}

/** 取某月所在的期初余额（按月精确匹配，不做"最近一个月"之类的揣测） */
export function getOpeningBalanceFor(date: string): number | undefined {
  const budget = getMonthBudget(date.slice(0, 7));
  return budget?.openingBalance;
}

export function setMonthBudget(month: string, openingBalance: number, note = ''): MonthBudget {
  getDb()
    .prepare(
      `INSERT INTO expense_month_budget (month, opening_balance, note, updated_at)
       VALUES (@month, @opening_balance, @note, @ts)
       ON CONFLICT(month) DO UPDATE SET
         opening_balance = @opening_balance, note = @note, updated_at = @ts`
    )
    .run({
      month,
      opening_balance: Math.max(0, openingBalance),
      note,
      ts: nowLocal()
    });
  return { month, openingBalance: Math.max(0, openingBalance), note };
}

export function clearMonthBudget(month: string): void {
  getDb().prepare('DELETE FROM expense_month_budget WHERE month = ?').run(month);
}

/* ------------------------------------------------ 示例数据 */

/**
 * 示例流水的指纹，用于判断"当前流水是否还是首次运行灌入的那份"。
 *
 * 只比对 分类 / 金额 / 备注 三项，**不比对日期也不比对 id**：
 *  - 日期会随安装时间变化（种子按"今天 − N 天"生成），比日期会导致永远匹配不上
 *  - id 是随机生成的，更不可比
 *
 * ⚠️ SQL 里**故意不写 ORDER BY**，排序一律交给 JS 完成。
 * 踩过的坑：SQL 的 `ORDER BY amount` 按**数值**排（4 在 16 前），
 * 而 JS 的 `Array.sort()` 默认按**字符串**排（"16" 在 "4" 前），
 * 两者结果不同，指纹就永远对不上，于是"清空示例数据"按钮压根不会出现。
 * 让两边都在 JS 里排，才有一致的顺序。
 */
export function expenseEntriesFingerprint(): string {
  const rows = getDb()
    .prepare(
      `SELECT c.name AS name, e.amount AS amount, e.note AS note
       FROM expense_entry e JOIN expense_category c ON c.id = e.category_id`
    )
    .all() as Array<{ name: string; amount: number; note: string }>;

  // 与 seed-data.ts 里生成指纹的方式保持完全一致：同样的模板、同样的遍历顺序
  return rows
    .map((r, index) => ({ key: `${r.name}|${r.amount}|${r.note}`, index }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((r) => r.key)
    .join('\n');
}

export function deleteAllExpenseEntries(): number {
  const before = (getDb().prepare('SELECT COUNT(*) AS c FROM expense_entry').get() as { c: number }).c;
  getDb().prepare("DELETE FROM journal_link WHERE source_kind='expense'").run();
  getDb().prepare('DELETE FROM expense_entry').run();
  return Number(before);
}

/* ---------------------------------------------------------------- 打卡 */

function rowToHabit(row: Record<string, unknown>): Habit {
  return {
    id: String(row.id),
    name: String(row.name),
    icon: String(row.icon ?? '⭐'),
    color: String(row.color ?? '#4F7CFF'),
    activeDays: String(row.active_days ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
    startDate: String(row.start_date),
    sortOrder: Number(row.sort_order ?? 0),
    archived: Number(row.archived ?? 0) === 1
  };
}

export function getHabits(includeArchived = false): Habit[] {
  const rows = (
    includeArchived
      ? getDb().prepare('SELECT * FROM habit ORDER BY archived, sort_order, created_at').all()
      : getDb().prepare('SELECT * FROM habit WHERE archived = 0 ORDER BY sort_order, created_at').all()
  ) as Record<string, unknown>[];
  return rows.map(rowToHabit);
}

export interface HabitInput {
  name: string;
  icon?: string;
  color?: string;
  activeDays?: number[];
  startDate?: string;
}

export function createHabit(input: HabitInput): Habit {
  const d = getDb();
  const ts = nowLocal();
  const maxRow = d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM habit').get() as { m: number };
  const id = uid('habit');
  const startDate = input.startDate ?? today();
  d.prepare(
    `INSERT INTO habit (id, name, icon, color, active_days, start_date, sort_order, archived, created_at, updated_at)
     VALUES (@id, @name, @icon, @color, @active_days, @start_date, @sort_order, 0, @ts, @ts)`
  ).run({
    id,
    name: input.name,
    icon: input.icon ?? '⭐',
    color: input.color ?? '#4F7CFF',
    active_days: (input.activeDays ?? []).sort((a, b) => a - b).join(','),
    start_date: startDate,
    sort_order: Number(maxRow.m) + 1,
    ts
  });
  return getHabits(true).find((h) => h.id === id)!;
}

export function updateHabit(id: string, patch: Partial<HabitInput> & { archived?: boolean }): void {
  const current = getDb().prepare('SELECT * FROM habit WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!current) throw new Error(`习惯不存在：${id}`);
  const merged = rowToHabit(current);

  getDb()
    .prepare(
      `UPDATE habit
       SET name = @name, icon = @icon, color = @color, active_days = @active_days,
           archived = @archived, updated_at = @ts
       WHERE id = @id`
    )
    .run({
      id,
      name: patch.name ?? merged.name,
      icon: patch.icon ?? merged.icon,
      color: patch.color ?? merged.color,
      active_days: (patch.activeDays ?? merged.activeDays).sort((a, b) => a - b).join(','),
      archived: (patch.archived ?? merged.archived) ? 1 : 0,
      ts: nowLocal()
    });
}

export function deleteHabit(id: string): void {
  // 签到会因外键 CASCADE 一并删除；这里不用额外清理
  getDb().prepare('DELETE FROM habit WHERE id = ?').run(id);
}

export function getCheckins(fromDate: string, toDate: string): HabitCheckin[] {
  const rows = getDb()
    .prepare(
      'SELECT habit_id, checked_on FROM habit_checkin WHERE checked_on >= ? AND checked_on <= ? ORDER BY checked_on'
    )
    .all(fromDate, toDate) as Array<{ habit_id: string; checked_on: string }>;
  return rows.map((r) => ({ habitId: r.habit_id, date: r.checked_on }));
}

export function isCheckedOn(habitId: string, date: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS one FROM habit_checkin WHERE habit_id = ? AND checked_on = ?')
    .get(habitId, date);
  return row !== undefined;
}

export function setCheckin(habitId: string, date: string, done: boolean): void {
  if (done) {
    // INSERT OR IGNORE：重复打卡是幂等的，不会报错也不会有重复行
    getDb()
      .prepare('INSERT OR IGNORE INTO habit_checkin (habit_id, checked_on, created_at) VALUES (?, ?, ?)')
      .run(habitId, date, nowLocal());
  } else {
    getDb().prepare('DELETE FROM habit_checkin WHERE habit_id = ? AND checked_on = ?').run(habitId, date);
  }
}
