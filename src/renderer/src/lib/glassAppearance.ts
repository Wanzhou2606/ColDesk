import { useEffect } from 'react';

import type { TodayView } from '@shared/view';
import { uiFontFamily, coverFontFamily } from '@shared/fonts';

/**
 * 把设置里的玻璃外观参数作用到 `:root` 的 CSS 变量上。
 *
 * 为什么抽成公用：这套变量原先只写在悬浮窗里，于是出现了一个不一致——
 * 拖动"沉浸光感"的滑块时只有悬浮窗变化，主窗口的卡片还是默认值，
 * 同一个设置却有两种表现。现在两个窗口都用这一个实现。
 *
 * 为什么要在 JS 里算而不是让 CSS 自己算：
 * "不透明度"要派生出描边强度、按钮底色等一系列中间色，
 * CSS 的自定义属性做不了"颜色与透明度混合"这类运算（`color-mix` 兼容性还不够稳），
 * 所以把派生值算在这里，CSS 只负责消费。
 */
export function applyGlassAppearance(
  alpha: number,
  options: { dark?: boolean } = {}
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const dark =
    options.dark ??
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
  const rgb = dark ? '28, 30, 36' : '255, 255, 255';
  const clamped = Math.min(Math.max(alpha, 0.2), 1);

  root.style.setProperty('--glass-tint-alpha', clamped.toFixed(2));
  root.style.setProperty('--glass-tint', `rgba(${rgb}, ${clamped.toFixed(2)})`);
  root.style.setProperty('--glass-tint-strong', `rgba(${rgb}, ${Math.min(1, clamped + 0.12).toFixed(2)})`);
  root.style.setProperty('--glass-tint-soft', `rgba(${rgb}, ${Math.max(0, clamped - 0.16).toFixed(2)})`);

}

/** 订阅状态并把玻璃外观同步到 CSS 变量（悬浮窗与主窗口共用） */
export function useGlassAppearance(state: TodayView | null): void {
  const alpha = state?.ui?.glassTintAlpha ?? 0.62;
  const highContrast = state?.settings.highContrast ?? false;
  const uiFont = state?.settings.uiFont;
  const homeCoverFont = state?.settings.homeCoverFont;

  useEffect(() => {
    applyGlassAppearance(alpha);
    if (highContrast) document.documentElement.dataset.contrast = 'high';
    else delete document.documentElement.dataset.contrast;
  }, [alpha, highContrast]);
  useEffect(() => {
    document.documentElement.style.setProperty('--font-ui', uiFontFamily(uiFont));
    document.documentElement.style.setProperty('--font-home-cover', coverFontFamily(homeCoverFont));
  }, [uiFont, homeCoverFont]);
}
