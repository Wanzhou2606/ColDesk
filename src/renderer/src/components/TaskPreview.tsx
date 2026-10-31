import {getApi} from '../lib/api';
import {segmentNumber} from '@shared/taskSegments';
import type {ScheduleBlock} from '@shared/types';
import * as React from 'react';
import {createPortal} from 'react-dom';
import type {Task} from '@shared/types';
import {humanDuration,localToMinutes} from '@shared/time';
import {urgencyMeta} from '@shared/scoring';
import {useExpandingCard} from '../lib/useExpandingCard';
export interface TaskPreviewSelection {taskId:string;element:HTMLElement;startAt:string;endAt:string;color?:string}
export type OpenScheduledTask=(selection:TaskPreviewSelection)=>void;
export function taskCardClick(event:React.MouseEvent<HTMLElement>,open:()=>void){if(!(event.target as HTMLElement).closest('button,a,input,select,textarea,[role="menu"]'))open();}
export function taskCardKey(event:React.KeyboardEvent<HTMLElement>,open:()=>void){if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open();}}
export function TaskPreview({task,selection,onClose,onReturn,placements=[]}:{placements?:ScheduleBlock[];onReturn?:()=>void;task:Task;selection:TaskPreviewSelection;onClose:()=>void}){
 const parts=placements.filter(block=>block.taskId===task.id).sort((a,b)=>a.startAt.localeCompare(b.startAt));
 const arrange=()=>{dismiss();void getApi().invoke('task:openEditor',{id:task.id,field:'schedule',date:selection.startAt.slice(0,10)});};
 const {panel,closeButton,style,exiting,dismiss}=useExpandingCard(selection.element,onClose,selection.color??'#a9c7e8',460,Math.min(620,450+Math.ceil((task.detail?.length??0)/26)*22));
 return createPortal(<div ref={panel} className={`course-detail-card task-detail-card${exiting?' is-closing':''}`} style={style} role="dialog" aria-modal="false" aria-labelledby="task-detail-title"><div className="course-detail-accent"/><div className="course-detail-content"><header><div><span>{selection.startAt.slice(0,10).replaceAll('-','/')} · 任务</span><h2 id="task-detail-title">{task.title}</h2></div><button ref={closeButton} aria-label="收起任务详情" onClick={dismiss}>×</button></header><div className="course-detail-time"><strong>{selection.startAt.slice(11,16)}–{selection.endAt.slice(11,16)}</strong><span>{humanDuration(localToMinutes(selection.endAt)-localToMinutes(selection.startAt))} · {urgencyMeta(task.urgency).label}</span>{task.dueAt&&<span>截止时间：{task.dueAt.replace('T',' ')}</span>}</div><section className="task-detail-body"><h3>详细内容</h3>{task.detail?.trim()?<p>{task.detail}</p>:<p className="task-detail-empty">还没有填写详细内容，可从任务右上角的“⋯”中选择“编辑任务”补充。</p>}</section><section className="task-preview-segments"><header><h3>分段安排</h3>{task.status!=='done'&&task.status!=='canceled'&&<button className="ghost-btn" onClick={arrange}>调整分段安排</button>}</header><ol>{parts.map((part,i)=><li key={part.id}><span>{segmentNumber(i+1)}</span><span>{part.date} · {part.startAt.slice(11,16)}–{part.endAt.slice(11,16)}</span></li>)}</ol></section><div className="row-between">{onReturn&&<button className="ghost-btn" onClick={onReturn}>不在今日 · 收回任务栏</button>}<button className="course-detail-day" onClick={dismiss}>收起详情</button></div></div></div>,document.body);
}
