/**
 * 排程偏好的"可调子集"与安全收敛。
 *
 * 设计取舍：PlannerPrefs 里有十来个参数，但全部暴露到界面上会让设置页变成一堵墙。
 * 这里只挑出真正影响用户日常感受的 4 组：
 *   1. 每半天可安排任务的时段（学习/生活各一套）
 *   2. 单日安排上限
 *   3. 单块时长区间
 *   4. 块间休息与截止前预留缓冲
 * 其余（睡前缓冲、周末折减、排程视野天数）沿用内置默认值。
 *
 * 之所以要"收敛"而不是直接信任界面传来的值：用户可能把上限设成 0、
 * 把单块最短时间设得比最长还大、或者写出 25:00 这种时间。
 * 这些会直接让排程引擎产出荒谬结果（比如 0 分钟的块），所以统一在这里兜住。
 */

import type { Domain } from './types';
import { DEFAULT_PREFS, type PlannerPrefs } from './planner';

export interface PlannerWindowView {
  start: string;
  end: string;
}

export interface PlannerPrefsView {
  /** 学习任务可安排时段 */
  studyWindows: PlannerWindowView[];
  /** 生活任务可安排时段 */
  lifeWindows: PlannerWindowView[];
  dailyCapMinutes: { study: number; life: number };
  minBlockMinutes: number;
  maxBlockMinutes: number;
  breakMinutes: number;
  dueBufferRatio: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_PREFS_VIEW: PlannerPrefsView = {
  studyWindows: DEFAULT_PREFS.windows.study.map((w) => ({ ...w })),
  lifeWindows: DEFAULT_PREFS.windows.life.map((w) => ({ ...w })),
  dailyCapMinutes: { ...DEFAULT_PREFS.dailyCapMinutes },
  minBlockMinutes: DEFAULT_PREFS.minBlockMinutes,
  maxBlockMinutes: DEFAULT_PREFS.maxBlockMinutes,
  breakMinutes: DEFAULT_PREFS.breakMinutes,
  dueBufferRatio: DEFAULT_PREFS.dueBufferRatio
};

/**
 * 转成有限数字，识别不了就返回 fallback。
 *
 * 注意这里必须显式挡掉 null 与空串：`Number(null)` 是 0、`Number('')` 也是 0，
 * 不拦的话"用户把输入框清空"会被当成"填了 0"，
 * 于是单块最长时间变成 0，还会连带把最短时间也压小，排出来的日程就完全不对了。
 */
function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = toFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function clampRatio(value: unknown, fallback: number): number {
  const n = toFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(Math.max(n, 0), 0.5);
}

/** 时间字符串收敛；不合法就返回空串，由调用方决定是丢弃还是用默认值 */
function normalizeTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(HHMM);
  if (!match) return '';
  return `${match[1]}:${match[2]}`;
}

/**
 * 收敛时段列表：
 *  - 丢掉时间不合法、或结束不晚于开始的项
 *  - 按开始时间排序
 *  - 合并重叠区间（否则同一个时段会被算两次，导致单日额度看起来翻倍）
 *  - 全空时回退到默认，避免"用户清空后什么都排不进去"这种莫名其妙的状态
 */
function normalizeWindows(input: unknown, fallback: PlannerWindowView[]): PlannerWindowView[] {
  if (!Array.isArray(input)) return fallback.map((w) => ({ ...w }));

  const parsed = input
    .map((raw) => ({
      start: normalizeTime((raw as PlannerWindowView)?.start),
      end: normalizeTime((raw as PlannerWindowView)?.end)
    }))
    .filter((w) => w.start && w.end && w.start < w.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  if (parsed.length === 0) return fallback.map((w) => ({ ...w }));

  const merged: PlannerWindowView[] = [];
  for (const w of parsed) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = w.end > last.end ? w.end : last.end;
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/** 把界面传来的偏好收敛成安全的 PlannerPrefsView */
export function sanitizePrefsView(input: unknown): PlannerPrefsView {
  const raw = (input ?? {}) as Partial<PlannerPrefsView>;

  // 单块时长：先各自收敛，再纠正"最短 > 最长"的矛盾
  let minBlock = clampInt(raw.minBlockMinutes, 10, 240, DEFAULT_PREFS_VIEW.minBlockMinutes);
  let maxBlock = clampInt(raw.maxBlockMinutes, 15, 360, DEFAULT_PREFS_VIEW.maxBlockMinutes);
  if (minBlock > maxBlock) {
    // 以用户更可能想表达的那个为准：把最短压到最长以下
    minBlock = Math.max(10, Math.min(minBlock, maxBlock));
  }

  return {
    studyWindows: normalizeWindows(raw.studyWindows, DEFAULT_PREFS_VIEW.studyWindows),
    lifeWindows: normalizeWindows(raw.lifeWindows, DEFAULT_PREFS_VIEW.lifeWindows),
    dailyCapMinutes: {
      study: clampInt(raw.dailyCapMinutes?.study, 30, 720, DEFAULT_PREFS_VIEW.dailyCapMinutes.study),
      life: clampInt(raw.dailyCapMinutes?.life, 0, 360, DEFAULT_PREFS_VIEW.dailyCapMinutes.life)
    },
    minBlockMinutes: minBlock,
    maxBlockMinutes: maxBlock,
    breakMinutes: clampInt(raw.breakMinutes, 0, 60, DEFAULT_PREFS_VIEW.breakMinutes),
    dueBufferRatio: clampRatio(raw.dueBufferRatio, DEFAULT_PREFS_VIEW.dueBufferRatio)
  };
}

/** 把可调子集展开成排程引擎要的完整 PlannerPrefs（其余沿用内置默认） */
export function toPlannerPrefs(view: PlannerPrefsView): Partial<PlannerPrefs> {
  return {
    windows: {
      study: view.studyWindows.map((w) => ({ ...w })),
      life: view.lifeWindows.map((w) => ({ ...w }))
    } as Record<Domain, Array<{ start: string; end: string }>>,
    dailyCapMinutes: { ...view.dailyCapMinutes },
    minBlockMinutes: view.minBlockMinutes,
    maxBlockMinutes: view.maxBlockMinutes,
    breakMinutes: view.breakMinutes,
    dueBufferRatio: view.dueBufferRatio
  };
}
