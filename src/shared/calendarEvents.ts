import {validHomeDate} from './home';
import {hhmmToMinutes} from './time';
export interface CalendarEvent {id:string;title:string;detail:string;type:'activity'|'lecture'|'class';startAt:string;endAt:string;createdAt:string;updatedAt:string}
/** A point event has no occupied duration. Equal endpoints preserve the existing storage format. */
export function isReminderEvent(event:Pick<CalendarEvent,'startAt'|'endAt'>):boolean{return event.startAt===event.endAt;}
export function eventTimeLabel(event:Pick<CalendarEvent,'startAt'|'endAt'>):string{return isReminderEvent(event)?event.startAt.slice(11,16):`${event.startAt.slice(11,16)}-${event.endAt.slice(11,16)}`;}
export function validateCalendarEvent(input:Record<string,unknown>){
 if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>200)throw Error('日程标题请填写 1–200 个字符');
 if(typeof input.detail!=='string'||input.detail.length>8000)throw Error('日程内容请控制在 8000 字以内');
 if(!['activity','lecture','class'].includes(String(input.type)))throw Error('请选择日程类型');
 const start=input.startAt;
 if(typeof start!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)||!validHomeDate(start.slice(0,10)))throw Error('请选择有效的日期和开始时间');
 const noEnd=input.endAt===undefined||input.endAt===null||input.endAt==='';
 const end=noEnd?start:input.endAt;
 if(typeof end!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(end)||start.slice(0,10)!==end.slice(0,10)||(!noEnd&&start>=end))throw Error('请选择同一天内有效的起止时间，结束需晚于开始');
 return {title:input.title.trim(),detail:input.detail.trim(),type:input.type as CalendarEvent['type'],startAt:start,endAt:end};
}
/** Snap to actual teaching periods, preserving breaks between consecutive periods. */
export function studyPeriodRange(minute:number,count:number,periods:Array<{startTime:string;endTime:string}>){
 const sorted=periods.slice().sort((a,b)=>a.startTime.localeCompare(b.startTime));if(!sorted.length||!Number.isInteger(count)||count<1)return null;
 let index=sorted.findIndex(p=>minute>=hhmmToMinutes(p.startTime)&&minute<hhmmToMinutes(p.endTime));
 if(index<0)index=sorted.reduce((best,p,i)=>Math.abs(hhmmToMinutes(p.startTime)-minute)<Math.abs(hhmmToMinutes(sorted[best].startTime)-minute)?i:best,0);
 if(index+count>sorted.length)return null;
 for(let i=index+1;i<index+count;i++)if(hhmmToMinutes(sorted[i].startTime)-hhmmToMinutes(sorted[i-1].endTime)>30)return null;
 const startMinute=hhmmToMinutes(sorted[index].startTime),endMinute=hhmmToMinutes(sorted[index+count-1].endTime);
 return {startMinute,endMinute,durationMinutes:endMinute-startMinute};
}
