import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import {useExpandingCard} from '../lib/useExpandingCard';
import { createPortal } from 'react-dom';
import { humanDuration } from '@shared/time';
import type { WeekCourse } from './WeekCourseCard';
export interface CourseSelection {
    block: WeekCourse;
    date: string;
    element: HTMLButtonElement;
}
export function CoursePreview({ selection, onClose, onDay }: {
    selection: CourseSelection;
    onClose: () => void;
    onDay: () => void;
}) {
    const {block,date,element}=selection,periods=block.lessonPeriods??[],count=block.lessonCount??(periods.length||Math.max(1,Math.round((block.endMinute-block.startMinute)/45))),estimated=block.lessonCountEstimated??!periods.length;
    const {panel,closeButton,style,exiting,dismiss}=useExpandingCard(element,onClose,block.color??'#a9c7e8',350,periods.length?280+Math.min(periods.length,6)*36:350);
    return createPortal(<div ref={panel} className={`course-detail-card${exiting ? " is-closing" : ""}`} style={style as (RecoveredStyle | undefined)} role="dialog" aria-modal="false" aria-labelledby="course-detail-title"><div className="course-detail-accent"></div><div className="course-detail-content"><header><div><span>{date.replaceAll("-", "/")}{" \u00B7 \u8BFE\u7A0B"}</span><h2 id="course-detail-title">{block.title}</h2></div><button ref={closeButton} aria-label="收起课程详情" onClick={dismiss}>{"\u00D7"}</button></header><div className="course-detail-meta"><span>{block.teacher ?? "\u8001\u5E08\u672A\u63D0\u4F9B"}</span><span>{block.location ?? "\u5730\u70B9\u672A\u63D0\u4F9B"}</span></div><div className="course-detail-time"><strong>{block.timeLabel.replace("-", "\u2013")}</strong><span>{estimated ? "\u7EA6 " : ""}{count}{" \u8282\u8BFE \u00B7 "}{humanDuration(block.endMinute - block.startMinute)}</span></div>{periods.length > 0 ? <ol className="course-period-list">{periods.map(p => <li key={p.slotIndex}><span>{"\u7B2C "}{p.slotIndex}{" \u8282"}</span><strong>{p.startTime}{"\u2013"}{p.endTime}</strong></li>)}</ol> : <p className="course-period-note">{"\u8BA2\u9605\u672A\u63D0\u4F9B\u8282\u6B21\uFF0C\u8282\u6570\u6309 45 \u5206\u949F\u8BFE\u65F6\u4F30\u7B97\uFF1B\u8D77\u6B62\u65F6\u95F4\u6309\u539F\u8BFE\u8868\u663E\u793A\u3002"}</p>}<button className="course-detail-day" onClick={onDay}>{"\u67E5\u770B\u5F53\u5929\u65E5\u7A0B \u2192"}</button></div></div>, document.body);
}
