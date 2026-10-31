import {isReminderEvent} from '@shared/calendarEvents';
import * as React from 'react';
import type { DayBlock } from '@shared/types';
import type { TodayView } from '@shared/view';
import { humanDuration, localToMinutes } from '@shared/time';
import { layoutIntervals } from '../lib/scheduleLayout';
import { findViewTask } from '@shared/taskActions';
import type {OpenCalendarEvent} from '../components/CalendarEventPreview';
import {taskCardClick,taskCardKey,type OpenScheduledTask} from '../components/TaskPreview';
import {t} from '@shared/i18n';
import { TaskMenu } from '../components/TaskMenu';
const KIND_LABEL: Record<DayBlock['kind'], string> = { lesson: '课程', exam: '考试', block: '任务', task: '任务', busy: '固定安排' };
/** 用固定高度的条目展示安排；并行事项逐条可读，不再互相遮挡。 */
export function DayAgenda({ state, timeline,onTaskOpen,onEventOpen }: {
    onEventOpen?:OpenCalendarEvent;
    onTaskOpen?:OpenScheduledTask;
    state: TodayView | null;
    timeline?: DayBlock[];
}) {
    const blocks = timeline ?? state?.timeline ?? [];
    const today = timeline === undefined;
    const arranged = [...layoutIntervals(blocks.filter(b=>!isReminderEvent(b)), b => ({ start: localToMinutes(b.startAt), end: localToMinutes(b.endAt) })),...blocks.filter(isReminderEvent).map(item=>({item,start:localToMinutes(item.startAt),end:localToMinutes(item.endAt),column:0,columns:1}))].sort((a,b)=>a.start-b.start);
    const past = arranged.filter(b => today && !!state?.now && b.item.endAt <= state.now);
    const upcoming = arranged.filter(b => !past.includes(b));
    const row = ({ item: block, columns }: typeof arranged[number]) => {
        const active = today && !!state?.now && block.startAt <= state.now && block.endAt > state.now;
        return <li className={`agenda-row kind-${block.kind}${active ? " is-current" : ""}`} key={block.id}><div className="agenda-time"><strong>{block.startAt.slice(11, 16)}</strong><span>{isReminderEvent(block)?"提醒":block.endAt.slice(11, 16)}</span></div><div className="agenda-track"><i></i></div><div data-event-id={block.eventId} data-task-id={block.taskId} role={block.taskId||block.eventId?'button':undefined} tabIndex={block.taskId||block.eventId?0:undefined} aria-label={block.taskId?t('查看任务：{0}',[block.title]):undefined} onClick={event=>{if(block.eventId){taskCardClick(event,()=>onEventOpen?.(block.eventId!,event.currentTarget));return;}if(block.taskId)taskCardClick(event,()=>onTaskOpen?.({taskId:block.taskId!,element:event.currentTarget,startAt:block.startAt,endAt:block.endAt,color:block.color}));}} onKeyDown={event=>{if(block.eventId){taskCardKey(event,()=>onEventOpen?.(block.eventId!,event.currentTarget));return;}if(block.taskId)taskCardKey(event,()=>onTaskOpen?.({taskId:block.taskId!,element:event.currentTarget,startAt:block.startAt,endAt:block.endAt,color:block.color}));}} className={`agenda-card${findViewTask(state, block.taskId) ? " task-with-menu" : ""}`}><TaskMenu task={findViewTask(state, block.taskId)} scheduledDate={block.startAt.slice(0,10)}></TaskMenu><div className="agenda-card-head"><span className="agenda-kind">{isReminderEvent(block)?'一次提醒':block.eventId?(block.eventType==='class'?'临时课程':block.eventType==='lecture'?'讲座':'活动'):KIND_LABEL[block.kind]}</span><div className="agenda-labels">{active && <span className="agenda-active">{"\u8FDB\u884C\u4E2D"}</span>}{columns > 1 && <span className="agenda-overlap">{"\u65F6\u95F4\u91CD\u53E0"}</span>}</div></div><h3>{block.title}</h3><div className="agenda-detail">{block.location && <span>{block.location}</span>}<span>{isReminderEvent(block)?'不占用时间段':humanDuration(localToMinutes(block.endAt) - localToMinutes(block.startAt))}</span>{block.locked && !isReminderEvent(block) && <span>{"\u5DF2\u9501\u5B9A"}</span>}</div></div></li>;
    };
    if (!state && !timeline)
        return <div className="agenda-empty">{"\u6B63\u5728\u52A0\u8F7D\u65E5\u7A0B\u2026"}</div>;
    return <div className="day-agenda">{upcoming.length === 0 && <div className="agenda-empty"><span className="agenda-empty-mark">{"\u2713"}</span><strong>{past.length ? "\u4ECA\u5929\u7684\u5B89\u6392\u5DF2\u7ED3\u675F" : "\u8FD9\u4E00\u5929\u6CA1\u6709\u5B89\u6392"}</strong><span>{past.length ? "\u56DE\u987E\u4E00\u4E0B\uFF0C\u4ECA\u5929\u4E5F\u6709\u8FDB\u5C55\u3002" : "\u7559\u4E00\u70B9\u7A7A\u767D\uFF0C\u4E5F\u53EF\u4EE5\u6DFB\u52A0\u65B0\u7684\u8BA1\u5212\u3002"}</span></div>}{(["\u4E0A\u5348", "\u4E0B\u5348", "\u665A\u4E0A"] as const).map((label, i) => { const group = upcoming.filter(b => { const hour = b.start / 60; return i === 0 ? hour < 12 : i === 1 ? hour >= 12 && hour < 18 : hour >= 18; }); return group.length > 0 && <section className="agenda-group" key={label}><div className="agenda-group-head"><span>{label}</span><span>{group.length}{" \u9879\u5B89\u6392"}</span></div><ol>{group.map(row)}</ol></section>; })}{past.length > 0 && <details className="agenda-past"><summary>{"\u5DF2\u7ED3\u675F\u7684\u5B89\u6392 "}<span>{past.length}{" \u9879"}</span></summary><ol>{past.map(row)}</ol></details>}</div>;
}
