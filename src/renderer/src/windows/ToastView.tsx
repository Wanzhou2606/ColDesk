import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { urgencyMeta } from '@shared/scoring';
import type { ToastUpdate, ToastView } from '@shared/view';
export interface ToastActions {
    onDone: (item: ToastView) => void;
    onSnooze: (item: ToastView, minutes: number) => void;
    onDismiss: (item: ToastView) => void;
    onOpen: (item: ToastView) => void;
}
const SNOOZE_OPTIONS: Array<{
    label: string;
    minutes: number;
}> = [
    { label: '5 分钟', minutes: 5 },
    { label: '15 分钟', minutes: 15 },
    { label: '1 小时', minutes: 60 }
];
/** 提醒弹窗的纯展示层，便于在纯 Node 下渲染验证 */
export function ToastStackView({ update, actions }: {
    update: ToastUpdate;
    actions: ToastActions;
}) {
    const items = update.items ?? [];
    const queued = update.queued ?? 0;
    return (<div className="toast-root"><div className="toast-stack">{items.map(item => { const meta = item.urgency ? urgencyMeta(item.urgency) : void 0; return <article className={`glass toast-card${item.kind === "startup" ? " startup" : ""}${item.strong ? " strong" : ""}`} style={meta ? { borderLeft: `3px solid ${meta.color}` } : void 0 as (RecoveredStyle | undefined)} key={item.id}><div className="row-between"><span className="row gap-6"><span className="t-caption">{labelOf(item)}</span>{meta && <span className="pill" style={{ background: `${meta.color}22`, color: meta.color } as (RecoveredStyle | undefined)}>{"\u7D27\u8FEB "}{item.urgency}{" \u00B7 "}{meta.label}</span>}</span><span className="t-caption nowrap">{item.timeLabel}</span></div><div className="t-title toast-title">{item.title}</div>{item.body && <div className="t-caption toast-body">{item.body}</div>}<div className="row-between toast-actions"><div className="row">{item.taskId && <button className="primary-btn" onClick={() => actions.onDone(item)}>{"\u5B8C\u6210"}</button>}{(item.kind==='event'||item.kind==='startup')?<button className="ghost-btn" onClick={()=>actions.onOpen(item)}>查看日程</button>:SNOOZE_OPTIONS.slice(0, 2).map(opt => <button className="ghost-btn" onClick={() => actions.onSnooze(item, opt.minutes)} key={opt.minutes}>{"\u7A0D\u540E "}{opt.label}</button>)}</div><button className="icon-btn" title="关闭" onClick={() => actions.onDismiss(item)}>{"\u2715"}</button></div></article>; })}</div>{queued > 0 && <div className="toast-queued t-caption">{"\u8FD8\u6709 "}{queued}{" \u6761\u63D0\u9192\u5728\u6392\u961F"}</div>}</div>);
}
export function labelOf(item: ToastView): string {
    switch (item.kind) {
        case 'startup': return '启动提醒';
        case 'event': return '事件提醒 · 仅此一次';
        case 'class':
            return '去上课';
        case 'overdue':
            return '已超期';
        case 'daily_digest':
            return '今日清单';
        case 'missed':
            return '错过提醒';
        default:
            return '任务提醒';
    }
}
export { SNOOZE_OPTIONS };
