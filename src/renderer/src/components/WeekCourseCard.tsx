import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { WeekDayView } from '@shared/agenda';
export type WeekCourse = WeekDayView['blocks'][number];
export function WeekCourseCard({ block, style, selected, onOpen }: {
    block: WeekCourse;
    style: CSSProperties;
    selected: boolean;
    onOpen: (element: HTMLButtonElement) => void;
}) {
    const card = useRef<HTMLButtonElement>(null), title = useRef<HTMLSpanElement>(null);
    const [details, setDetails] = useState(false), [short, setShort] = useState(false);
    useEffect(() => {
        const element = card.current;
        if (!element)
            return;
        const measure = () => { const w = element.clientWidth, h = element.clientHeight; const line = parseFloat(getComputedStyle(title.current!).lineHeight) || 18; const titleHeight = Math.min(line * 3, title.current?.scrollHeight ?? line); const growth = parseFloat(getComputedStyle(element).getPropertyValue('--schedule-text-growth')) || 0, metaCount = Number(!!block.teacher) + Number(!!block.location); setDetails(metaCount > 0 && w >= 100 && h >= titleHeight + metaCount * (11 + growth) * 1.45 + 18); setShort(h < line * 2 + 16); };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [block.title, block.teacher, block.location]);
    return <button ref={card} className={`week-block kind-lesson week-course-card${details ? " shows-meta" : ""}${short ? " short-title" : ""}${selected ? " is-previewing" : ""}`} style={{ ...style, "--course-color": block.color ?? "#8375d4" } as (RecoveredStyle | undefined)} type="button" aria-label={`\u67E5\u770B\u8BFE\u7A0B\uFF1A${block.title}`} aria-expanded={selected} onClick={e => onOpen(e.currentTarget)} title={`${block.title}
${block.teacher ?? ""}${block.location ? " \u00B7 " + block.location : ""}
${block.timeLabel}`}><span ref={title} className="week-course-name">{block.title}</span><span className="week-course-meta">{block.teacher && <span className="week-course-teacher">{block.teacher}</span>}{block.location && <span className="week-course-room">{block.location}</span>}</span></button>;
}
