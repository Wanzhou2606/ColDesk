import {IslandDeadlines} from '../components/IslandDeadlines';
import {t} from '@shared/i18n';
import * as React from 'react';
import { AppLogo } from '../components/AppLogo';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TodayView, ToastUpdate, ToastView } from '@shared/view';
import { getApi } from '../lib/api';
import { useWidgetDrag } from '../lib/useWidgetDrag';
import { TaskMenu } from '../components/TaskMenu';
import { findViewTask,nearbyDeadlineTasks } from '@shared/taskActions';
export function IslandWidget({ state }: {
    state: TodayView | null;
}) {
    const [hovered, setHovered] = useState(false), [pop, setPop] = useState(false), [notices, setNotices] = useState<ToastView[]>([]);
    const [noticeId, setNoticeId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const shell = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), frozen = useRef(false);
    const drag = useWidgetDrag(() => { frozen.current = hovered || pop; });
    const leaveTimer = useRef<number | null>(null), enterTimer = useRef<number | null>(null);
    const lastId = useRef<string | null>(null), popTimer = useRef<number | null>(null);
    const expanded = drag.dragging ? frozen.current : hovered || pop;
    const notice = notices.find(item => item.id === noticeId) ?? notices[notices.length - 1];
    useEffect(() => {
        if (content.current)
            content.current.inert = !expanded;
    }, [expanded]);
    useEffect(() => {
        let alive = true;
        const receive = (payload: unknown) => {
            if (!alive || !payload)
                return;
            const next = (payload as ToastUpdate).items ?? [];
            setNotices(next);
            const latest = next[next.length - 1];
            if (latest && latest.id !== lastId.current) {
                lastId.current = latest.id;
                setNoticeId(latest.id);
                setPop(true);
                setError('');
                if (popTimer.current)
                    window.clearTimeout(popTimer.current);
                popTimer.current = window.setTimeout(() => setPop(false), 8000);
            }
            else if (!next.length) {
                lastId.current = null;
                setPop(false);
                setNoticeId(null);
            }
        };
        const off = getApi().on('island:update', receive);
        void getApi().invoke('toast:get').then(receive).catch(() => undefined);
        return () => {
            alive = false;
            off();
            if (popTimer.current)
                window.clearTimeout(popTimer.current);
        };
    }, []);
    useEffect(() => {
        if (!notice || notice.strong || hovered || drag.dragging)
            return;
        const timer = window.setTimeout(() => void getApi().invoke('toast:action', { action: 'dismiss', id: notice.id }).catch(() => undefined), 8000);
        return () => window.clearTimeout(timer);
    }, [notice?.id, notice?.strong, hovered, drag.dragging]);
    useEffect(() => () => {
        if (leaveTimer.current)
            window.clearTimeout(leaveTimer.current);
        if (enterTimer.current)
            window.clearTimeout(enterTimer.current);
    }, []);
    useLayoutEffect(() => {
        const node = shell.current;
        if (!node)
            return;
        let frame = 0, last = '';
        const resize = () => {
            if (frame)
                return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                const b = node.getBoundingClientRect(), width = Math.ceil(b.width) + 16, height = Math.ceil(b.height) + 16, key = width + ':' + height;
                if (key === last)
                    return;
                last = key;
                void getApi().invoke('widget:setSize', { width, height }).catch(() => undefined);
            });
        };
        const observer = new ResizeObserver(resize);
        observer.observe(node);
        resize();
        return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
    }, []);
    const enter = () => {
        if (leaveTimer.current)
            window.clearTimeout(leaveTimer.current);
        if (enterTimer.current)
            window.clearTimeout(enterTimer.current);
        enterTimer.current = window.setTimeout(() => setHovered(true), 120);
    };
    const leave = () => {
        if (enterTimer.current)
            window.clearTimeout(enterTimer.current);
        if (leaveTimer.current)
            window.clearTimeout(leaveTimer.current);
        leaveTimer.current = window.setTimeout(() => setHovered(false), 220);
    };
    useEffect(() => getApi().on('widget:hover', payload => {
        if ((payload as {
            inside?: boolean;
        })?.inside)
            enter();
        else
            leave();
    }), []);
    const act = async (action: string, item: ToastView) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await getApi().invoke('toast:action', { action: action === 'complete' ? 'done' : action, id: item.id, taskId: item.taskId, reminderId: item.reminderId, minutes: 10 });
        }
        catch {
            setError('暂时未能处理，请重试。');
        }
        finally {
            setBusy(false);
        }
    };
    const deadlines=nearbyDeadlineTasks(state),deadlineCount=deadlines.today.length+deadlines.tomorrow.length,firstDeadline=deadlines.today[0]??deadlines.tomorrow[0];
    const upcoming = (state?.timeline ?? []).filter(block => !state?.now || block.endAt > state.now);
    return <div className="island-root"><div ref={shell} className={`island-shell${expanded ? " is-expanded" : ""}${expanded && notice ? " shows-notice" : ""}${notices.length ? " has-notice" : ""}${drag.dragging ? " is-dragging" : ""}`} onPointerEnter={enter} onPointerLeave={leave} onFocusCapture={() => setHovered(true)} onBlurCapture={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
                leave();
        }}>
    <div className="island-mini island-drag" {...drag.handlers} title="悬停查看日程，拖动可移动位置">
      <img src="./app-icon.png" alt="ColDesk" draggable={false}/><div><strong>{!expanded?(notice?.title??firstDeadline?.task.title??"ColDesk"):"ColDesk"}</strong><span>{notice ? "\u6709 " + notices.length + " \u6761\u63D0\u9192" : deadlineCount?t('今天 {0} 项截止 · 明天 {1} 项截止',[deadlines.today.length,deadlines.tomorrow.length]):state?.dateLabel ?? t('轻轻停留，看看今天')}</span></div><i className={notice?.strong||(!notice&&deadlines.today.length) ? "urgent" : ""}>{notices.length ? notices.length : deadlineCount || (state?.now.slice(11, 16) ?? "\u2014")}</i>
    </div>
    <div ref={content} className="island-content" aria-hidden={!expanded}>
      <header className="island-drag" {...drag.handlers}><div><span>{notice ? "ColDesk \u63D0\u9192" : "\u4ECA\u5929\u7684\u65E5\u7A0B"}</span><strong>{state?.dateLabel}</strong></div><button className="no-drag" aria-label="打开主窗口" onClick={() => void getApi().invoke("widget:openMain")}>↗</button><button className="no-drag" aria-label="打开设置" onClick={() => void getApi().invoke("widget:openSettings")}>⚙</button></header>
      {notice ? <section key={notice.id} className={`island-notice${pop ? " arrived" : ""}`}><div className="island-notice-heading"><img src="./app-icon.png" alt=""/><div><span>{notice.strong ? "\u9700\u8981\u4F60\u5173\u6CE8" : "\u65E5\u5E38\u63D0\u9192"} · {notice.timeLabel}</span><h2>{notice.title}</h2></div></div><p>{notice.body || "\u7ED9\u8FD9\u4EF6\u91CD\u8981\u7684\u4E8B\uFF0C\u7559\u4E00\u70B9\u65F6\u95F4\u3002"}</p><div className="island-notice-actions">{notice.taskId && <button disabled={busy} onClick={() => void act("complete", notice)}>完成</button>}{notice.kind!=="event"&&<button disabled={busy} onClick={() => void act("snooze", notice)}>10 分钟后</button>}<button disabled={busy} onClick={() => void act("dismiss", notice)}>关闭</button></div>{notices.length > 1 && <div className="island-notice-pages">{notices.map((item, index) => <button key={item.id} aria-label={`查看第 ${index + 1} 条提醒`} aria-pressed={item.id === notice.id} onClick={() => setNoticeId(item.id)}>{index + 1}</button>)}</div>}{error && <p role="alert">{error}</p>}</section> : <><div className="island-overview"><IslandDeadlines groups={deadlines}/><h3 className="island-agenda-heading">接下来的日程</h3><ol className="island-agenda">{upcoming.length ? upcoming.map(block => <li data-task-id={block.taskId} key={block.id}><div className="island-time">{block.startAt.slice(11, 16)}<span>{block.eventId&&block.startAt===block.endAt?"提醒":block.endAt.slice(11, 16)}</span></div><div><strong>{block.title}</strong><span>{block.location || (block.locked ? "\u7531\u4F60\u5B89\u6392" : block.kind === "lesson" ? "\u8BFE\u7A0B" : "\u65E5\u7A0B")}</span></div><TaskMenu task={findViewTask(state, block.taskId)}/></li>) : <li className="island-empty">今天接下来没有安排，留一点时间给自己。</li>}</ol></div><footer><span>{t('今天 {0} · 明天 {1}',[deadlines.today.length,deadlines.tomorrow.length])}</span><button onClick={() => void getApi().invoke("widget:openMain")}>查看全部日程 →</button></footer></>}
    </div>
  </div></div>;
}
