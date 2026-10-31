import { useEffect, useRef, useState } from 'react';

/** 以可用高度适配全天；缩放时保留浏览位置，首次放大聚焦当前时间。 */
export function useScheduleScale(zoom: number, focusMinute = 720, reservedHeight = 16, enabled = true, startMinute = 0, endMinute = 1440, minimumScale = 1) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(480);
  const focus = useRef(focusMinute);
  focus.current = focusMinute;
  const pxPerHour = Math.max(minimumScale, (height - reservedHeight) / ((endMinute - startMinute) / 60)) * zoom;
  const previous = useRef({ scale: pxPerHour, zoom: 1, height, startMinute });
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => setHeight(node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const last = previous.current;
    const centerMinute = last.zoom === 1 ? focus.current : (node.scrollTop + last.height / 2) / last.scale * 60 + last.startMinute;
    node.scrollTop = zoom === 1 ? 0 : Math.max(0, (Math.max(startMinute, Math.min(endMinute, centerMinute)) - startMinute) / 60 * pxPerHour - height / 2);
    previous.current = { scale: pxPerHour, zoom, height, startMinute };
  }, [pxPerHour, zoom, height, startMinute, endMinute]);
  return { viewportRef, pxPerHour };
}
