import * as React from 'react';
import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {Task} from '@shared/types';
import type {TodayView} from '@shared/view';
import {findViewTask} from '@shared/taskActions';
import {urgencyMeta} from '@shared/scoring';
import {t} from '@shared/i18n';
import {getApi} from '../lib/api';
import {useExpandingCard} from '../lib/useExpandingCard';

interface Selection {id: string; element: HTMLElement; point: {x: number; y: number}}
interface CardHandle {dismiss(): void}
const BLOCKING = 'dialog[open],.task-action-menu,.course-detail-card:not(.task-hover-card),.task-edit-dialog';

/** One hover controller per window, shared by task lists, schedule blocks and deadline cards. */
export function TaskHoverPreview({state, enabled = true}: {state: TodayView | null; enabled?: boolean}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const stateRef = useRef(state), selected = useRef(selection), card = useRef<CardHandle>(null);
  const resume = useRef<(closed: HTMLElement) => void>(() => {});
  stateRef.current = state; selected.current = selection;
  useEffect(() => {if (selection && !findViewTask(state, selection.id)) setSelection(null);}, [state, selection]);
  useEffect(() => {
    if (!enabled) {setSelection(null); return;}
    let timer: number | undefined, leaveTimer: number | undefined, alive = true, dragging = false;
    let candidate: HTMLElement | null = null, blocked: HTMLElement | null = null;
    let point = {x: 0, y: 0}, delay = 400;
    // Native title bubbles would otherwise appear over the expanded card.
    const savedTitles = new Map<HTMLElement, string>();
    const restoreTitles = () => {for (const [node, title] of savedTitles) if (!node.hasAttribute('title')) node.setAttribute('title', title); savedTitles.clear();};
    const cancel = () => {window.clearTimeout(timer); timer = undefined;};
    const clearLeave = () => {window.clearTimeout(leaveTimer); leaveTimer = undefined;};
    const close = () => {clearLeave(); card.current?.dismiss();};
    const readPreference = () => {void getApi().invoke('app:interaction').then(value => {
      const time = (value as {hoverTime?: number} | null)?.hoverTime;
      if (alive && Number.isInteger(time) && time! > 0 && time! <= 60000) delay = time!;
    }).catch(() => undefined);};
    readPreference();
    const eligible = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element) || target.closest('[inert],.task-hover-card')) return null;
      const node = target.closest<HTMLElement>('[data-task-id]');
      if (!node || !findViewTask(stateRef.current, node.dataset.taskId)) return null;
      // A title may be a button; completion controls and menus keep their own interactions.
      const control = target.closest('button,a,input,select,textarea,[role="menu"]');
      return control && control !== node && !control.matches('.task-title-link,.island-deadline-open') ? null : node;
    };
    const holdTitles = (target: Element, node: HTMLElement) => {
      for (let current: Element | null = target; current && node.contains(current); current = current.parentElement) {
        if (current instanceof HTMLElement && current.hasAttribute('title')) {
          savedTitles.set(current, current.getAttribute('title')!); current.removeAttribute('title');
        }
        if (current === node) break;
      }
    };
    const arm = () => {
      cancel();
      if (!candidate || candidate === blocked || dragging || selected.current || document.querySelector(BLOCKING)) return;
      const element = candidate;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!alive || dragging || candidate !== element || !element.isConnected || document.hidden || document.querySelector(BLOCKING)) return;
        const task = findViewTask(stateRef.current, element.dataset.taskId);
        if (task) setSelection({id: task.id, element, point: {...point}});
      }, delay);
    };
    resume.current = closed => {if (candidate === closed) blocked = closed; arm();};
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || dragging) {cancel(); return;}
      const panel = document.querySelector('.task-hover-card');
      if (panel?.contains(event.target as Node)) {clearLeave(); return;}
      const next = eligible(event.target);
      if (selected.current) {
        if (next === selected.current.element) clearLeave();
        else if (leaveTimer === undefined) leaveTimer = window.setTimeout(() => {leaveTimer = undefined; close();}, 160);
      }
      if (next !== candidate) {
        cancel(); restoreTitles(); candidate = next; blocked = null; point = {x: event.clientX, y: event.clientY};
        if (next) {holdTitles(event.target as Element, next); arm();}
      } else if (next && !selected.current && (Math.abs(event.clientX - point.x) > 4 || Math.abs(event.clientY - point.y) > 4)) {
        point = {x: event.clientX, y: event.clientY}; arm();
      }
    };
    const press = (event: Event) => {
      if (document.querySelector('.task-hover-card')?.contains(event.target as Node)) return;
      cancel(); blocked = candidate; close();
    };
    const leave = () => {cancel(); candidate = null; blocked = null; restoreTitles(); close();};
    const dragStart = (event: Event) => {dragging = true; press(event);};
    const dragEnd = () => {dragging = false; cancel(); blocked = candidate;};
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape' || event.key === 'Tab') {cancel(); blocked = candidate; close();}};
    const scroll = (event: Event) => {if (!document.querySelector('.task-hover-card')?.contains(event.target as Node)) leave();};
    const visibility = () => {if (document.hidden) leave();};
    document.addEventListener('pointerover', move); document.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    document.addEventListener('pointerdown', press, true); document.addEventListener('keydown', key);
    document.addEventListener('dragstart', dragStart, true); document.addEventListener('dragend', dragEnd, true);
    window.addEventListener('blur', leave); window.addEventListener('focus', readPreference);
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', leave);
    document.addEventListener('visibilitychange', visibility);
    const observer = new MutationObserver(() => {
      if (selected.current && (!selected.current.element.isConnected || !findViewTask(stateRef.current, selected.current.id))) close();
      if (document.querySelector(BLOCKING)) {cancel(); close();}
    });
    observer.observe(document.body, {childList: true, subtree: true});
    return () => {
      alive = false; cancel(); clearLeave(); restoreTitles(); observer.disconnect(); resume.current = () => {};
      document.removeEventListener('pointerover', move); document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointerdown', press, true); document.removeEventListener('keydown', key);
      document.removeEventListener('dragstart', dragStart, true); document.removeEventListener('dragend', dragEnd, true);
      window.removeEventListener('blur', leave); window.removeEventListener('focus', readPreference);
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', leave);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled]);
  const task = findViewTask(state, selection?.id);
  return selection && task && enabled ? <HoverCard ref={card} task={task} selection={selection} onClose={() => {selected.current = null; setSelection(null); resume.current(selection.element);}} key={selection.id}/> : null;
}

