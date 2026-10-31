import * as React from 'react';
import {ControlIcon} from '../components/ControlIcon';
import {useEffect,useRef,useState} from 'react';
import type {TodayView} from '@shared/view';
import type {DayBlock} from '@shared/types';
import type {CalendarEvent} from '@shared/calendarEvents';
import type {ManualPlacement,ScheduleDragTask} from '@shared/manualSchedule';
import {scheduleWindow,scheduleClock} from '@shared/personalization';
import {teachingPeriods} from '@shared/teachingPeriods';
import {humanDuration,today,addDays} from '@shared/time';
import {findViewTask,deadlineTasksWithPins} from '@shared/taskActions';
import {getApi} from '../lib/api';
import {userError} from '../lib/userError';
import {TaskPreview,type TaskPreviewSelection} from '../components/TaskPreview';
import {CalendarEventEditor} from '../components/CalendarEventEditor';
import {CalendarEventPreview} from '../components/CalendarEventPreview';
import {ScheduleDatePicker} from '../components/ScheduleDatePicker';
import {ScheduleDeadlines} from '../components/ScheduleDeadlines';
import {DayView} from './DayView';
import {DayAgenda} from './DayAgenda';
import {WeekView} from './WeekView';
type ViewMode='timeline'|'day'|'week';
export function SchedulePage({state}:{state:TodayView|null}){
 const [date,setDate]=useState(state?.date??today()),[dated,setDated]=useState<TodayView|null>(null),[view,setView]=useState<ViewMode>('timeline'),[zoom,setZoom]=useState(1),[courseMode,setCourseMode]=useState(false);
 const [editor,setEditor]=useState<{event?:CalendarEvent}|null>(null),[taskPreview,setTaskPreview]=useState<TaskPreviewSelection|null>(null),[eventPreview,setEventPreview]=useState<{id:string;element:HTMLElement}|null>(null);
 const [dragTask,setDragTask]=useState<ScheduleDragTask|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0),request=useRef(0);
 useEffect(()=>{const seq=++request.current;if(date===state?.date){setDated(null);return;}setDated(null);void getApi().invoke('schedule:view',{date}).then(value=>{if(seq===request.current)setDated(value as TodayView);}).catch(e=>{if(seq===request.current)setError(userError(e,'暂时无法读取这一天的日程，请重试。'));});return()=>{request.current++;};},[date,state,revision]);
 const data=date===state?.date?state:dated?.date===date?dated:null,loading=!data,range=scheduleWindow(state?.settings),periods=teachingPeriods(data?.teachingSlots??state?.teachingSlots??[],data?.courseWeek??data?.week);
 const axis=courseMode&&periods.periods.length>0;
 const previousToday=useRef(state?.date??today());
 useEffect(()=>{if(state?.date&&state.date!==previousToday.current){if(date===previousToday.current)setDate(state.date);previousToday.current=state.date;}},[state?.date]);
 const dueCount=deadlineTasksWithPins(state).filter(({task})=>task.dueAt?.slice(0,10)===date).length;
 const chosenTask=findViewTask(state,taskPreview?.taskId);
 const allBlocks:DayBlock[]=[...(data?.timeline??[]),...(data?.week.days.flatMap(day=>day.blocks.map(block=>({...block,startAt:day.date+'T'+scheduleClock(block.startMinute),endAt:day.date+'T'+scheduleClock(block.endMinute)})))??[])];
 const chosenEvent=allBlocks.find(block=>block.eventId===eventPreview?.id);
 const chooseDate=(next:string)=>{setDate(next);setView('timeline');setTaskPreview(null);setEventPreview(null);setError('');setMessage('');setDragTask(null);};
 useEffect(()=>{setTaskPreview(null);setEventPreview(null);},[view,zoom,courseMode]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(editor||target?.closest?.('input,textarea,select,[role="dialog"]'))return;if(e.ctrlKey||e.altKey||e.metaKey||e.isComposing)return;const modes:Record<string,ViewMode>={'1':'timeline','2':'week','3':'day'};if(modes[e.key])setView(modes[e.key]);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[editor]);
 const mutate=async(channel:string,payload:unknown,success:string)=>{if(busy)return false;setBusy(true);setError('');setMessage('');try{await getApi().invoke(channel,payload);setMessage(success);setRevision(r=>r+1);return true;}catch(e){setError(userError(e,'暂时无法保存日程，请重试。'));return false;}finally{setBusy(false);setDragTask(null);}};
 const reloadAll=async()=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await getApi().invoke('state:refresh');setRevision(r=>r+1);setMessage('已重新加载数据。');}catch(e){setError(userError(e,'暂时无法刷新，请重试。'));}finally{setBusy(false);}};
