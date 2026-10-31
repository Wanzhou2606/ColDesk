import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { urgencyMeta,sortTasksByPriority } from '@shared/scoring';
import { minutesBetween, nowLocal, relativeDay } from '@shared/time';
import type { Task } from '@shared/types';
import type { TodayView } from '@shared/view';
import { getApi } from '../lib/api';
import { TaskMenu } from './TaskMenu';
import { pinnedFirst } from '@shared/taskActions';
/** 任务列表：统一显示紧迫度、截止时间与"已排到日程"的提示 */
export function TaskList({ tasks, state, emptyHint, showDomain = false }: {
    tasks: Task[];
    state: TodayView | null;
    emptyHint: string;
    showDomain?: boolean;
}) {
    if (tasks.length === 0) {
        return <div className="empty-block t-caption">{emptyHint}</div>;
    }
    const now = nowLocal();
    const blocksByTask = new Map<string, string>();
    for (const block of state?.taskSegments?.map(b=>({...b,kind:'block'})) ?? state?.timeline ?? []) {
        if (block.kind !== 'block' || !block.taskId)
            continue;
        const label = `${block.startAt.slice(5, 10).replace('-', '/')} ${block.startAt.slice(11, 16)}-${block.endAt.slice(11, 16)}`;
        blocksByTask.set(block.taskId, blocksByTask.has(block.taskId) ? `${blocksByTask.get(block.taskId)}、${label}` : label);
    }
    const toggle = (task: Task) => {
        void getApi().invoke(task.status === 'done' ? 'task:reopen' : 'task:complete', { id: task.id });
    };
    return (<ul className="task-list">{sortTasksByPriority(tasks,state?.now??now).map(task => { const meta = urgencyMeta(task.urgency); const overdue = task.dueAt ? task.dueAt <= now && task.status !== "done" : false; const planned = blocksByTask.get(task.id); return <li data-task-id={task.id} className={`task-list-item task-with-menu${overdue ? " overdue" : ""}`} key={task.id}><TaskMenu task={task}></TaskMenu><button className={`check lg${task.status === "done" ? " checked" : ""}`} style={{ borderColor: meta.color, background: task.status === "done" ? meta.color : "transparent" } as (RecoveredStyle | undefined)} title={task.status === "done" ? "\u6062\u590D\u4E3A\u672A\u5B8C\u6210" : "\u6807\u8BB0\u5B8C\u6210"} onClick={() => toggle(task)}></button><div className="grow"><div className="row-between"><button type="button" className={`task-title-link t-body truncate${task.status === "done" ? " done" : ""}`} onClick={()=>void getApi().invoke("task:openEditor",{id:task.id,field:"all"})}>{task.title}</button><span className="t-caption nowrap">{task.dueAt ? `${relativeDay(task.dueAt.slice(0, 10), now.slice(0, 10))} ${task.dueAt.slice(11, 16)}` : "\u65E0\u622A\u6B62"}</span></div><div className="row gap-6 wrap">{task.pinned && <span className="task-pin-badge">{"\u7F6E\u9876"}</span>}<span className="pill" style={{ background: `${meta.color}1c`, color: meta.color } as (RecoveredStyle | undefined)}>{"\u7D27\u8FEB "}{task.urgency}{" \u00B7 "}{meta.label}</span>{task.estMinutes ? <span className="t-caption">{"\u9884\u4F30 "}{task.estMinutes}{" \u5206\u949F"}</span> : null}{overdue && task.dueAt ? <span className="t-caption danger">{"\u5DF2\u8D85\u671F "}{humanGap(now, task.dueAt)}</span> : task.dueAt ? <span className="t-caption">{"\u8FD8\u5269 "}{humanGap(now, task.dueAt)}</span> : null}{planned ? <span className="t-caption">{"\u5DF2\u6392 "}{planned}</span> : <span className="t-caption">{"\u672A\u6392\u5165\u65E5\u7A0B"}</span>}</div></div></li>; })}</ul>);
}
function humanGap(now: string, dueAt: string): string {
    const mins = Math.abs(minutesBetween(now, dueAt));
    if (mins < 60)
        return `${mins} 分钟`;
    if (mins < 1440)
        return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
    return `${Math.floor(mins / 1440)} 天 ${Math.floor((mins % 1440) / 60)} 小时`;
}
