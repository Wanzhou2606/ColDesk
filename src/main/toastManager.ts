/**
 * 提醒弹窗池（设计文档 10.3）：
 *  - 同屏最多 3 条，其余排队
 *  - 去重由 notify_log 保证，这里只负责展示与交互
 */

import type { Urgency } from '@shared/types';
import { addMinutes, nowLocal } from '@shared/time';
import {t} from '@shared/i18n';

import { createToastWindow, createWidgetWindow, getWindow, applyWidgetLayer } from './windows';
import { store } from './store';

export type ToastKind = 'reminder' | 'event' | 'class' | 'daily_digest' | 'overdue' | 'missed' | 'startup';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  urgency?: Urgency;
  timeLabel: string;
  /** 常驻不自动消失（超期/强提醒） */
  strong: boolean;
  taskId?: string;
  reminderId?: string;
  examId?: string;
  eventId?: string;
}

const MAX_VISIBLE = 3;
let queue: ToastItem[] = [];

function timeLabel(): string {
  return nowLocal().slice(11, 16);
}

export function pushToast(input: Omit<ToastItem, 'id' | 'timeLabel' | 'strong'> & { strong?: boolean }): ToastItem {
  const item: ToastItem = {
    ...input,
    id: `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    timeLabel: timeLabel(),
    strong: input.strong ?? input.urgency === 5
  };
  if(item.kind==='startup')queue.unshift(item);else queue.push(item);
  render();
  return item;
}

export function getVisible(): ToastItem[] {
  return queue.slice(0, MAX_VISIBLE);
}

export function getQueued(): number {
  return Math.max(0, queue.length - getVisible().length);
}

/** 退出全屏/免打扰后合并补弹（设计文档 10.4） */
export function pushMissedDigest(count: number): void {
  pushToast({
    kind: 'missed',
    title: t('你错过了 {0} 条提醒',[count]),
    body: t('已合并为一条，点击查看今天的安排'),
    urgency: 3,
    strong: true
  });
}

export function dismissToast(id: string): void {
  const before = queue.length;
  queue = queue.filter((t) => t.id !== id);
  render();
  if (queue.length === 0 && before > 0) collapse();
}

export function snoozeToast(id: string, minutes: number, onSnooze?: (fireAt: string) => void): void {
  const fireAt = addMinutes(nowLocal(), minutes);
  onSnooze?.(fireAt);
  dismissToast(id);
}

export function clearToasts(): void {
  queue = [];
  render();
  if(!queue.length)collapse();
}
export function clearTaskToasts(taskId: string): void {
  queue = queue.filter(item => item.taskId !== taskId);
  render();
}
export function clearEventToasts(eventId:string):void{
  queue=queue.filter(item=>item.eventId!==eventId);
  render();
}
export function clearClassToasts():void{
  queue=queue.filter(item=>item.kind!=='class');
  render();
}

function collapse(): void {
  const win = getWindow('toast');
  if (win && !win.isDestroyed()) win.hide();
}

function render(): void {
  const visible = getVisible();
  if(store.getSettings().desktopMode==='island'&&!visible.some(t=>t.kind==='startup')){
    const popup=getWindow('toast');popup?.webContents.send('toast:update',{items:[],queued:0});popup?.hide();
    const island=createWidgetWindow();
    island.webContents.send('island:update',getIslandToasts());
    if(queue.length){island.setAlwaysOnTop(true,'screen-saver');if(!island.isVisible())island.showInactive();}
    else applyWidgetLayer(store.getSettings().desktopLayer);
    return;
  }
  getWindow('widget')?.webContents.send('island:update',{items:[],queued:0});
  const win = createToastWindow();
  if (visible.length === 0) {
    win.webContents.send('toast:update', { items: [], queued: 0 });
    collapse();
    return;
  }
  if (!win.isVisible()) {
    win.showInactive();
  }
  win.webContents.send('toast:update', { items: visible, queued: getQueued() });
}

export function getQueueSize(): number {
  return queue.length;
}
export function getIslandToasts(){return {items:[...queue],queued:0};}
export function syncReminderPresentation(){render();}
