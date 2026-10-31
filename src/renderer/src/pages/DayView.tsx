import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { DayBlock, LessonPeriod } from '@shared/types';
import { TeachingTimeLabels, TeachingTimeLines } from '../components/TeachingTimeLabels';
import {isReminderEvent,eventTimeLabel} from '@shared/calendarEvents';
import type {OpenCalendarEvent} from '../components/CalendarEventPreview';
import { humanDuration, localToMinutes,hhmmToMinutes } from '@shared/time';
import type { TodayView } from '@shared/view';
import { layoutIntervals } from '../lib/scheduleLayout';
import {taskCardClick,taskCardKey,type OpenScheduledTask} from '../components/TaskPreview';
import {t} from '@shared/i18n';
import { TaskMenu } from '../components/TaskMenu';
import { findViewTask } from '@shared/taskActions';
import { scheduleWindow, scheduleHours, scheduleLabelHours, scheduleClock } from '@shared/personalization';
import { useScheduleScale } from '../lib/useScheduleScale';
import { useLiveClock } from '../lib/useLiveClock';
import { SCHEDULE_DRAG_TYPE, manualRange, parseScheduleDrag, placementConflict, type ManualPlacement, type ScheduleDragTask } from '@shared/manualSchedule';
const MIN_BLOCK_PX = 18;
/**
 * 日视图时间线（设计文档 5.1）：课程 / 考试 / 生活占用 / 编排块同轴叠加。
 *
 * timeline 可由外部传入：周视图里点选某一天时，直接喂那一天的块，
 * 这样"周视图 → 点某天看细节"不需要再往主进程要数据。
 */
