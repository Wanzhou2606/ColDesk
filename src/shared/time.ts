/**
 * 时间工具：全部基于本地时间的字符串运算，不依赖时区。
 * 约定见 types.ts 顶部注释。
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` */
export function fmtLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** `YYYY-MM-DD` */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowLocal(now: Date = new Date()): string {
  return fmtLocal(now);
}

export function today(now: Date = new Date()): string {
  return fmtDate(now);
}

/** `YYYY-MM-DDTHH:mm` → Date（按本地时间解析） */
export function parseLocal(s: string): Date {
  const [datePart, timePart = '00:00'] = s.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

/** `HH:mm` → 从零点起的分钟数 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 从零点起的分钟数 → `HH:mm` */
export function minutesToHhmm(minutes: number): string {
  const clamped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** 本地日期时间字符串 → 从零点起的分钟数 */
export function localToMinutes(s: string): number {
  return hhmmToMinutes((s.split('T')[1] ?? '00:00').slice(0, 5));
}

export function dateOf(s: string): string {
  return s.split('T')[0];
}

export function addDays(date: string, days: number): string {
  const d = parseLocal(date);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

export function addMinutes(local: string, minutes: number): string {
  const d = parseLocal(local);
  d.setMinutes(d.getMinutes() + minutes);
  return fmtLocal(d);
}

/** 1=周一 … 7=周日 */
export function weekdayOf(date: string): number {
  const wd = parseLocal(date).getDay();
  return wd === 0 ? 7 : wd;
}

/** 给定日期所在周的周一 */
export function mondayOf(date: string): string {
  return addDays(date, -(weekdayOf(date) - 1));
}

export function daysBetween(fromDate: string, toDate: string): number {
  const a = parseLocal(fromDate).getTime();
  const b = parseLocal(toDate).getTime();
  return Math.round((b - a) / 86400000);
}

/** 相差分钟数（to - from），可为负 */
export function minutesBetween(from: string, to: string): number {
  return Math.round((parseLocal(to).getTime() - parseLocal(from).getTime()) / 60000);
}

/**
 * 教学周：第 1 教学周的周一为第 1 周。
 * 开学前返回 <=0，学期结束后返回 > totalWeeks。
 */
export function weekOf(date: string, semesterStartDate: string): number {
  return Math.floor(daysBetween(mondayOf(semesterStartDate), mondayOf(date)) / 7) + 1;
}

/** 把周次表达式展开成周次集合，如 "1,2,3,5,8-12" */
export function parseWeekList(expr?: string): number[] {
  if (!expr) return [];
  const out = new Set<number>();
  for (const raw of expr.split(/[,，、\s]+/)) {
    if (!raw) continue;
    const range = raw.match(/^(\d+)\s*[-~至]\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) out.add(i);
    } else {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 人类可读的时长。
 * 三档：不足 1 小时给分钟；不足 1 天给小时；1 天以上给"天 + 小时"。
 * 悬浮窗与提醒文案都依赖它，所以"72 小时"这类表达要收敛成"3 天"。
 */
export function humanDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;

  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分钟`;
  }

  const days = Math.floor(m / 1440);
  const restHours = Math.floor((m % 1440) / 60);
  return restHours === 0 ? `${days} 天` : `${days} 天 ${restHours} 小时`;
}

const WEEKDAY_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function weekdayCn(date: string): string {
  return WEEKDAY_CN[weekdayOf(date)] ?? '';
}

/** 相对日期描述：今天 / 明天 / 昨天 / 周五 / 10月8日 */
export function relativeDay(date: string, nowDate: string): string {
  const diff = daysBetween(nowDate, date);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  if (diff > 0 && diff < 7) return weekdayCn(date);
  const d = parseLocal(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 整点标签，如 8 → "08:00" */
export function hoursLabel(hour: number): string {
  return `${pad(hour)}:00`;
}
