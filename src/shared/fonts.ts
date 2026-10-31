export const UI_FONT_OPTIONS = [
  { value: 'system', label: '默认 · 系统字体' },
  { value: 'Microsoft YaHei', label: '微软雅黑 · 清晰' },
  { value: 'SimSun', label: '宋体 · 书卷' },
  { value: 'KaiTi', label: '楷体 · 手写' },
  { value: 'SimHei', label: '黑体 · 简洁' },
  { value: 'YouYuan', label: '幼圆 · 柔和' },
  { value: 'STXihei', label: '华文细黑 · 轻盈' }
];
export const COVER_FONT_OPTIONS = [
  { value: 'STXingkai', label: '华文行楷 · 默认' },
  { value: 'KaiTi', label: '楷体 · 工整' },
  { value: 'STKaiti', label: '华文楷体 · 温柔' },
  { value: 'LiSu', label: '隶书 · 古朴' },
  { value: 'STXinwei', label: '华文新魏 · 随性' },
  { value: 'YouYuan', label: '幼圆 · 圆润' },
  { value: 'SimSun', label: '宋体 · 文艺' }
];
const UI_FALLBACK = "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif";
const COVER_FALLBACK = "'STXingkai', '华文行楷', 'KaiTi', '楷体', cursive";
/** 只保存单个字体名称，避免把任意 CSS 写入全局样式。 */
export function validFontName(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N} ._-]{1,80}$/u.test(value) && !!value.trim();
}
export function normalizeFontName(value: unknown, fallback: string): string {
  return validFontName(value) ? value.trim() : fallback;
}
export function uiFontFamily(value?: string): string {
  const name = normalizeFontName(value, 'system');
  return name === 'system' ? UI_FALLBACK : `'${name}', ${UI_FALLBACK}`;
}
export function coverFontFamily(value?: string): string {
  return `'${normalizeFontName(value, 'STXingkai')}', ${COVER_FALLBACK}`;
}
