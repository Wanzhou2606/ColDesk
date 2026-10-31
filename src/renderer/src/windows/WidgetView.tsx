import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { AppLogo } from '../components/AppLogo';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agenda } from '@shared/agenda';
import { urgencyMeta } from '@shared/scoring';
import { humanDuration } from '@shared/time';
import type { Task, Urgency } from '@shared/types';
import type { TodayView } from '@shared/view';
import { findViewTask, deadlineTasksWithPins } from '@shared/taskActions';
import { TaskMenu } from '../components/TaskMenu';
import { useWidgetDrag } from '../lib/useWidgetDrag';
export type WidgetItem = Agenda['next'][number];
export interface WidgetActions {
    onQuickAdd: (input: {
        title: string;
        urgency: Urgency;
        domain: 'study' | 'life';
    }) => void;
    onComplete: (taskId: string) => void;
    onHide: () => void;
    /** 切换置顶 / 普通 */
    onCycleLayer: () => void;
    onOpenMain?: () => void;
    onOpenSettings: () => void;
    /** 打开主窗口并停在记账页 */
    onOpenExpenses: () => void;
}
/** 层级按钮的图标与提示（置底会带来"被盖住"的后果，所以提示写清楚） */
const LAYER_META: Record<'top' | 'normal' | 'bottom', {
    icon: string;
    label: string;
    title: string;
}> = {
    top: { icon: '📌', label: '置顶', title: '已固定在最前（点击取消置顶）' },
    normal: { icon: '📍', label: '普通', title: '已取消置顶，会被其它窗口盖住；点一下重新置顶' },
    bottom: {
        icon: '⬇',
        label: '置底',
        title: '当前置底，会被浏览器等窗口盖住；点一下恢复置顶（也可从托盘菜单改）'
    }
};
/** 同一套细线图标，避免系统彩色 emoji 在玻璃上显得杂乱。 */
function WidgetIcon({ name }: {
    name: 'pin' | 'chevron' | 'close' | 'settings' | 'wallet' | 'calendar';
}) {
    const paths = {
        pin: 'M9 3h6l-1 6 3 3v2h-5v7m-5-7H4v-2l3-3-1-6',
        chevron: 'm7 10 5 5 5-5',
        close: 'm6 6 12 12M18 6 6 18',
        settings: 'm9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
        wallet: 'M4 6h14v3H4a2 2 0 0 1 0-4l13-1M2 7v11a2 2 0 0 0 2 2h16V9h-7v7h7m-3-4h.01',
        calendar: 'M7 3v4m10-4v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2m2 9h3m4 0h3m-10 4h3'
    };
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}></path></svg>;
}
/**
 * 悬浮窗的纯展示层。
 *
 * 抽成无副作用组件的原因：容器（Widget）依赖 window.coldesk 与订阅，
 * 无法在纯 Node 下渲染验证；把展示逻辑独立出来后，可以用 fixture 直接
 * 断言渲染结果，保证"卡片上到底显示了什么"是被测试覆盖的。
 */