const place=(input:ManualPlacement)=>mutate('schedule:placeTask',input,'已保存安排；其他任务仍留在任务栏。').then(()=>{});
 const remove=(blockId:string)=>mutate('schedule:removePlacement',{blockId},'已收回任务栏，任务内容与截止时间保留。').then(()=>{});
 const returnTask=async()=>{if(!taskPreview)return;if(await mutate('schedule:notToday',{taskId:taskPreview.taskId,date:taskPreview.startAt.slice(0,10)},'已收回任务栏，任务内容与截止时间保留。'))setTaskPreview(null);};
 const openEvent=(id:string,element:HTMLElement)=>{setTaskPreview(null);setEventPreview({id,element});};
 const editEvent=()=>{if(!chosenEvent)return;setEditor({event:{id:chosenEvent.eventId!,title:chosenEvent.title,detail:chosenEvent.detail??'',type:chosenEvent.eventType??'activity',startAt:chosenEvent.startAt,endAt:chosenEvent.endAt,createdAt:'',updatedAt:''}});setEventPreview(null);};
 const deleteEvent=async()=>{if(!chosenEvent||!window.confirm('删除这项日程？'))return;if(await mutate('schedule:deleteEvent',{id:chosenEvent.eventId},'日程已删除。'))setEventPreview(null);};
 const outside=data?.timeline.some(block=>Number(block.startAt.slice(11,13))*60+Number(block.startAt.slice(14,16))<range.startMinute||Number(block.endAt.slice(11,13))*60+Number(block.endAt.slice(14,16))>range.endMinute);
 return <div className={`page schedule-page view-${view}`}>
  <header className="page-head"><div><h1 className="page-title">日程</h1><p className="t-caption">任务留在任务栏，时间由你安排。</p></div><div className="row"><button className="ghost-btn" onClick={()=>void reloadAll()} disabled={busy}><ControlIcon name="refresh"/> 刷新</button><button className="primary-btn lg" onClick={()=>setEditor({})}><ControlIcon name="plus"/> 新建日程</button></div></header>
  <div className="schedule-date-toolbar"><div className="row"><button className="icon-btn" aria-label="前一天" onClick={()=>chooseDate(addDays(date,-1))}><ControlIcon name="left"/></button><ScheduleDatePicker value={date} onChange={chooseDate}/><button className="icon-btn" aria-label="后一天" onClick={()=>chooseDate(addDays(date,1))}><ControlIcon name="right"/></button></div>{date!==(state?.date??today())&&<button className="ghost-btn" onClick={()=>chooseDate(state?.date??today())}>回到今天</button>}<span className="t-caption">选择日期后，自由填写时间段或拖动任务安排。</span></div>
  <div className="schedule-overview" aria-label="当日概览"><div><span className="overview-dot lessons"/><span>当日课程</span><strong>{data?.summary.lessonCount??0}<small>节</small></strong></div><div><span className="overview-dot plans"/><span>已安排</span><strong>{humanDuration(data?.summary.plannedMinutes??0)}</strong></div><div><span className="overview-dot deadlines"/><span>当日截止</span><strong>{dueCount}<small>项</small></strong></div></div>
  {(message||error)&&<div className={`schedule-placement-message${error?' error':''}`} role={error?'alert':'status'}><span>{error||message}</span>{error&&<button onClick={()=>setRevision(r=>r+1)}>重试</button>}<button aria-label="关闭安排提示" onClick={()=>{setError('');setMessage('');}}><ControlIcon name="close"/></button></div>}
  <div className="schedule-layout" data-zoom={zoom}><section className="panel agenda-panel"><div className="schedule-toolbar"><div><h2>{view==='week'?'未来 7 天':data?.dateLabel??date}</h2><p>{view==='week'?'点击日期，查看并安排当天日程':view==='day'?'按时间顺序查看完整安排':'全天预览 · 自由安排任务时间'}</p></div><div className="schedule-toolbar-controls"><div className="segmented schedule-switch" aria-label="日程视图"><button className={view==='timeline'?'active':''} aria-pressed={view==='timeline'} onClick={()=>setView('timeline')}>日程表</button><button className={view==='day'?'active':''} aria-pressed={view==='day'} onClick={()=>setView('day')}>清单</button><button className={view==='week'?'active':''} aria-pressed={view==='week'} onClick={()=>setView('week')}>周视图</button></div><button className={`course-mode-button${axis?' active':''}`} aria-pressed={axis} disabled={!periods.periods.length} onClick={()=>setCourseMode(v=>!v)}>课表模式</button></div></div>
   {view!=='day'&&<div className="schedule-scale-bar"><span>{axis?'课程节次刻度 · 所有安排保留':`${range.startLabel}–${range.endLabel}`} {zoom===1?'· 总览':`${zoom*100}%`}</span><div className="schedule-zoom" role="group" aria-label="日程缩放"><button aria-label="缩小日程" disabled={zoom===1} onClick={()=>setZoom(Math.max(1,zoom/2))}><ControlIcon name="minus"/></button><button aria-label="恢复全天预览" className={zoom===1?'active':''} onClick={()=>setZoom(1)}>总览</button><button aria-label="放大日程" disabled={zoom===8} onClick={()=>setZoom(Math.min(8,zoom*2))}><ControlIcon name="plus"/></button></div></div>}
   {outside&&view!=='day'&&<button className="schedule-outside-note" onClick={()=>setView('day')}>部分安排在显示范围外，点击清单查看</button>}
   {loading?<div className="agenda-empty" role="status">正在读取这一天的日程…</div>:view==='week'?<WeekView state={data} week={data!.week} zoom={zoom} courseMode={axis} onTaskOpen={setTaskPreview} onEventOpen={openEvent} onPickDay={chooseDate}/>:view==='day'?<DayAgenda state={data} timeline={date!==state?.date?data!.timeline:undefined} onTaskOpen={setTaskPreview} onEventOpen={openEvent}/>:<DayView state={data} date={date} zoom={zoom} courseMode={axis} periods={periods.periods} onTaskOpen={setTaskPreview} onEventOpen={openEvent} dragTask={dragTask} onDragTask={drag=>{setDragTask(drag);setView('timeline');setError('');setMessage('');}} onDragEnd={()=>setDragTask(null)} onPlaceTask={place} onRemovePlacement={remove} disabled={busy}/>}
  </section>{view!=='week'&&<aside className="schedule-side"><ScheduleDeadlines state={data} onDragTask={drag=>{setDragTask(drag);setView('timeline');setError('');setMessage('');}} onDragEnd={()=>setDragTask(null)} disabled={busy||loading} date={date}/></aside>}</div>
  {taskPreview&&chosenTask&&<TaskPreview placements={state?.taskSegments} task={chosenTask} selection={taskPreview} onClose={()=>setTaskPreview(null)} onReturn={chosenTask.status==='done'||chosenTask.status==='canceled'?undefined:()=>void returnTask()} key={taskPreview.taskId+taskPreview.startAt}/>}
  {chosenEvent&&eventPreview&&<CalendarEventPreview event={chosenEvent} element={eventPreview.element} onClose={()=>setEventPreview(null)} onEdit={editEvent} onDelete={()=>void deleteEvent()} key={chosenEvent.id}/>}
  {editor&&<CalendarEventEditor date={date} event={editor.event} onClose={()=>setEditor(null)} onSaved={next=>{setEditor(null);chooseDate(next);setRevision(r=>r+1);setMessage('日程已保存。');}}/>}
 </div>;
}
