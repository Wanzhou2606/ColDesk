import {randomUUID} from 'node:crypto';
import {getDb} from './db';
import {isReminderEvent,validateCalendarEvent,type CalendarEvent} from '@shared/calendarEvents';
import {minutesBetween} from '@shared/time';
import {hasNotified,recordNotification} from './db/repositories';
export function getCalendarEvents():CalendarEvent[]{return getDb().prepare('SELECT id,title,detail,type,start_at AS startAt,end_at AS endAt,created_at AS createdAt,updated_at AS updatedAt FROM calendar_event ORDER BY start_at,id').all() as CalendarEvent[];}
export function saveCalendarEvent(input:Record<string,unknown>){const value=validateCalendarEvent(input),time=new Date().toISOString();if(input.id!==undefined&&(typeof input.id!=='string'||!getCalendarEvents().some(event=>event.id===input.id)))throw Error('这项日程已不存在，请重新选择');const id=typeof input.id==='string'?input.id:randomUUID();getDb().prepare('INSERT INTO calendar_event(id,title,detail,type,start_at,end_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,detail=excluded.detail,type=excluded.type,start_at=excluded.start_at,end_at=excluded.end_at,updated_at=excluded.updated_at').run(id,value.title,value.detail,value.type,value.startAt,value.endAt,time,time);return id;}
export function deleteCalendarEvent(id:unknown){if(typeof id!=='string'||!getCalendarEvents().some(event=>event.id===id))throw Error('这项日程已不存在，请重新选择');getDb().prepare('DELETE FROM calendar_event WHERE id=?').run(id);return true;}
/** Claim each occurrence durably before presentation, including one catch-up after sleep/restart. */
export function takeDueCalendarReminders(now:string):CalendarEvent[]{
 return getDb().transaction(()=>getCalendarEvents().filter(event=>{
  if(!isReminderEvent(event)||event.startAt>now||minutesBetween(event.startAt,now)>1440)return false;
  const key=`calendar-event:${event.id}:${event.startAt}`;
  if(hasNotified(key))return false;
  recordNotification({id:'',kind:'event',dedupeKey:key,firedAt:now});
  return true;
 }))();
}