export function WidgetView({ state, actions, quickTitle, urgency, domain, onQuickTitleChange, onUrgencyChange, onDomainChange, collapsed, onToggleCollapsed, rippleKey }: {
    state: TodayView | null;
    actions: WidgetActions;
    quickTitle: string;
    urgency: Urgency;
    domain: 'study' | 'life';
    onQuickTitleChange: (next: string) => void;
    onUrgencyChange: (next: Urgency) => void;
    onDomainChange: (next: 'study' | 'life') => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    rippleKey: string | null;
}) {
    const moment = state?.primary ?? state?.current;
    const drag = useWidgetDrag();
    const layer = state?.settings.desktopLayer ?? 'top';
    const layerMeta = LAYER_META[layer];
    const visibleNext = useMemo(() => (state?.next ?? []).filter((item) => item.id !== moment?.id).slice(0, 2), [state?.next, moment?.id]);
    const submit = () => {
        const title = quickTitle.trim();
        if (!title)
            return;
        actions.onQuickAdd({ title, urgency, domain:'study' });
    };
    return (<div className="widget-root"><div className={`glass widget-shell widget-shell--harmony${collapsed ? " is-collapsed" : ""}${rippleKey ? " ripple" : ""}`}><div className="glass-light" aria-hidden="true"></div><header className={`widget-header drag-handle${drag.dragging ? " is-dragging" : ""}`} {...drag.handlers}><div className="row"><AppLogo className="widget-logo" alt="ColDesk 图标" draggable={false}></AppLogo><div><div className="t-title">{"ColDesk"}</div><div className="t-caption">{state?.dateLabel ?? "\u52A0\u8F7D\u4E2D\u2026"}</div></div></div><div className="row no-drag"><button className={`icon-btn layer-btn${layer !== "top" ? " muted" : ""}`} title={layerMeta.title} aria-label={layerMeta.label} onClick={actions.onCycleLayer}><WidgetIcon name="pin"></WidgetIcon></button><button className={`icon-btn collapse-btn${collapsed ? " is-collapsed" : ""}`} title="折叠 / 展开" aria-label={collapsed ? "\u5C55\u5F00\u60AC\u6D6E\u7A97" : "\u6298\u53E0\u60AC\u6D6E\u7A97"} aria-expanded={!collapsed} onClick={onToggleCollapsed}><WidgetIcon name="chevron"></WidgetIcon></button><button className="icon-btn" title="隐藏悬浮窗（Ctrl+Alt+D）" onClick={actions.onHide}><WidgetIcon name="close"></WidgetIcon></button></div></header>{!collapsed && <><div className="widget-body"><MomentSection moment={moment} state={state}></MomentSection>{visibleNext.length > 0 && <section><div className="row-between section-head"><span className="section-label">{"\u63A5\u4E0B\u6765"}</span></div><ul className="item-list">{visibleNext.map(item => <li data-task-id={item.taskId} className={`next-row${findViewTask(state, item.taskId) ? " task-with-menu" : ""}`} key={item.id}><TaskMenu task={findViewTask(state, item.taskId)}></TaskMenu><span className="dot" style={{ background: item.color ?? "var(--accent)" } as (RecoveredStyle | undefined)}></span><div className="grow"><div className="row-between"><span className="t-body truncate">{item.title}</span><span className="t-caption nowrap">{item.timeLabel}</span></div><div className="t-caption">{item.countdownLabel}{item.location ? ` \xB7 ${item.location}` : ""}</div></div></li>)}</ul></section>}<TaskSection state={state} onComplete={actions.onComplete}></TaskSection>{state && state.warnings.length > 0 && <div className="warn-box"><span className="pill pill-danger">{"\u6392\u7A0B\u63D0\u9192"}</span><span className="t-caption">{state.warnings[0].message}</span></div>}</div><div className="widget-compose"><footer className="quick-add"><div className="row quick-add-row"><input className="quick-input" placeholder="添加任务，回车保存…" value={quickTitle} onChange={e => onQuickTitleChange(e.target.value)} onKeyDown={e => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing)
                    submit();
            }}></input><button className="primary-btn" onClick={submit} title="保存到任务栏">{"\u6DFB\u52A0"}</button></div><div className="row-between quick-add-meta"><div className="row urgency-picker">{([1, 2, 3, 4, 5] as const).map(u => <button className={`urgency-btn${urgency === u ? " active" : ""}`} style={urgency === u ? { background: urgencyMeta(u).color, color: "#fff" } : void 0 as (RecoveredStyle | undefined)} title={`${urgencyMeta(u).label} \xB7 ${urgencyMeta(u).meaning}`} onClick={() => onUrgencyChange(u)} key={u}>{u}</button>)}<span className="t-caption">{urgencyMeta(urgency).label}</span></div></div></footer><nav className="widget-foot" aria-label="快捷操作"><div className="optical-dock"><button className="pill-btn" title="查看全部日程与任务" onClick={actions.onOpenMain}><WidgetIcon name="calendar"></WidgetIcon><span>{"\u65E5\u7A0B"}</span></button><button className="pill-btn" title="打开设置" onClick={actions.onOpenSettings}><WidgetIcon name="settings"></WidgetIcon><span>{"\u8BBE\u7F6E"}</span></button><button className="pill-btn" title="记一笔支出" onClick={actions.onOpenExpenses}><WidgetIcon name="wallet"></WidgetIcon><span>{"\u8BB0\u4E00\u7B14"}</span></button></div></nav></div></>}</div></div>);
}
export function MomentSection({ moment, state }: {
    moment?: WidgetItem;
    state: TodayView | null;
}) {
    if (!state)
        return null;
    const summary = state.summary;
    const remainingLessons = state.timeline.filter((item) => item.kind === 'lesson' && item.endAt > state.now).length;
    const active = moment ? moment.status === 'ongoing' || moment.status === 'soon' : false;
    return (<section><div className="row-between section-head"><span className="section-label">{"\u5F53\u4E0B"}</span><span className="t-caption">{summary.doneTodayCount + summary.dueTodayCount > 0 ? `${summary.doneTodayCount}/${summary.doneTodayCount + summary.dueTodayCount} \u5B8C\u6210` : "\u4ECA\u65E5\u65E0\u5230\u671F"}</span></div>{moment ? <div data-task-id={moment.taskId} className={`glass-card moment-card${findViewTask(state, moment.taskId) ? " task-with-menu" : ""}${active ? " active" : ""}`} style={moment.color ? { borderLeft: `3px solid ${moment.color}` } : void 0 as (RecoveredStyle | undefined)}><TaskMenu task={findViewTask(state, moment.taskId)}></TaskMenu><div className="row-between"><span className="pill pill-accent">{moment.status === "ongoing" ? "\u6B63\u5728\u8FDB\u884C" : moment.status === "soon" ? "\u5373\u5C06\u5F00\u59CB" : "\u4E0B\u4E00\u6B65"}</span><span className="t-caption nowrap">{moment.timeLabel}</span></div><div className="t-title moment-title truncate">{moment.title}</div><div className="t-caption">{moment.countdownLabel}{moment.location ? ` \xB7 ${moment.location}` : ""}</div></div> : <div className="glass-card moment-card empty"><div className="t-body">{"\u73B0\u5728\u6CA1\u6709\u5B89\u6392"}</div><div className="t-caption">{remainingLessons > 0 ? `\u4ECA\u5929\u8FD8\u6709 ${remainingLessons} \u8282\u8BFE\uFF0C\u5176\u4F59\u65F6\u95F4\u81EA\u7531\u5B89\u6392` : summary.lessonCount > 0 ? "\u4ECA\u5929\u7684\u8BFE\u5DF2\u7ED3\u675F\uFF0C\u7559\u4E00\u70B9\u65F6\u95F4\u7ED9\u81EA\u5DF1" : "\u5728\u4E0B\u65B9\u6DFB\u52A0\u4E00\u9879\u4EFB\u52A1\uFF0C\u5F00\u59CB\u5B89\u6392\u4ECA\u5929"}</div></div>}</section>);
}
export function TaskSection({ state, onComplete }: {
    state: TodayView | null;
    onComplete: (taskId: string) => void;
}) {
    if (!state)
        return null;
    const allItems = deadlineTasksWithPins(state);
    const items = allItems.slice(0, 3);
    return (<section><div className="row-between section-head"><span className="section-label">{state.urgentTasks.length > 0 ? "\u8FD1\u671F\u622A\u6B62" : "\u4ECA\u65E5\u4E34\u671F"}{state.summary.overdueCount > 0 ? " \u00B7 \u542B\u8D85\u671F" : ""}</span><span className="t-caption">{allItems.length}{" \u9879"}{state.summary.overdueCount > 0 ? ` \xB7 ${state.summary.overdueCount} \u8D85\u671F` : ""}</span></div>{items.length === 0 ? <div className="t-caption empty-hint">{"\u4ECA\u5929\u6CA1\u6709\u4E34\u671F\u4EFB\u52A1 \uD83C\uDF89"}</div> : <ul className="item-list">{items.map(({ task, dueLabel, overdue, untilDueMinutes }) => <TaskRow task={task} dueLabel={dueLabel} overdue={overdue} untilDueMinutes={untilDueMinutes} onComplete={onComplete} key={task.id}></TaskRow>)}</ul>}</section>);
}
export function TaskRow({ task, dueLabel, overdue, untilDueMinutes, onComplete }: {
    task: Task;
    dueLabel: string;
    overdue: boolean;
    untilDueMinutes: number | null;
    onComplete: (taskId: string) => void;
}) {
    const meta = urgencyMeta(task.urgency);
    // 使用本次视图的倒计时；不能只按 dueAt 缓存，否则刷新后仍显示旧时间。
    const remainLabel = untilDueMinutes === null ? '' : untilDueMinutes <= 0 ? '已超期' : `还剩 ${humanDuration(untilDueMinutes)}`;
    return (<li data-task-id={task.id} className={`task-row${overdue ? " overdue" : ""} task-with-menu`}><TaskMenu task={task}></TaskMenu><button className="check" title="标记完成" aria-label={`\u5B8C\u6210\uFF1A${task.title}`} style={{ borderColor: meta.color } as (RecoveredStyle | undefined)} onClick={() => onComplete(task.id)}></button><div className="grow"><div className="row-between"><span className="t-body truncate">{task.title}</span><span className="t-caption nowrap">{dueLabel}</span></div><div className="row gap-6">{task.pinned && <span className="task-pin-badge">{"\u7F6E\u9876"}</span>}<span className="urgency-dot" style={{ background: meta.color } as (RecoveredStyle | undefined)}></span><span className="t-caption">{"\u7D27\u8FEB "}{task.urgency}{" \u00B7 "}{meta.label}</span>{remainLabel && <span className={`t-caption${overdue ? " danger" : ""}`}>{remainLabel}</span>}</div></div></li>);
}
/**
 * 悬浮窗容器：负责订阅状态、本地输入状态、窗口高度同步与涟漪动画。
 */