export function DayView({ onEventOpen,studyMode=false,onTaskOpen,state, timeline, headerLabel, date, dragTask, onDragTask, onDragEnd, onPlaceTask, onRemovePlacement, disabled = false, zoom = 1, courseMode = false, periods = [] }: {
    onEventOpen?:OpenCalendarEvent;studyMode?:boolean;
    onTaskOpen?:OpenScheduledTask;
    state: TodayView | null;
    timeline?: DayBlock[];
    headerLabel?: string;
    date?: string;
    dragTask?: ScheduleDragTask | null;
    onDragTask?: (task: ScheduleDragTask) => void;
    onDragEnd?: () => void;
    onPlaceTask?: (data: ManualPlacement) => Promise<void>;
    onRemovePlacement?: (blockId: string) => Promise<void>;
    disabled?: boolean;
    zoom?: number;
    courseMode?: boolean;
    periods?: LessonPeriod[];
}) {
    const { now, minutes: nowMinutes } = useLiveClock(state?.now ?? '');
    const viewDate = date ?? state?.date;
    const isToday = !!viewDate && viewDate === now.slice(0, 10);
    const range = scheduleWindow(state?.settings), START_HOUR = range.startMinute / 60, END_HOUR = range.endMinute / 60;
    const { viewportRef: scrollRef, pxPerHour } = useScheduleScale(zoom, isToday ? Math.max(0, nowMinutes) : 720, 16, true, range.startMinute, range.endMinute, courseMode ? 56 : 1);
    const suppressClickUntil=useRef(0);
    const hoursRef = useRef<HTMLDivElement | null>(null);
    const allBlocks = timeline ?? state?.timeline ?? [];
    const blocks = useMemo(() => allBlocks.filter(b => (isReminderEvent(b)?localToMinutes(b.startAt)>=range.startMinute:localToMinutes(b.endAt)>range.startMinute) && localToMinutes(b.startAt) < range.endMinute), [allBlocks, range.startMinute, range.endMinute]);
    const visibleStart = (b: DayBlock) => Math.max(range.startMinute, localToMinutes(b.startAt));
    const visibleEnd = (b: DayBlock) => Math.min(range.endMinute, localToMinutes(b.endAt));
    const [preview, setPreview] = useState<{
        startMinute: number;
        startAt: string;
        endLabel: string;
        error: string | null;
        duration: number;
    } | null>(null);
    useEffect(() => {
        if (!dragTask)
            setPreview(null);
    }, [dragTask]);
    const arranged = useMemo(() => layoutIntervals(blocks, block => ({ start: visibleStart(block), end: Math.max(visibleEnd(block), visibleStart(block) + MIN_BLOCK_PX / pxPerHour * 60) })), [blocks, pxPerHour, range.startMinute, range.endMinute]);
    const target = (event: DragEvent<HTMLDivElement>, task: ScheduleDragTask) => {
        if (!viewDate)
            return null;
        const grid = event.currentTarget.getBoundingClientRect();
        const snapped = Math.round((range.startMinute + (event.clientY - grid.top) / pxPerHour * 60) / 5) * 5;
        const first = Math.ceil(range.startMinute / 5) * 5, last = Math.floor((range.endMinute - 1) / 5) * 5;
        const minute = first <= last ? Math.min(last, Math.max(first, snapped)) : range.startMinute;
        const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        const startAt=`${viewDate}T${clock}`,duration=task.durationMinutes;
        let error = placementConflict(allBlocks, startAt, duration, task.blockId);
        let endLabel = '';
        try {
            endLabel = manualRange(startAt, duration).endAt.slice(11, 16);
        }
        catch { }
        return { startMinute:minute,startAt,endLabel,error,duration };
    };
    const dragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (!dragTask || disabled || !onPlaceTask || !event.dataTransfer.types.includes(SCHEDULE_DRAG_TYPE)) {
            event.dataTransfer.dropEffect = 'none';
            return;
        }
        const canvas = scrollRef.current;
        if (canvas) {
            const bounds = canvas.getBoundingClientRect();
            if (event.clientY < bounds.top + 28)
                canvas.scrollTop -= 12;
            else if (event.clientY > bounds.bottom - 28)
                canvas.scrollTop += 12;
        }
        const next = target(event, dragTask);
        setPreview(next);
        event.dataTransfer.dropEffect = next?.error ? 'none' : dragTask.blockId ? 'move' : 'copy';
    };
    const drop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const task = parseScheduleDrag(event.dataTransfer.getData(SCHEDULE_DRAG_TYPE));
        if (!task || disabled || !onPlaceTask)
            return;
        const next = target(event, task);
        setPreview(null);
        onDragEnd?.();
        if (next&&!next.error)
            void onPlaceTask({ ...task, startAt: next.startAt,durationMinutes:next.duration });
    };
    const canMove = (block: DayBlock) => { const task = findViewTask(state, block.taskId); return !!onDragTask && !disabled && !!task && task.status !== 'done' && task.status !== 'canceled'; };
    const dragBlock = (event: DragEvent<HTMLDivElement>, block: DayBlock) => {
        if (!canMove(block) || !block.taskId || !onDragTask) {
            event.preventDefault();
            return;
        }
        suppressClickUntil.current=Infinity;
        const count=periods.filter(p=>hhmmToMinutes(p.startTime)>=localToMinutes(block.startAt)&&hhmmToMinutes(p.endTime)<=localToMinutes(block.endAt)).length;
        const data = { taskId: block.taskId, blockId: block.id.replace(/^block:/, ''), durationMinutes: localToMinutes(block.endAt) - localToMinutes(block.startAt) };
        event.dataTransfer.setData(SCHEDULE_DRAG_TYPE, JSON.stringify(data));
        event.dataTransfer.effectAllowed = 'move';
        onDragTask(data);
    };
    const minutesToTop = (minutes: number) => (minutes - START_HOUR * 60) / 60 * pxPerHour;
    const hours = useMemo(() => scheduleHours(range), [range.startMinute, range.endMinute]);
    const gaps = useMemo(() => (isToday ? findGaps(blocks, Math.max(range.startMinute, nowMinutes), range.startMinute, range.endMinute) : findGaps(blocks, range.startMinute, range.startMinute, range.endMinute)), [blocks, nowMinutes, isToday, range.startMinute, range.endMinute]);
    return (<div className={`day-view${zoom === 1 ? " is-fit" : ""}${dragTask ? " is-dragging-task" : ""}${courseMode ? " has-teaching-times" : ""}`} data-zoom={zoom}><div className="day-view-hours" ref={hoursRef} style={{ height: (END_HOUR - START_HOUR) * pxPerHour } as (RecoveredStyle | undefined)}>{!courseMode && scheduleLabelHours(range, pxPerHour).map(h => <div className="hour-label" style={{ top: (h - START_HOUR) * pxPerHour } as (RecoveredStyle | undefined)} key={h}><span>{scheduleClock(Math.round(h * 60))}</span></div>)}{courseMode && <TeachingTimeLabels periods={periods} start={range.startMinute} end={range.endMinute} position={minutesToTop}></TeachingTimeLabels>}</div><div className="day-view-canvas" ref={scrollRef} onDragLeave={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom)
                setPreview(null);
        }} onScroll={event => {
            if (hoursRef.current)
                hoursRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
        }}><div className="day-view-grid" onDragOver={dragOver} onDrop={drop} style={{ height: (END_HOUR - START_HOUR) * pxPerHour } as (RecoveredStyle | undefined)}>{headerLabel && <div className="day-view-badge t-caption">{headerLabel}</div>}{!courseMode && hours.map(h => <div className="hour-line" style={{ top: (h - START_HOUR) * pxPerHour, height: h === END_HOUR ? 0 : pxPerHour } as (RecoveredStyle | undefined)} key={h}></div>)}{courseMode && <TeachingTimeLines periods={periods} start={range.startMinute} end={range.endMinute} position={minutesToTop}></TeachingTimeLines>}{blocks.length === 0 && <div className="day-empty t-caption">{"\u8FD9\u4E00\u5929\u6CA1\u6709\u5B89\u6392"}</div>}{gaps.map(gap => <div className="gap-hint" style={{ top: minutesToTop(gap.start), height: (gap.end - gap.start) / 60 * pxPerHour } as (RecoveredStyle | undefined)} key={`gap-${gap.start}`}>{"\u7A7A\u95F2 "}{humanDuration(gap.end - gap.start)}</div>)}{arranged.map(({ item: block, column, columns }) => <div draggable={canMove(block)} onDragStart={event => dragBlock(event, block)} onDragEnd={()=>{suppressClickUntil.current=Date.now()+250;onDragEnd?.();}} data-event-id={block.eventId} data-task-id={block.taskId} role={block.taskId||block.eventId?'button':undefined} tabIndex={block.taskId||block.eventId?0:undefined} aria-label={block.taskId?t('查看任务：{0}',[block.title]):undefined} onClick={event=>{if(block.eventId){taskCardClick(event,()=>onEventOpen?.(block.eventId!,event.currentTarget));return;}if(Date.now()<suppressClickUntil.current||!block.taskId)return;taskCardClick(event,()=>onTaskOpen?.({taskId:block.taskId!,element:event.currentTarget,startAt:block.startAt,endAt:block.endAt,color:block.color}));}} onKeyDown={event=>{if(block.eventId){taskCardKey(event,()=>onEventOpen?.(block.eventId!,event.currentTarget));return;}if(block.taskId)taskCardKey(event,()=>onTaskOpen?.({taskId:block.taskId!,element:event.currentTarget,startAt:block.startAt,endAt:block.endAt,color:block.color}));}} className={`time-block kind-${block.kind}${isReminderEvent(block)?" is-reminder-event":""}${findViewTask(state, block.taskId) ? " task-with-menu" : ""}${block.locked ? " locked" : ""}${(localToMinutes(block.endAt) - localToMinutes(block.startAt)) / 60 * pxPerHour < 40 ? " compact" : ""}`} style={{ left: `calc(${column / columns * 100}% + 5px)`, width: `calc(${100 / columns}% - 10px)`, right: "auto", top: minutesToTop(visibleStart(block)), height: Math.max((visibleEnd(block) - visibleStart(block)) / 60 * pxPerHour, MIN_BLOCK_PX), borderLeftColor: block.color, background: block.kind==="lesson"?`color-mix(in srgb, ${block.color??"#a9c7e8"} 42%,var(--surface-raised))`:`${block.color ?? "#4F7CFF"}1f` } as (RecoveredStyle | undefined)} title={`${block.title}
${eventTimeLabel(block)}${block.location ? ` \xB7 ${block.location}` : ""}${block.reason ? `
${block.reason}` : ""}`} key={block.id}><TaskMenu task={findViewTask(state, block.taskId)} disabled={disabled} scheduledDate={block.startAt.slice(0,10)}></TaskMenu><div className="row-between time-block-content" title={canMove(block) ? "\u62D6\u52A8\u53EF\u8C03\u6574\u8FD9\u9879\u4EFB\u52A1\u7684\u65F6\u95F4" : void 0}><span className="t-body truncate">{block.title}</span><span className="t-caption nowrap">{eventTimeLabel(block)}{isReminderEvent(block)&&<span className="event-once-label"> · 提醒</span>}</span></div>{block.location && <div className="t-caption truncate">{block.location}</div>}{block.locked && block.taskId && onRemovePlacement && <button className="remove-placement-btn" disabled={disabled} title="移除这段手动安排（任务仍保留）" aria-label={`\u79FB\u9664\u5B89\u6392\uFF1A${block.title}`} onClick={() => void onRemovePlacement(block.id.replace(/^block:/, ""))}>{"\u00D7"}</button>}</div>)}{preview && <div className={`schedule-drop-preview${preview.error ? " conflict" : ""}`} style={{ top: minutesToTop(preview.startMinute), height: Math.min((range.endMinute - preview.startMinute) / 60 * pxPerHour, Math.max(4, preview.duration / 60 * pxPerHour)) } as (RecoveredStyle | undefined)} aria-hidden="true"></div>}{isToday && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60 && <div className="now-line" style={{ top: minutesToTop(nowMinutes) } as (RecoveredStyle | undefined)}><span className="now-dot"></span><span className="now-label">{now.slice(11, 16)}</span></div>}</div></div>{preview && <div className={`schedule-drop-readout${preview.error ? " conflict" : ""}`} role="status"><strong>{preview.startAt.slice(11, 16)}{preview.endLabel ? `\u2013${preview.endLabel}` : ""}{" \u00B7 "}{preview.duration}{" \u5206\u949F"}</strong><span>{preview.error || "\u677E\u5F00\u5373\u53EF\u5B89\u6392"}</span></div>}</div>);
}
/** 连续空闲超过 90 分钟才提示（设计文档 5.1） */
function findGaps(blocks: DayBlock[], fromMinutes: number, startMinute: number, endMinute: number): Array<{
    start: number;
    end: number;
}> {
    if (blocks.length === 0)
        return [];
    const sorted = blocks.filter(b=>!isReminderEvent(b)).sort((a, b) => localToMinutes(a.startAt) - localToMinutes(b.startAt));
    const gaps: Array<{
        start: number;
        end: number;
    }> = [];
    let cursor = Math.max(startMinute, fromMinutes);
    for (const block of sorted) {
        const start = localToMinutes(block.startAt);
        const end = localToMinutes(block.endAt);
        if (start - cursor >= 90)
            gaps.push({ start: cursor, end: start });
        cursor = Math.max(cursor, end);
    }
    if (endMinute - cursor >= 90)
        gaps.push({ start: cursor, end: endMinute });
    return gaps.slice(0, 3);
}
