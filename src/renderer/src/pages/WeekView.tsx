import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { scheduleWindow, scheduleHours, scheduleLabelHours, scheduleClock } from '@shared/personalization';
import { teachingPeriods } from '@shared/teachingPeriods';
import { TeachingTimeLabels, TeachingTimeLines } from '../components/TeachingTimeLabels';
import { useScheduleScale } from '../lib/useScheduleScale';
import type { WeekView as WeekViewData } from '@shared/agenda';
import { humanDuration, localToMinutes } from '@shared/time';
import { layoutIntervals } from '../lib/scheduleLayout';
import { TaskMenu } from '../components/TaskMenu';
import { findViewTask } from '@shared/taskActions';
import type { TodayView } from '@shared/view';
import { WeekCourseCard } from '../components/WeekCourseCard';
import type {OpenCalendarEvent} from '../components/CalendarEventPreview';
import {taskCardClick,taskCardKey,type OpenScheduledTask} from '../components/TaskPreview';
import {t} from '@shared/i18n';
import { CoursePreview, type CourseSelection } from '../components/CoursePreview';
export function WeekView({ onEventOpen,onTaskOpen,week, onPickDay, state, zoom = 1, courseMode = false, onImportCourses }: {
    onEventOpen?:OpenCalendarEvent;
    onTaskOpen?:OpenScheduledTask;
    week: WeekViewData;
    onPickDay?: (date: string) => void;
    state?: TodayView | null;
    zoom?: number;
    courseMode?: boolean;
    onImportCourses?: () => void;
}) {
    const range = scheduleWindow(state?.settings), startHour = range.startMinute / 60, endHour = range.endMinute / 60;
    const periods = useMemo(() => teachingPeriods(state?.teachingSlots ?? [], week).periods, [week, state?.teachingSlots]);
    const hasBlocks = week.days.some(day => day.blocks.length > 0);
    const current = state?.now ? localToMinutes(state.now) : 720;
    const { viewportRef, pxPerHour } = useScheduleScale(zoom, current, 64, hasBlocks, range.startMinute, range.endMinute, courseMode ? 56 : 1);
    const [selected, setSelected] = useState<CourseSelection | null>(null);
    useEffect(() => { setSelected(null); }, [zoom, courseMode, week.weekStart]);
    const hours = useMemo(() => scheduleHours(range), [range.startMinute, range.endMinute]);
    const height = (endHour - startHour) * pxPerHour;
    const position = (minute: number) => (minute - range.startMinute) / 60 * pxPerHour;
    const minimum = (kind: string) => kind === 'lesson' ? 26 : 15;
    const visible = (blocks: WeekViewData['days'][number]['blocks']) => blocks.filter(b => (b.startMinute===b.endMinute?b.startMinute>=range.startMinute:b.endMinute>range.startMinute) && b.startMinute < range.endMinute);
    if (!hasBlocks)
        return <div className="week-empty"><div className="t-title">{"\u8FD9\u4E00\u5468\u8FD8\u6CA1\u6709\u4EFB\u4F55\u5B89\u6392"}</div><div className="t-caption">{"\u6DFB\u52A0\u4EFB\u52A1\u6216\u5BFC\u5165\u8BFE\u7A0B\u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u672A\u6765 7 \u5929\u7684\u65F6\u95F4\u5206\u5E03\u3002"}</div>{onImportCourses && <button className="ghost-btn" onClick={onImportCourses}>{"\u5BFC\u5165\u8BFE\u8868"}</button>}</div>;
    return <div className={`week-view${courseMode ? " has-teaching-times" : ""}`}><div className="week-scroll" ref={viewportRef} onScroll={() => {
            if (selected)
                setSelected(null);
        }}><div className="week-head"><div className="week-gutter"><span className="t-caption">{courseMode ? "\u65F6\u95F4 \u00B7 \u8282\u6B21" : "\u65F6\u95F4"}</span></div>{week.days.map(day => <button className={`week-day-head${day.isToday ? " today" : ""}`} onClick={() => onPickDay?.(day.date)} title={`\u67E5\u770B ${day.dayLabel} \u7684\u65E5\u89C6\u56FE`} key={day.date}><span className="week-day-weekday">{day.weekday}</span><span className="week-day-date">{day.dayLabel}</span>{visible(day.blocks).length > 0 && <span className="week-day-count">{visible(day.blocks).length}</span>}</button>)}</div><div className="week-body"><div className="week-hours" style={{ height } as RecoveredStyle}>{!courseMode && scheduleLabelHours(range, pxPerHour).map(h => <div className="hour-label" style={{ top: (h - startHour) * pxPerHour } as RecoveredStyle} key={h}><span>{scheduleClock(Math.round(h * 60))}</span></div>)}{courseMode && <TeachingTimeLabels periods={periods} start={range.startMinute} end={range.endMinute} position={position}></TeachingTimeLabels>}</div>{week.days.map(day => <div className={`week-col${day.isToday ? " today" : ""}`} style={{ height } as RecoveredStyle} key={day.date}>{!courseMode && hours.map(h => <div className="week-hour-line" style={{ top: (h - startHour) * pxPerHour, height: h === endHour ? 0 : pxPerHour } as RecoveredStyle} key={h}></div>)}{courseMode && <TeachingTimeLines periods={periods} start={range.startMinute} end={range.endMinute} position={position}></TeachingTimeLines>}{layoutIntervals(visible(day.blocks), b => { const start = position(Math.max(range.startMinute, b.startMinute)), end = position(Math.min(range.endMinute, b.endMinute)); return { start, end: Math.max(end, start + minimum(b.kind)) }; }).map(({ item: block, column, columns }) => { const top = position(Math.max(range.startMinute, block.startMinute)); const blockHeight = Math.max(position(Math.min(range.endMinute, block.endMinute)) - top, minimum(block.kind)); const style = { left: `calc(${column / columns * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)`, right: "auto", top, height: Math.min(blockHeight, Math.max(1, height - top)), borderLeftColor: block.color, background: `${block.color ?? "#4F7CFF"}22` }; return block.kind === "lesson" ? <WeekCourseCard block={block} style={style as RecoveredStyle} selected={selected?.block.id === block.id && selected.date === day.date} onOpen={element => setSelected({ block, date: day.date, element })} key={block.id}></WeekCourseCard> : <div data-event-id={block.eventId} data-task-id={block.taskId} role={block.taskId||block.eventId?'button':undefined} tabIndex={block.taskId||block.eventId?0:undefined} aria-label={block.taskId?t('查看任务：{0}',[block.title]):undefined} onClick={event=>{if(block.eventId){taskCardClick(event,()=>onEventOpen?.(block.eventId!,event.currentTarget));return;}if(block.taskId)taskCardClick(event,()=>onTaskOpen?.({taskId:block.taskId!,element:event.currentTarget,startAt:day.date+'T'+scheduleClock(block.startMinute),endAt:day.date+'T'+scheduleClock(block.endMinute),color:block.color}));}} onKeyDown={event=>{if(block.eventId){taskCardKey(event,()=>onEventOpen?.(block.eventId!,event.currentTarget));return;}if(block.taskId)taskCardKey(event,()=>onTaskOpen?.({taskId:block.taskId!,element:event.currentTarget,startAt:day.date+'T'+scheduleClock(block.startMinute),endAt:day.date+'T'+scheduleClock(block.endMinute),color:block.color}));}} className={`week-block kind-${block.kind}${block.eventId&&block.startMinute===block.endMinute?" is-reminder-event":""}${findViewTask(state, block.taskId) ? " task-with-menu" : ""}${block.locked ? " locked" : ""}`} style={style as RecoveredStyle} title={`${block.timeLabel} ${block.title}${block.location ? " \u00B7 " + block.location : ""}${block.reason ? "\n" + block.reason : ""}`} key={block.id}><span className="week-block-title truncate">{block.title}</span><TaskMenu task={findViewTask(state, block.taskId)} scheduledDate={day.date}></TaskMenu><span className="week-block-time nowrap">{block.timeLabel}</span></div>; })}</div>)}</div></div><div className="week-foot"><span className="t-caption">{"\u672A\u6765 7 \u5929\u5171 "}{week.dueCount}{" \u4E2A DDL"}</span><span className="t-caption">{"\u672A\u6765 7 \u5929\u5DF2\u7F16\u6392 "}{humanDuration(week.days.reduce((sum, d) => sum + d.blocks.filter(b => b.kind === "block").reduce((s, b) => s + b.endMinute - b.startMinute, 0), 0))}</span><span className="t-caption">{"\u70B9\u51FB\u8BFE\u7A0B\u67E5\u770B\u8BE6\u60C5 \u00B7 \u70B9\u51FB\u65E5\u671F\u770B\u5F53\u5929"}</span></div>{selected && <CoursePreview selection={selected} onClose={() => setSelected(null)} onDay={() => { const date = selected.date; setSelected(null); onPickDay?.(date); }} key={selected.date + selected.block.id}></CoursePreview>}</div>;
}
