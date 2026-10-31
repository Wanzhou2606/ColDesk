/**
 * ColDesk 领域类型（与设计文档 3.3 对应）
 *
 * 时间约定（重要）：
 *  - 日期：`YYYY-MM-DD`
 *  - 本地日期时间：`YYYY-MM-DDTHH:mm`（不带时区，字典序即时间序）
 *  - 一天内的时刻：`HH:mm`
 * 这样设计是为了让所有比较、排序都能用字符串比较完成，且跨天计算不依赖时区。
 */

export type Domain = 'study' | 'life';
export type TaskType = 'todo' | 'assignment' | 'experiment' | 'paper' | 'exam_prep' | 'event';
export type Urgency = 1 | 2 | 3 | 4 | 5;
export type TaskStatus = 'open' | 'doing' | 'done' | 'canceled';
export type WeekMode = 'all' | 'odd' | 'even' | 'custom';
export type OverrideKind = 'cancel' | 'reschedule' | 'room_change';
export type SlotPeriod = 'am' | 'pm' | 'eve';

export interface Semester {
  id: string;
  name: string;
  /** 第 1 教学周的周一，`YYYY-MM-DD` */
  startDate: string;
  totalWeeks: number;
  isActive: boolean;
}

export interface Course {
  id: string;
  semesterId: string;
  name: string;
  teacher?: string;
  color: string;
  credit?: number;
  note?: string;
}

export interface CourseSession {
  id: string;
  courseId: string;
  /** 1=周一 … 7=周日 */
  weekday: number;
  startSlot: number;
  endSlot: number;
  /** 日历订阅提供的实际时刻；不用用户补填节次时间。 */
  startTime?: string;
  endTime?: string;
  room?: string;
  weekMode: WeekMode;
  /** weekMode='custom' 时的周次表达式，如 "1,2,3,5,8-12" */
  weekList?: string;
}

export interface CourseSessionOverride {
  id: string;
  sessionId: string;
  /** 被调整的那一天 */
  date: string;
  kind: OverrideKind;
  newDate?: string;
  newStartSlot?: number;
  newEndSlot?: number;
  newRoom?: string;
  reason?: string;
}

export interface TimeSlot {
  id: string;
  semesterId: string;
  /** 1..N */
  slotIndex: number;
  period: SlotPeriod;
  /** `HH:mm` */
  startTime: string;
  /** `HH:mm` */
  endTime: string;
  /** 校区：同一节次在不同校区的起止时间不同 */
  campus: string;
  /** 预备铃：不排课，只用于"该去教室了"的提示 */
  isPrepareBell?: boolean;
}

export interface Task {
  id: string;
  pinned?: boolean;
  domain: Domain;
  type: TaskType;
  title: string;
  detail?: string;
  source: 'manual' | 'paste' | 'import' | 'recurring';
  sourceRaw?: string;
  courseId?: string;
  examId?: string;
  parentId?: string;
  /** 1..5，用户自填，必填 */
  urgency: Urgency;
  status: TaskStatus;
  progress: number;
  startAt?: string;
  dueAt?: string;
  allDay: boolean;
  location?: string;
  estMinutes?: number;
  splittable: boolean;
  earliestStart?: string;
  fixedAt?: string;
  remindPolicy: 'default' | 'custom' | 'none';
  /** 分钟，提前量 */
  remindOffsets?: number[];
  autoScheduled: boolean;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Exam {
  id: string;
  courseId?: string;
  semesterId: string;
  subject: string;
  examAt: string;
  durationMinutes?: number;
  location?: string;
  format?: string;
  /** 1..5 预估难度 */
  difficulty: number;
  /** 1..5 自评掌握度 */
  confidence: number;
  creditWeight?: number;
  reviewProgress: number;
  note?: string;
}

export interface ScheduleBlock {
  id: string;
  taskId: string;
  date: string;
  startAt: string;
  endAt: string;
  plannedMinutes: number;
  /** 用户拖动后锁定，重排不再移动 */
  locked: boolean;
  origin: 'auto' | 'manual';
  reason?: string;
}

export interface BusyBlock {
  id: string;
  title: string;
  weekday?: number;
  date?: string;
  startAt: string;
  endAt: string;
  domain: Domain;
}

export interface LessonPeriod { slotIndex: number; startTime: string; endTime: string }
export interface LessonMetadata { teacher?: string; lessonPeriods?: LessonPeriod[]; lessonCount?: number; lessonCountEstimated?: boolean }

/** 日视图时间线上统一的渲染块 */
export interface DayBlock extends LessonMetadata {
  eventId?:string;detail?:string;eventType?:import('./calendarEvents').CalendarEvent['type'];
  id: string;
  kind: 'lesson' | 'exam' | 'task' | 'block' | 'busy';
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  color?: string;
  courseId?: string;
  taskId?: string;
  examId?: string;
  /** 编排块的理由，鼠标悬停展示 */
  reason?: string;
  locked?: boolean;
  urgency?: Urgency;
}
