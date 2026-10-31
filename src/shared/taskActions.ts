import {sortTasksByPriority} from './scoring';
import type { Task, Urgency } from './types';
import type { TodayView } from './view';
import { validHomeDate } from './home';
import { addDays,minutesBetween, relativeDay } from './time';
import type { DueTask } from './agenda';
export type TaskEditField = 'name' | 'urgency' | 'due' | 'all' | 'schedule';
export interface TaskPatch { title?: string; urgency?: Urgency; dueAt?: string | null; estMinutes?: number; splittable?: boolean; detail?: string }
export function validateTaskPatch(input: unknown): TaskPatch {
  if (!input || typeof input !== 'object') throw new Error('请填写要修改的任务内容');
  const data = input as Record<string, unknown>, patch: TaskPatch = {};
  if (data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 200) throw new Error('任务名称请填写 1–200 个字符');
    patch.title = data.title.trim();
  }
  if (data.urgency !== undefined) {
    if (!Number.isInteger(data.urgency) || Number(data.urgency) < 1 || Number(data.urgency) > 5) throw new Error('紧迫程度请选择 1–5');
    patch.urgency = data.urgency as Urgency;
  }
  if (data.dueAt !== undefined) {
    if (data.dueAt !== null && (typeof data.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.dueAt) || !validHomeDate(data.dueAt.slice(0,10)))) throw new Error('请选择有效的截止日期和时间');
    patch.dueAt = data.dueAt as string | null;
  }
  if (data.estMinutes !== undefined) {
    if (!Number.isInteger(data.estMinutes) || Number(data.estMinutes) < 5 || Number(data.estMinutes) > 1440) throw new Error('预计用时请填写 5–1440 分钟');
    patch.estMinutes = data.estMinutes as number;
  }
  if (data.splittable !== undefined) {
    if (typeof data.splittable !== 'boolean') throw new Error('请选择是否允许拆分任务');
    patch.splittable = data.splittable;
  }
  if (data.detail !== undefined) {
    if (typeof data.detail !== 'string' || data.detail.length > 2000) throw new Error('任务备注请控制在 2000 字以内');
    patch.detail = data.detail;
  }
  if (!Object.keys(patch).length) throw new Error('请填写要修改的任务内容');
  return patch;
}
export function findViewTask(state: TodayView | null | undefined, id?: string): Task | undefined {
  return id ? Object.values(state?.buckets ?? {}).flat().find(task => task.id === id) : undefined;
}
export function pinnedFirst<T extends { pinned?: boolean }>(items: T[]): T[] {
  return [...items].sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned));
}
export function deadlineTasksWithPins(state: TodayView | null): DueTask[] {
 if(!state)return [];const supplied=[...state.todayTasks,...state.urgentTasks],all=[...supplied.map(item=>item.task),...Object.values(state.buckets).flat()],tasks=all.filter((task,index)=>task.status!=='done'&&task.status!=='canceled'&&all.findIndex(other=>other.id===task.id)===index);
 return sortTasksByPriority(tasks,state.now).map(task=>supplied.find(item=>item.task.id===task.id)??{task,overdue:!!task.dueAt&&task.dueAt<state.now,dueLabel:task.dueAt?relativeDay(task.dueAt.slice(0,10),state.now.slice(0,10))+' '+task.dueAt.slice(11,16):'无截止',untilDueMinutes:task.dueAt?minutesBetween(state.now,task.dueAt):null});
}
/** Island deadlines use the current local day, independently of a browsed schedule date. */
export function nearbyDeadlineTasks(state:TodayView|null):{today:DueTask[];tomorrow:DueTask[]}{
 const date=state?.now.slice(0,10)??state?.date;
 if(!date)return {today:[],tomorrow:[]};
 const next=addDays(date,1),items=deadlineTasksWithPins(state);
 return {today:items.filter(item=>item.task.dueAt?.slice(0,10)===date),tomorrow:items.filter(item=>item.task.dueAt?.slice(0,10)===next)};
}
export type TaskPageGroup='today'|'threeDays'|'week'|'later';
/** Disjoint local-calendar ranges; overdue work stays visible in today's group. */
export function taskPageGroups(state:TodayView|null):Record<TaskPageGroup,Task[]>{
 const groups:Record<TaskPageGroup,Task[]>={today:[],threeDays:[],week:[],later:[]};
 if(!state)return groups;
 const date=state.now.slice(0,10),threeDays=addDays(date,3),week=addDays(date,7),seen=new Set<string>();
 for(const task of Object.values(state.buckets).flat()){
  if(task.status==='done'||task.status==='canceled'||seen.has(task.id))continue;
  seen.add(task.id);
  const due=task.dueAt?.slice(0,10);
  const key:TaskPageGroup=!due?'later':due<=date?'today':due<=threeDays?'threeDays':due<=week?'week':'later';
  groups[key].push(task);
 }
 return groups;
}
