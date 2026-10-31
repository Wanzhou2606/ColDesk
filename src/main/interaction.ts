import {execFile} from 'node:child_process';

const DEFAULT_HOVER_TIME = 400;
export function parseMouseHoverTime(output: string): number {
  const value = output.match(/\bMouseHoverTime\s+REG_(?:SZ|DWORD)\s+(0x[\da-f]+|\d+)\s*$/im)?.[1];
  const time = value === undefined ? NaN : Number(value);
  return Number.isInteger(time) && time > 0 && time <= 60000 ? time : DEFAULT_HOVER_TIME;
}

let cached: {time: number; readAt: number} | undefined;
let pending: Promise<number> | undefined;
/** Read only the current user's Windows hover preference; never launch a visible shell. */
export async function mouseHoverTime(): Promise<number> {
  if (process.platform !== 'win32') return DEFAULT_HOVER_TIME;
  if (cached && Date.now() - cached.readAt < 30000) return cached.time;
  if (!pending) pending = new Promise<number>(resolve => {
    execFile('reg.exe', ['query', 'HKCU\\Control Panel\\Mouse', '/v', 'MouseHoverTime'],
      {windowsHide: true, timeout: 1500}, (error, output) => resolve(error ? DEFAULT_HOVER_TIME : parseMouseHoverTime(output)));
  }).then(time => {cached = {time, readAt: Date.now()}; return time;}).finally(() => {pending = undefined;});
  return pending;
}
