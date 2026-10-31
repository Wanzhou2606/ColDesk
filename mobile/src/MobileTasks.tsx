import {useEffect,useState} from 'react';
import {taskPageGroups} from '@shared/taskActions';
import {sortTasksByPriority,urgencyMeta} from '@shared/scoring';
import type {TodayView} from '@shared/view';
import type {GoalSummary} from '@shared/goals';
import {humanDuration} from '@shared/time';
import {AppIcon} from '../../src/renderer/src/components/AppIcon';
import {ControlIcon} from '../../src/renderer/src/components/ControlIcon';
import {TaskMenu} from '../../src/renderer/src/components/TaskMenu';
import {GoalProgressBar} from '../../src/renderer/src/components/GoalProgress';
import {getApi} from '../../src/renderer/src/lib/api';

export function MobileTasks({state,onAdd,onGoals,onEdit}:{state:TodayView;onAdd:()=>void;onGoals:()=>void;onEdit:(id:string)=>void}){
 const [completed,setCompleted]=useState(false),[expanded,setExpanded]=useState<string|null>(null),[search,setSearch]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState(''),[goal,setGoal]=useState<GoalSummary|null>(null);
 useEffect(()=>{let active=true;const load=()=>void getApi().invoke('goals:list').then(value=>{const goals=value as GoalSummary[];if(active)setGoal(goals.find(g=>g.isPrimary)??goals[0]??null);}).catch(()=>{});load();const off=getApi().on('goals:changed',load);return()=>{active=false;off();};},[]);
 const groups=taskPageGroups(state),entries=completed?[['done','已完成',state.buckets.done] as const]:[['today','今日',groups.today],['threeDays','近三天',groups.threeDays],['week','近一周',groups.week],['later','更远',groups.later]] as const;
 return <div className="page mobile-tasks"><header className="mobile-page-heading"><div><span className="mobile-kicker">一件一件，慢慢完成</span><h1>任务</h1></div><div className="row"><button className="mobile-round-button" aria-label="搜索任务" aria-expanded={search} onClick={()=>{setSearch(!search);setQuery('');}}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button><button className="mobile-round-button primary" aria-label="新建任务" onClick={onAdd}><ControlIcon name="plus"/></button></div></header>
  {search&&<input className="input mobile-search" autoFocus placeholder="搜索任务名称或详细内容" value={query} onChange={e=>setQuery(e.target.value)}/>}
  <button className="mobile-goal-feature" onClick={onGoals}><span className="mobile-goal-icon"><AppIcon name="study"/></span><span>{goal?<><strong>{goal.title}</strong>{goal.targetAmount!==null?<GoalProgressBar node={goal}/>:<small>已完成 {goal.completedCount} / {goal.itemCount} 项分支</small>}</>:<><strong>给自己一个长期方向</strong><small>从一个想坚持的目标开始</small></>}</span><ControlIcon name="right"/></button>
  <div className="mobile-task-filter"><button aria-pressed={!completed} onClick={()=>setCompleted(false)}>待完成</button><button aria-pressed={completed} onClick={()=>setCompleted(true)}>已完成</button></div>
  {error&&<p role="alert" className="mobile-error">{error}</p>}
  <div className="mobile-task-list">{entries.map(([key,label,items])=>{const tasks=sortTasksByPriority(items.filter(t=>!query||[t.title,t.detail].join(' ').toLowerCase().includes(query.toLowerCase())),state.now);return <section className="mobile-task-group" key={key}><header><h2>{label}<small>{tasks.length}</small></h2><button className="mobile-round-button" aria-label={'在'+label+'新建任务'} onClick={onAdd}><ControlIcon name="plus"/></button></header>{tasks.length?tasks.map(task=>{const meta=urgencyMeta(task.urgency),open=expanded===task.id;return <article key={task.id} className={`mobile-task-card task-with-menu${open?' expanded':''}${completed?' done':''}`} style={{'--task-accent':meta.color} as React.CSSProperties}><button className={`check${completed?' checked':''}`} aria-label={(completed?'恢复：':'完成：')+task.title} onClick={()=>void getApi().invoke(completed?'task:reopen':'task:complete',{id:task.id}).catch(e=>setError(e.message))}/><div><button className="mobile-task-toggle" aria-expanded={open} onClick={()=>setExpanded(open?null:task.id)}><strong>{task.title}</strong><span className="mobile-task-meta"><span>{task.dueAt?task.dueAt.slice(0,10)===state.date?'今天 '+task.dueAt.slice(11,16):task.dueAt.slice(5,10).replace('-','月')+'日 '+task.dueAt.slice(11,16):'没有截止时间'}</span>{!completed&&<small className="mobile-urgency-tag">{meta.label}</small>}{task.pinned&&<small>置顶</small>}</span></button>{open&&<div className="mobile-task-expanded"><p>{task.detail||'还没有填写详细内容。'}</p><span>预计用时 {humanDuration(task.estMinutes??45)}</span><button className="ghost-btn" onClick={()=>onEdit(task.id)}>编辑与安排时间</button></div>}</div><TaskMenu task={task}/></article>;}):<div className="mobile-group-empty">{query?'没有匹配的任务':completed?'完成的事情会留在这里':'暂时没有待办，给自己留点余地'}</div>}</section>;})}</div>
 </div>;
}
