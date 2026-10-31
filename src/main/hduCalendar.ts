import { randomUUID } from 'node:crypto';
import { clipboard, shell } from 'electron';
import { validateHduSubscription, type HduCalendarPreview } from '@shared/hduCalendar';
import { fetchHduCalendar } from './hduFetch';
import { timetableWarnings } from '@shared/timetableImport';
import { importValidatedTimetable } from './timetableImport';

const previews=new Map<number,{id:string;until:number;value:HduCalendarPreview}>();
const revisions=new Map<number,number>();
export async function previewHduCalendar(sender:number,source:unknown) {
  previews.delete(sender);const revision=(revisions.get(sender)??0)+1;revisions.set(sender,revision);
  const value=await fetchHduCalendar(source),id=randomUUID();
  if(revisions.get(sender)!==revision)throw new Error('读取已取消，请重新预览');
  previews.set(sender,{id,until:Date.now()+10*60000,value});
  return {...value,id,warnings:timetableWarnings(value.data)};
}
export function commitHduCalendar(sender:number,input:{id?:unknown}) {
  const cached=previews.get(sender);
  if(!cached||cached.id!==input?.id||cached.until<Date.now())throw new Error('预览已过期，请重新读取订阅');
  const result=importValidatedTimetable(cached.value.data,'replace');previews.delete(sender);return result;
}
export function clearHduPreview(sender:number){previews.delete(sender);revisions.set(sender,(revisions.get(sender)??0)+1);}
export async function hduSubscriptionFromClipboard(){const url=validateHduSubscription(await clipboard.readText());return url;}
export async function openHduSchedule(){await shell.openExternal('https://neo.hduhelp.com/schedule');return true;}
