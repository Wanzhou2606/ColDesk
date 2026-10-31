import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import type { LessonPeriod } from '@shared/types';
import { hhmmToMinutes } from '@shared/time';
export function TeachingTimeLabels({ periods, start, end, position }: {
    periods: LessonPeriod[];
    start: number;
    end: number;
    position: (minute: number) => number;
}) {
    return <>{periods.filter(p => hhmmToMinutes(p.endTime) > start && hhmmToMinutes(p.startTime) < end).map(p => { const top = position(Math.max(start, hhmmToMinutes(p.startTime))), bottom = position(Math.min(end, hhmmToMinutes(p.endTime))); return <div className="teaching-time-label" data-period={p.slotIndex} style={{ top, height: Math.max(32, bottom - top) } as (RecoveredStyle | undefined)} title={`\u7B2C ${p.slotIndex} \u8282 \xB7 ${p.startTime}\u2013${p.endTime}`} key={p.slotIndex}><span className="period-start">{p.startTime}</span><strong>{p.slotIndex}</strong><span className="period-end">{p.endTime}</span></div>; })}</>;
}
export function TeachingTimeLines({ periods, start, end, position }: {
    periods: LessonPeriod[];
    start: number;
    end: number;
    position: (minute: number) => number;
}) {
    return <>{[...new Set(periods.flatMap(p => [hhmmToMinutes(p.startTime), hhmmToMinutes(p.endTime)]))].filter(m => m >= start && m <= end).map(m => <div className="teaching-time-line" style={{ top: position(m) } as (RecoveredStyle | undefined)} key={m}></div>)}</>;
}
