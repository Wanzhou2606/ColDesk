import { useEffect, useRef, useState } from 'react';

import type { ToastUpdate, ToastView } from '@shared/view';

import { getApi } from '../lib/api';
import { ToastStackView } from './ToastView';
import { useAppState } from '../lib/useAppState';
import { useGlassAppearance } from '../lib/glassAppearance';

/**
 * 提醒弹窗入口（容器，设计文档 10.3）：
 *  - 右下角滑入，同屏最多 3 条（队列由主进程维护）
 *  - 5 秒无操作自动淡出，超期与紧迫度 5 的强提醒常驻
 *  - 可完成、可稍后、可打开主窗口
 */
const AUTO_DISMISS_MS = 5000;

export function ToastWindow() {
  useGlassAppearance(useAppState());
  const [update, setUpdate] = useState<ToastUpdate>({ items: [], queued: 0 });
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    void getApi().invoke('toast:get').then(payload=>{const next=payload as ToastUpdate;if(next)setUpdate({items:next.items??[],queued:next.queued??0});});
    const off = getApi().on('toast:update', (payload) => {
      const next = payload as ToastUpdate;
      if (next) setUpdate({ items: next.items ?? [], queued: next.queued ?? 0 });
    });
    return () => off();
  }, []);

  const act = (action: string, item: ToastView, minutes?: number) => {
    void getApi().invoke('toast:action', {
      action,
      id: item.id,
      taskId: item.taskId,
      reminderId: item.reminderId,
      minutes
    });
  };

  // 非强提醒 5 秒后自动消失；强提醒（超期、紧迫度 5）常驻等待用户处理
  useEffect(() => {
    for (const item of update.items) {
      if (item.strong || timers.current.has(item.id)) continue;
      const timer = window.setTimeout(() => {
        timers.current.delete(item.id);
        act('dismiss', item);
      }, AUTO_DISMISS_MS);
      timers.current.set(item.id, timer);
    }
    for (const [id, timer] of timers.current) {
      if (!update.items.some((i) => i.id === id)) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [update.items]);

  return (
    <ToastStackView
      update={update}
      actions={{
        onDone: (item) => act('done', item),
        onSnooze: (item, minutes) => act('snooze', item, minutes),
        onDismiss: (item) => act('dismiss', item),
        onOpen: (item) => act('open', item)
      }}
    />
  );
}
