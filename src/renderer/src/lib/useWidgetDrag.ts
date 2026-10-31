import { useEffect, useRef, useState } from 'react';
import { getApi } from './api';

/** 移动由系统拖动区域处理；只订阅开始/结束，避免逐帧 IPC 和坐标轮询。 */
export function useWidgetDrag(onStart?: () => void) {
  const [dragging, setDragging] = useState(false);
  const start = useRef(onStart);
  start.current = onStart;
  useEffect(() => {
    const api = getApi();
    const offStart = api.on('widget:dragStarted', () => { start.current?.(); setDragging(true); });
    const offEnd = api.on('widget:dragEnded', () => setDragging(false));
    return () => { offStart(); offEnd(); };
  }, []);
  return { dragging, handlers: {} };
}
