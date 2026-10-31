import {manualRange} from './manualSchedule';
import {localToMinutes} from './time';

export interface TaskSegmentInput {id?:string;startAt:string;endAt:string}
export interface TaskSegment extends TaskSegmentInput {date:string;plannedMinutes:number}
export function segmentNumber(index:number):string{
 if(index>=1&&index<=20)return String.fromCodePoint(0x2460+index-1);
 if(index<=35)return String.fromCodePoint(0x3251+index-21);
 if(index<=50)return String.fromCodePoint(0x32b1+index-36);
 return `(${index})`;
}
export function validateTaskSegments(input:unknown):TaskSegment[]{
 if(!Array.isArray(input))throw Error('请设置有效的任务时间段');
 const ids=new Set<string>();
 const rows=input.map((raw:unknown)=>{
  if(!raw||typeof raw!=='object')throw Error('请填写每段安排的日期、开始和结束时间');
  const row=raw as Record<string,unknown>;
  if(row.id!==undefined&&(typeof row.id!=='string'||!row.id||row.id.length>200||ids.has(row.id)))throw Error('分段记录已更新，请重新打开任务');
  if(typeof row.id==='string')ids.add(row.id);
  if(typeof row.startAt!=='string'||typeof row.endAt!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(row.endAt)||row.startAt.slice(0,10)!==row.endAt.slice(0,10))throw Error('请填写每段安排的日期、开始和结束时间');
  const range=manualRange(row.startAt,localToMinutes(row.endAt)-localToMinutes(row.startAt));
  return {...(typeof row.id==='string'?{id:row.id}:{}),startAt:range.startAt,endAt:range.endAt,date:range.date,plannedMinutes:range.durationMinutes};
 }).sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.endAt.localeCompare(b.endAt));
 for(let i=1;i<rows.length;i++)if(rows[i].startAt<rows[i-1].endAt)throw Error('同一任务的时间段不能重叠，请调整开始或结束时间');
 return rows;
}
