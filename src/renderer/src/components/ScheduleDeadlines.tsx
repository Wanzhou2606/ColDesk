import {t} from '@shared/i18n';
import * as React from 'react';
import {useState,useRef} from 'react';
import type {TodayView} from '@shared/view';
import {humanDuration} from '@shared/time';
import {urgencyMeta} from '@shared/scoring';
import {getApi} from '../lib/api';
import {SCHEDULE_DRAG_TYPE,type ScheduleDragTask} from '@shared/manualSchedule';
import {deadlineTasksWithPins} from '@shared/taskActions';
import {TaskMenu} from './TaskMenu';
import {NumberStepper} from './NumberStepper';
import {ControlIcon} from './ControlIcon';
export function ScheduleDeadlines({state,onDragTask,onDragEnd,disabled=false,date}:{state:TodayView|null;onDragTask?:(task:ScheduleDragTask)=>void;onDragEnd?:()=>void;disabled?:boolean;date?:string}){
 const [durations,setDurations]=useState<Record<string,string>>({});
 const suppressClickUntil=useRef(0);
 const tasks=deadlineTasksWithPins(state);
 const segments=state?.taskSegments??(state?.timeline??[]).filter(b=>b.kind==='block').map(b=>({...b,taskId:b.taskId!}));
 return <section className="panel deadline-panel"><div className="panel-head"><div><h2>任务栏</h2><p>按截止时间与紧迫程度综合排序</p></div><span className="count-badge">{tasks.length}</span></div><p className="deadline-free-hint">拖动添加一段安排，点击任务查看详情或设置多个时间段。</p>
  {!tasks.length?<div className="deadline-empty">待安排的任务会出现在这里</div>:<ul className="deadline-list">{tasks.map(({task,overdue,dueLabel})=>{
   const meta=urgencyMeta(task.urgency),duration=Number(durations[task.id]??task.estMinutes??45),valid=Number.isInteger(duration)&&duration>=1&&duration<=1440,parts=segments.filter(block=>block.taskId===task.id);
   const edit=()=>{if(disabled||Date.now()<suppressClickUntil.current)return;void getApi().invoke('task:openEditor',{id:task.id,field:'all',date});};
   return <li className="task-with-menu" key={task.id}><TaskMenu task={task} disabled={disabled}/>{task.pinned&&<span className="task-pin-badge deadline-pin">置顶</span>}<button className="check" style={{borderColor:meta.color}} aria-label={'完成：'+task.title} onClick={()=>void getApi().invoke('task:complete',{id:task.id})}/><div className="deadline-details">
    <div data-task-id={task.id} className="deadline-drag-target" role="button" tabIndex={0} draggable={!!onDragTask&&valid&&!disabled} title="点击查看任务，拖动添加一段安排" onClick={edit} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();edit();}}} onDragStart={e=>{if(!onDragTask||!valid||disabled){e.preventDefault();return;}suppressClickUntil.current=Infinity;const data={taskId:task.id,durationMinutes:duration};e.dataTransfer.setData(SCHEDULE_DRAG_TYPE,JSON.stringify(data));e.dataTransfer.effectAllowed='copy';onDragTask(data);}} onDragEnd={()=>{suppressClickUntil.current=Date.now()+250;onDragEnd?.();}}><h3><span className="deadline-grip" aria-hidden="true"><ControlIcon name="grip"/></span>{task.title}</h3><div className="deadline-meta"><span className={overdue?'danger':''}>{overdue?'已超期':dueLabel}</span><span style={{color:meta.color}}>{meta.label}</span></div></div>
    {parts.length>0&&<button type="button" className="deadline-segment-summary" disabled={disabled} onClick={()=>void getApi().invoke('task:openEditor',{id:task.id,field:'schedule',date})}>{t('已安排 {0} 段 · 调整时间',[parts.length])}</button>}
    {onDragTask&&<div className="deadline-duration"><label className="deadline-duration-label" htmlFor={'duration-'+task.id}>本次时长<small>分钟</small></label><NumberStepper compact id={'duration-'+task.id} aria-label={task.title+' 的安排时长'} min={1} max={1440} disabled={disabled} value={durations[task.id]??String(task.estMinutes??45)} onValueChange={value=>setDurations(old=>({...old,[task.id]:value}))}/></div>}{!valid&&<span className="t-caption danger">请填写 1–1440 分钟</span>}
   </div></li>;
  })}</ul>}<div className="deadline-foot">当日已安排 <strong>{humanDuration(state?.summary.plannedMinutes??0)}</strong></div></section>;
}