export function Widget({ useAppState, invoke, onReady }: {
    useAppState: () => TodayView | null;
    invoke: (channel: string, payload?: unknown) => void;
    onReady?: (height: number) => void;
}) {
    const state = useAppState();
    const [collapsed, setCollapsed] = useState(false);
    const [quickTitle, setQuickTitle] = useState('');
    const [urgency, setUrgency] = useState<Urgency>(3);
    const [domain, setDomain] = useState<'study' | 'life'>('study');
    const [rippleKey, setRippleKey] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const lastUrgentId = useRef<string | null>(null);
    const topTask = state?.todayTasks[0] ?? state?.urgentTasks[0];
    useEffect(() => {
        if (!topTask)
            return;
        if (lastUrgentId.current && lastUrgentId.current !== topTask.task.id && topTask.overdue) {
            setRippleKey(topTask.task.id);
            const timer = window.setTimeout(() => setRippleKey(null), 700);
            return () => window.clearTimeout(timer);
        }
        lastUrgentId.current = topTask.task.id;
    }, [topTask?.task.id, topTask?.overdue]);
    const sizeCallbacks = useRef({ invoke, onReady });
    sizeCallbacks.current = { invoke, onReady };
    // 只在实际内容高度变化时请求一次；输入文字和每次状态广播不应重复调整窗口。
    useEffect(() => {
        const node = rootRef.current;
        if (!node)
            return;
        let lastHeight = -1;
        const syncSize = () => {
            const height = Math.min(Math.max(Math.ceil(node.getBoundingClientRect().height), 84), 620);
            if (height === lastHeight)
                return;
            lastHeight = height;
            sizeCallbacks.current.invoke('widget:setSize', { height });
            sizeCallbacks.current.onReady?.(height);
        };
        const observer = new ResizeObserver(syncSize);
        observer.observe(node);
        syncSize();
        return () => observer.disconnect();
    }, []);
    return (<div ref={rootRef}><WidgetView state={state} collapsed={collapsed} rippleKey={rippleKey} quickTitle={quickTitle} urgency={urgency} domain={domain} onToggleCollapsed={() => setCollapsed(v => !v)} onQuickTitleChange={setQuickTitle} onUrgencyChange={setUrgency} onDomainChange={setDomain} actions={{ onQuickAdd: ({ title, urgency: u, domain: d }) => { invoke("task:quickAdd", { title, urgency: u, domain: d }); setQuickTitle(""); }, onComplete: taskId => invoke("task:complete", { id: taskId }), onHide: () => invoke("widget:hide"), onOpenMain: () => invoke("widget:openMain"), onCycleLayer: () => { const next = (state?.settings.desktopLayer ?? "top") === "top" ? "normal" : "top"; invoke("window:setLayer", { layer: next }); }, onOpenSettings: () => invoke("widget:openSettings"), onOpenExpenses: () => invoke("widget:openExpenses") }}></WidgetView></div>);
}
