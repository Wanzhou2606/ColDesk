import type { DayBlock } from './types';
import { localToMinutes } from './time';
export const SCHEDULE_DRAG_TYPE = 'application/x-coldesk-schedule-task';
export interface ScheduleDragTask { taskId: string; durationMinutes: number; blockId?: string; studyPeriods?:number }
export interface ManualPlacement extends ScheduleDragTask { startAt: string }
export function manualRange(startAt: unknown, duration: unknown) {
  if (typeof startAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(startAt)) throw new Error('请选择有效的安排时间');
  const date = startAt.slice(0, 10), parsed = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('请选择有效的安排日期');
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('安排时长请填写 1–1440 分钟');
  const startMinute = localToMinutes(startAt), endMinute = startMinute + duration;
  if (endMinute > 1440) throw new Error('请安排在 00:00–24:00 内，或缩短本次时长');
  const endAt = `${date}T${String(Math.floor(endMinute / 60)).padStart(2,'0')}:${String(endMinute % 60).padStart(2,'0')}`;
  return { date, startAt, endAt, startMinute, endMinute, durationMinutes: duration };
}
export function placementConflict(blocks: DayBlock[], startAt: string, duration: number, movingBlockId?: string, movingTaskId?: string): string | null {
  let range;
  try { range = manualRange(startAt, duration); } catch (error) { return error instanceof Error ? error.message : '请选择有效的时间'; }
  const conflict = blocks.find(block => {
    if (block.eventId && block.startAt===block.endAt) return false;
    if (block.id === `block:${movingBlockId}`) return false;
    if (!['lesson','exam','busy'].includes(block.kind) && !block.locked) return false;
    return block.startAt < range.endAt && block.endAt > range.startAt;
  });
  if (!conflict) return null;
  return `与「${conflict.title}」${conflict.kind === 'lesson' ? '课程' : conflict.kind === 'block' ? '手动安排' : '固定安排'}冲突，请换一个时间`;
}
export function parseScheduleDrag(value: string): ScheduleDragTask | null {
  try {
    const data = JSON.parse(value) as ScheduleDragTask;
    if (typeof data.taskId !== 'string' || !data.taskId || data.taskId.length > 200) return null;
    if (!Number.isInteger(data.durationMinutes) || data.durationMinutes < 1 || data.durationMinutes > 1440) return null;
    if (data.blockId !== undefined && (typeof data.blockId !== 'string' || !data.blockId || data.blockId.length > 200)) return null;
    if(data.studyPeriods!==undefined&&(!Number.isInteger(data.studyPeriods)||data.studyPeriods<1||data.studyPeriods>6))return null;
    return { taskId: data.taskId, durationMinutes: data.durationMinutes, ...(data.blockId ? { blockId: data.blockId } : {}),...(data.studyPeriods?{studyPeriods:data.studyPeriods}:{}) };
  } catch { return null; }
}
