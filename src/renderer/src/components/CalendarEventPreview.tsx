import {isReminderEvent,eventTimeLabel} from '@shared/calendarEvents';
import * as React from 'react';
import {createPortal} from 'react-dom';
import type {DayBlock} from '@shared/types';
import {useExpandingCard} from '../lib/useExpandingCard';
export type OpenCalendarEvent=(id:string,element:HTMLElement)=>void;
export function CalendarEventPreview({event,element,onClose,onEdit,onDelete}:{event:DayBlock;element:HTMLElement;onClose:()=>void;onEdit:()=>void;onDelete:()=>void}){
 const {panel,closeButton,style,exiting,dismiss}=useExpandingCard(element,onClose,event.color??'#a9d7c0',460,500);
 return createPortal(<div ref={panel} className={`course-detail-card task-detail-card event-detail-card${exiting?' is-closing':''}`} style={style} role="dialog" aria-modal="false" aria-labelledby="event-detail-title"><div className="course-detail-accent"/><div className="course-detail-content"><header><div><span>{event.startAt.slice(0,10)} · {event.eventType==='class'?'临时课程':event.eventType==='lecture'?'讲座':'活动'}</span><h2 id="event-detail-title">{event.title}</h2></div><button ref={closeButton} aria-label="收起日程详情" onClick={dismiss}>×</button></header><div className="course-detail-time"><strong>{eventTimeLabel(event)}</strong>{isReminderEvent(event)&&<span>仅提醒一次，不占用时间段</span>}</div><section className="task-detail-body"><h3>内容</h3><p>{event.detail||'尚未填写内容'}</p></section><footer className="event-preview-actions"><button className="ghost-btn" onClick={onEdit}>编辑日程</button><button className="ghost-btn danger-text" onClick={onDelete}>删除日程</button></footer></div></div>,document.body);
}
