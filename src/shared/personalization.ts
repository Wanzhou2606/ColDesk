export const THEME_OPTIONS = [
  { id: 'default', name: '默认', color: '#edf1f5', accent: '#527ad7' },
  { id: 'blue', name: '浅蓝', color: '#e8f4fc', accent: '#558cac' },
  { id: 'mint', name: '浅绿', color: '#edf7f0', accent: '#588c74' },
  { id: 'lavender', name: '淡紫', color: '#f2edfa', accent: '#8776aa' },
  { id: 'rose', name: '粉色', color: '#fcf0f3', accent: '#ad798d' }
  ,{ id: 'garden', name: '雾青', color: '#eef4f5', accent: '#547b70' }
] as const;
export type ThemeId = typeof THEME_OPTIONS[number]['id'];
export function isThemeId(value: unknown): value is ThemeId { return THEME_OPTIONS.some(theme => theme.id === value); }
export interface ScheduleWindow { startMinute: number; endMinute: number; startLabel: string; endLabel: string }
export function scheduleClock(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
function clockMinute(value: unknown, end: boolean) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && !(end && value === '24:00')) return null;
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
}
export function validateScheduleWindow(start: unknown, end: unknown): ScheduleWindow {
  const startMinute = clockMinute(start, false), endMinute = clockMinute(end, true);
  if (startMinute === null || endMinute === null) throw new Error('时间请填写为 HH:mm，例如 06:00 和 24:00');
  if (endMinute <= startMinute) throw new Error('结束时间需晚于开始时间，请选择同一天内的范围');
  return { startMinute, endMinute, startLabel: start as string, endLabel: end as string };
}
export function scheduleWindow(settings?: { scheduleStart?: string; scheduleEnd?: string }): ScheduleWindow {
  try { return validateScheduleWindow(settings?.scheduleStart ?? '06:00', settings?.scheduleEnd ?? '24:00'); }
  catch { return validateScheduleWindow('06:00', '24:00'); }
}
export function scheduleHours(range: ScheduleWindow): number[] {
  const ticks = [range.startMinute];
  for (let minute = (Math.floor(range.startMinute / 60) + 1) * 60; minute < range.endMinute; minute += 60) ticks.push(minute);
  ticks.push(range.endMinute); return ticks.map(minute => minute / 60);
}
/** 保留准确的起止刻度，略去离边界过近的整点标签。 */
export function scheduleLabelHours(range: ScheduleWindow, pxPerHour: number): number[] {
  const result: number[] = [], start = range.startMinute / 60, end = range.endMinute / 60;
  for (const hour of scheduleHours(range)) {
    if (hour === start || hour === end) { result.push(hour); continue; }
    if (pxPerHour < 28 && hour % 2 !== 0) continue;
    if ((hour - result[result.length - 1]) * pxPerHour >= 14 && (end - hour) * pxPerHour >= 14) result.push(hour);
  }
  return result;
}