const HoverCard = forwardRef<CardHandle, {task: Task; selection: Selection; onClose: () => void}>(function HoverCard({task, selection, onClose}, ref) {
  const origin = selection.element.getBoundingClientRect();
  const characters = Math.max(6, Math.floor((origin.width - 56) / 13));
  const titleLines = Math.min(3, Math.ceil(task.title.length / characters));
  const detailLines = Math.min(4, (task.detail?.trim() || '').split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / characters)), 0));
  const height = Math.max(180, origin.height + 76, 120 + titleLines * 20 + detailLines * 21 + (origin.width < 260 ? 22 : 0));
  const {panel, closeButton, style, exiting, dismiss} = useExpandingCard(selection.element, onClose, urgencyMeta(task.urgency).color, origin.width,
    height, {focus: false, verticalOnly: true});
  useImperativeHandle(ref, () => ({dismiss}));
  const edit = () => {dismiss(); void getApi().invoke('task:openEditor', {id: task.id, field: 'all'});};
  return createPortal(<div ref={panel} className={`course-detail-card task-detail-card task-hover-card${exiting ? ' is-closing' : ''}`} style={style} role="dialog" aria-modal="false" aria-labelledby="task-hover-title" data-preview-task={task.id}>
    <div className="course-detail-accent"/><div className="course-detail-content">
      <header><div><span>任务详情</span><h2 id="task-hover-title">{task.title}</h2></div><button ref={closeButton} type="button" aria-label="收起任务详情" onClick={dismiss}>×</button></header>
      <div className="task-hover-deadline"><span>截止时间</span><strong>{task.dueAt ? task.dueAt.replace('T', ' ') : t('无截止时间')}</strong></div>
      <section className="task-detail-body"><h3>详细内容</h3>{task.detail?.trim() ? <p>{task.detail}</p> : <p className="task-detail-empty">还没有填写详细内容</p>}</section>
      <footer className="task-hover-actions"><span>移开鼠标收起 · Esc 关闭</span><button type="button" onClick={edit}>编辑任务</button></footer>
    </div>
  </div>, document.body);
});
