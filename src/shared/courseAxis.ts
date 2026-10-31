import type { WeekView } from './agenda';
import { hhmmToMinutes } from './time';
export interface CourseAxisRow { start: number; end: number; unit: number; units: number; slotIndex?: number; kind: 'lesson'|'break' }
export interface CourseAxis { rows: CourseAxisRow[]; totalUnits: number; unitAt: (minute: number) => number }
/** 上课时段保持比例，课间与午休压缩；无节次数据时使用实际课程边界。 */
export function buildCourseAxis(week: WeekView, slots: Array<{slotIndex:number;startTime:string;endTime:string}> = []): CourseAxis {
  const lessons=week.days.flatMap(d=>d.blocks).filter(b=>b.kind==='lesson'&&b.endMinute>b.startMinute);
  const known=slots.map(s=>({start:hhmmToMinutes(s.startTime),end:hhmmToMinutes(s.endTime),slotIndex:s.slotIndex})).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end<=1440&&s.end>s.start).sort((a,b)=>a.start-b.start);
  const valid=known.every((s,i)=>i===0||s.start>=known[i-1].end);
  // 准确节次的课程横跨课间，但课间仍是休息；只有缺少节次的实际时段可能占用空档。
  const gapLessons=known.length&&valid?lessons.filter(l=>!l.lessonPeriods?.length):lessons;
  const draft:Array<Omit<CourseAxisRow,'unit'>>=[];
  const addGap=(start:number,end:number)=>{if(end<=start)return;const points=[start,end,...gapLessons.flatMap(b=>[Math.max(start,b.startMinute),Math.min(end,b.endMinute)]).filter(p=>p>start&&p<end)];const sorted=[...new Set(points)].sort((a,b)=>a-b);for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i],occupied=gapLessons.some(l=>l.startMinute<b&&l.endMinute>a);draft.push({start:a,end:b,kind:occupied?'lesson':'break',units:occupied?Math.max(.75,(b-a)/45):(b-a>=25?.3:.12)});}};
  if(known.length&&valid){
    const first=Math.min(known[0].start,...lessons.map(b=>b.startMinute));addGap(first,known[0].start);
    known.forEach((s,i)=>{if(i)addGap(known[i-1].end,s.start);draft.push({...s,kind:'lesson',units:1});});
    const last=Math.max(known[known.length-1].end,...lessons.map(b=>b.endMinute));addGap(known[known.length-1].end,last);
  }else if(lessons.length){addGap(Math.min(...lessons.map(b=>b.startMinute)),Math.max(...lessons.map(b=>b.endMinute)));}
  let totalUnits=0;const rows=draft.map(row=>{const result={...row,unit:totalUnits};totalUnits+=row.units;return result;});
  const unitAt=(minute:number)=>{if(!rows.length||minute<=rows[0].start)return 0;for(const row of rows){if(minute<=row.end)return row.unit+Math.max(0,Math.min(1,(minute-row.start)/(row.end-row.start)))*row.units;}return totalUnits;};
  return {rows,totalUnits:Math.max(1,totalUnits),unitAt};
}
