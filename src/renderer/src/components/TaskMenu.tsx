import * as React from 'react';
import {ControlIcon} from './ControlIcon';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '@shared/types';
import type { TaskEditField } from '@shared/taskActions';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
const useMenuLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export function TaskMenu({ task, disabled = false,scheduledDate }: {
    task?: Task;
    disabled?: boolean;
    scheduledDate?:string;
}) {
    const [open, setOpen] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
    const close = () => { setOpen(false); setConfirmDelete(false); setError(''); trigger.current?.focus(); };
    useMenuLayoutEffect(() => {
        if (!open || !trigger.current || !menu.current)
            return;
        const anchor = trigger.current.getBoundingClientRect(), box = menu.current.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(anchor.bottom + 5, window.innerHeight - box.height - 8)) });
    }, [open, confirmDelete, error]);
    useEffect(() => {
        if (!open)
            return;
        menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const pointer = (event: PointerEvent) => {
            if (!busy && !menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
                close();
        };
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (!busy)
                    close();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
                if (!buttons.length)
                    return;
                event.preventDefault();
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
            if (event.key === 'Tab' && !busy)
                close();
        };
        const scroll = (event: Event) => {
            if (!busy && !menu.current?.contains(event.target as Node))
                close();
        };
        document.addEventListener('pointerdown', pointer);
        document.addEventListener('keydown', key);
        window.addEventListener('resize', scroll);
        window.addEventListener('scroll', scroll, true);
        return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); window.removeEventListener('resize', scroll); window.removeEventListener('scroll', scroll, true); };
    }, [open, busy, confirmDelete]);
    if (!task)
        return null;
    const perform = async (channel: string, payload: unknown) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await getApi().invoke(channel, payload);
            close();
        }
        catch (err) {
            setError(userError(err, '暂时无法修改任务，请重试。'));
        }
        finally {
            setBusy(false);
        }
    };
    const edit = (field: TaskEditField) => void perform('task:openEditor', { id: task.id, field });
    return <span className="task-menu-anchor" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}><button ref={trigger} className="task-menu-trigger no-drag" type="button" draggable={false} disabled={disabled || busy} aria-label={`\u4EFB\u52A1\u64CD\u4F5C\uFF1A${task.title}`} title="任务操作" aria-haspopup="menu" aria-expanded={open} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }} onClick={() => { setError(""); setConfirmDelete(false); setOpen(value => !value); }}><ControlIcon name="more"/></button>{open && typeof document !== "undefined" && createPortal(<div ref={menu} className="task-action-menu no-drag" role="menu" aria-label={`${task.title} \u7684\u64CD\u4F5C`} style={{ left: position.left, top: position.top } as (RecoveredStyle | undefined)} onClick={event => event.stopPropagation()}>{confirmDelete ? <><p className="task-delete-question">{"\u5220\u9664\u300C"}{task.title}{"\u300D\uFF1F"}<small>{"\u76F8\u5173\u65E5\u7A0B\u548C\u63D0\u9192\u4E5F\u4F1A\u79FB\u9664\u3002"}</small></p><button role="menuitem" className="danger" disabled={busy} onClick={() => void perform("task:delete", { id: task.id })}>{busy ? "\u6B63\u5728\u5220\u9664\u2026" : "\u786E\u8BA4\u5220\u9664"}</button><button role="menuitem" disabled={busy} onClick={() => setConfirmDelete(false)}>{"\u53D6\u6D88"}</button></> : <>{scheduledDate&&task.status!=='done'&&task.status!=='canceled'&&<button role="menuitem" disabled={busy} onClick={()=>void perform("schedule:notToday",{taskId:task.id,date:scheduledDate})}>不在今日 · 收回任务栏</button>}<button role="menuitem" disabled={busy} onClick={() => void perform("task:pin", { id: task.id, pinned: !task.pinned })}>{task.pinned ? "\u53D6\u6D88\u7F6E\u9876" : "\u7F6E\u9876\u4EFB\u52A1"}</button><button role="menuitem" disabled={busy} onClick={() => edit("urgency")}>{"\u4FEE\u6539\u7D27\u8FEB\u7A0B\u5EA6"}</button><button role="menuitem" disabled={busy} onClick={() => edit("due")}>{"\u4FEE\u6539\u622A\u6B62\u65F6\u95F4"}</button><button role="menuitem" disabled={busy} onClick={() => edit("name")}>{"\u7F16\u8F91\u540D\u79F0"}</button>{task.status!=='done'&&task.status!=='canceled'&&<button role="menuitem" disabled={busy} onClick={() => edit("schedule")}>调整分段安排</button>}<button role="menuitem" disabled={busy} onClick={() => edit("all")}>{"\u7F16\u8F91\u4EFB\u52A1\u2026"}</button><button role="menuitem" className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>{"\u5220\u9664\u4EFB\u52A1"}</button></>}{error && <p className="task-menu-error" role="alert">{error}</p>}</div>, document.body)}</span>;
}
