import {TimePicker} from './TimePicker';
import {t} from '@shared/i18n';
import * as React from 'react';
import {segmentNumber,validateTaskSegments} from '@shared/taskSegments';
import type {ScheduleBlock} from '@shared/types';
import {humanDuration} from '@shared/time';
export interface TaskSegmentDraft {key:string;id?:string;date:string;start:string;end:string}
export const segmentDrafts=(blocks:ScheduleBlock[]):TaskSegmentDraft[]=>blocks.slice().sort((a,b)=>a.startAt.localeCompare(b.startAt)).map(block=>({key:block.id,id:block.id,date:block.date,start:block.startAt.slice(11,16),end:block.endAt.slice(11,16)}));
export function serializeSegments(rows:TaskSegmentDraft[]){return validateTaskSegments(rows.map(row=>({...(row.id?{id:row.id}:{}),startAt:row.date+'T'+row.start,endAt:row.date+'T'+row.end})));}
export function TaskSegmentsFields({rows,onChange,defaultDate,disabled=false}:{rows:TaskSegmentDraft[];onChange:(rows:TaskSegmentDraft[])=>void;defaultDate:string;disabled?:boolean}){
 const patch=(index:number,value:Partial<TaskSegmentDraft>)=>onChange(rows.map((row,i)=>i===index?{...row,...value}:row));
 let total=0;try{total=serializeSegments(rows).reduce((sum,row)=>sum+row.plannedMinutes,0);}catch{}
 return <section className="task-segments-fields" aria-label="任务分段安排">
  <header><div><h3>预计安排（可选）</h3><p>自由设置日期和起止时间，也可以保存后拖入日程表。</p></div><span>{t('{0} 段',[rows.length])}{total>0?' · '+humanDuration(total):''}</span></header>
  {rows.length===0&&<div className="task-segments-empty">暂未安排时间，任务会保留在任务栏。</div>}
  <div className="task-segment-rows">{rows.map((row,index)=><div className="task-segment-row" key={row.key}>
   <span className="task-segment-number">{segmentNumber(index+1)}</span>
   <label>日期<input className="input" type="date" value={row.date} required disabled={disabled} onChange={e=>patch(index,{date:e.target.value})}/></label>
   <label>开始时间<TimePicker className="input" value={row.start} required disabled={disabled} onChange={e=>patch(index,{start:e})}/></label>
   <label>结束时间<div className="task-segment-end"><TimePicker className="input" value={row.end==='24:00'?'':row.end} required={row.end!=='24:00'} disabled={disabled||row.end==='24:00'} onChange={e=>patch(index,{end:e})}/><button type="button" className="ghost-btn" aria-pressed={row.end==='24:00'} disabled={disabled} onClick={()=>patch(index,{end:row.end==='24:00'?'':'24:00'})}>24:00</button></div></label>
   <button type="button" className="icon-btn segment-remove" aria-label={t('删除第 {0} 段安排',[index+1])} disabled={disabled} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}>×</button>
  </div>)}</div>
  <footer><button type="button" className="ghost-btn segment-add" disabled={disabled} onClick={()=>onChange([...rows,{key:'new-'+Date.now()+'-'+Math.random(),date:defaultDate,start:'',end:''}])}>＋ 添加时间段</button><small>同一任务只保留一项，日程中的多段安排会自动编号。</small></footer>
 </section>;
}
