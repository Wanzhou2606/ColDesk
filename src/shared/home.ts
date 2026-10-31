export interface HomeEntry {
  date: string;
  cover: string;
  body: string;
  weather: string;
  mood: string;
  title?: string;
  attachments?: HomeAttachment[];
  updatedAt?: string;
}
export interface HomeStatus { initialized: boolean; passwordEnabled: boolean; unlocked: boolean }
export interface HomeAttachment { id: string; name: string; kind: 'photo' | 'file'; size: number }
export interface HomeAsset extends HomeAttachment { date: string; data: string; image?: { data: string; width: number; height: number } }
export interface HomeMonth { month: string; entries: Array<Pick<HomeEntry, 'date' | 'cover' | 'weather' | 'mood' | 'title' | 'attachments'>> }
export type HomeExportScope = { scope: 'all' } | { scope: 'month'; month: string } | { scope: 'day'; date: string } | { scope: 'range'; start: string; end: string };
export type HomeExportOptions = HomeExportScope & { mode?: 'overview' | 'diary'; format?: 'txt' | 'word' };
export interface HomeExportResult { canceled: boolean; count: number; folder?: string; format?: 'txt' | 'word'; mode?: 'overview' | 'diary' }
export function homeEntryTxt(entry: HomeEntry): string {
  const lines = [entry.date + (entry.title ? ' ' + entry.title : ''), `天气：${entry.weather || '未记录'}`, `心情：${entry.mood || '未记录'}`, '', '封面', entry.cover, '', '日记', entry.body, ...(entry.attachments?.length ? ['', '附件', ...entry.attachments.map(a => a.name)] : [])];
  return '\uFEFF' + lines.join('\n').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n') + '\r\n';
}
export function validHomeDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function homeMonthDays(month: string): Array<string | null> {
  const first = new Date(month + '-01T12:00:00');
  const last = new Date(first); last.setMonth(first.getMonth() + 1, 0);
  const count = last.getDate();
  const leading = (first.getDay() + 6) % 7;
  const result: Array<string | null> = Array(leading).fill(null);
  for (let day = 1; day <= count; day++) result.push(`${month}-${String(day).padStart(2, '0')}`);
  while (result.length % 7) result.push(null);
  return result;
}
export function shiftHomeMonth(month: string, delta: number): string {
  const next = new Date(month + '-01T12:00:00'); next.setMonth(next.getMonth() + delta);
  return `${String(next.getFullYear()).padStart(4, '0')}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}
