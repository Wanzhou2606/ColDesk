import type { WeekView } from './agenda';
import type { LessonPeriod } from './types';
import { hhmmToMinutes } from './time';

/** 仅用于显示刻度，不改变排程、课程时刻或拖拽比例。 */
export function teachingPeriods(slots: LessonPeriod[], week?: WeekView, hdu = false): { periods: LessonPeriod[]; estimated: boolean } {
  const valid = slots.filter(s => Number.isInteger(s.slotIndex) && s.slotIndex > 0 && hhmmToMinutes(s.endTime) > hhmmToMinutes(s.startTime));
  if (valid.length) return { periods: valid.sort((a,b)=>a.startTime.localeCompare(b.startTime)), estimated:false };
  const lessons=week?.days.flatMap(d=>d.blocks).filter(b=>b.kind==='lesson')??[];
  // 已有杭电作息表：仅当实际课程的两端都匹配时采用，公共下午时段不猜校区。
  const make=(rows:Array<[number,string,string]>)=>rows.map(([slotIndex,startTime,endTime])=>({slotIndex,startTime,endTime}));
  const common=make([[6,'13:30','14:15'],[7,'14:20','15:05'],[8,'15:15','16:00'],[9,'16:05','16:50']]);
  const presets=[make([[1,'08:05','08:50'],[2,'08:55','09:40'],[3,'10:00','10:45'],[4,'10:50','11:35'],[5,'11:40','12:25'],[10,'18:30','19:15'],[11,'19:20','20:05'],[12,'20:10','20:55']]),make([[1,'08:40','09:25'],[2,'09:30','10:15'],[3,'10:25','11:10'],[4,'11:15','12:00'],[10,'18:00','18:45'],[11,'18:50','19:35'],[12,'19:40','20:25']])].map(p=>[...p,...common].sort((a,b)=>a.slotIndex-b.slotIndex));
  if(hdu&&lessons.length){const matches=presets.filter(p=>lessons.every(l=>p.some(s=>hhmmToMinutes(s.startTime)===l.startMinute)&&p.some(s=>hhmmToMinutes(s.endTime)===l.endMinute)));if(matches.length===1)return {periods:matches[0],estimated:false};if(matches.length===2)return {periods:common,estimated:false};}
  // 通用订阅只有实际时段时，编号表示时段，绝不伪造逐节课的时间。
  const points=[...new Set(lessons.flatMap(l=>[l.startMinute,l.endMinute]))].sort((a,b)=>a-b),periods:LessonPeriod[]=[];
  const clock=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  for(let i=1;i<points.length;i++)if(lessons.some(l=>l.startMinute<points[i]&&l.endMinute>points[i-1]))periods.push({slotIndex:periods.length+1,startTime:clock(points[i-1]),endTime:clock(points[i])});
  return {periods,estimated:true};
}
