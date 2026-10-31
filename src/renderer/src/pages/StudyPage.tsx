import * as React from 'react';
import {useEffect,useState} from 'react';
import type {TodayView} from '@shared/view';
import {taskPageGroups,type TaskPageGroup} from '@shared/taskActions';
import {t} from '@shared/i18n';
import {TaskForm} from '../components/TaskForm';
import {TaskList} from '../components/TaskList';

const GROUPS:Array<{id:TaskPageGroup;title:string;hint:string;empty:string}>=[
 {id:'today',title:'今日',hint:'今天截止及已逾期',empty:'今天没有待办，也没有逾期任务'},
 {id:'threeDays',title:'近三天',hint:'明天至三天后截止',empty:'未来三天暂无截止任务'},
 {id:'week',title:'近一周',hint:'四至七天后截止',empty:'四至七天后暂无截止任务'},
 {id:'later',title:'更远',hint:'七天以后或未设置截止时间',empty:'暂无更远的任务'}
];
export function StudyPage({state,quickAddSignal}:{state:TodayView|null;quickAddSignal:number}){
 const [showForm,setShowForm]=useState(false);
 useEffect(()=>{if(quickAddSignal>0)setShowForm(true);},[quickAddSignal]);
 const groups=taskPageGroups(state);
 return <div className="page task-page">
  <header className="page-head"><div><h1 className="page-title">任务</h1><div className="t-caption">按截止时间与紧迫程度管理所有待办 · 今天 {state?.summary.dueTodayCount??0} 项截止</div></div><button className="primary-btn lg" onClick={()=>setShowForm(value=>!value)}>{showForm?t('收起'):t('＋ 新建任务')}</button></header>
  {showForm&&<TaskForm courses={state?.courses??[]} defaultDomain="study" onDone={()=>setShowForm(false)}/>}
  <div className="task-date-groups" role="group" aria-label="待办任务">{GROUPS.map(group=><section className="panel task-date-group" key={group.id} data-task-group={group.id} aria-labelledby={'task-group-'+group.id}>
   <div className="panel-head"><div className="task-date-group-title"><span className="task-date-group-mark" aria-hidden="true"/><div><h2 className="t-title" id={'task-group-'+group.id}>{t(group.title)}</h2><p className="t-caption">{t(group.hint)}</p></div></div><span className="task-date-group-count">{t('{0} 项',[groups[group.id].length])}</span></div>
   <TaskList tasks={groups[group.id]} state={state} emptyHint={t(group.empty)}/>
  </section>)}</div>
  <details className="panel completed-task-panel"><summary>已完成</summary><TaskList tasks={state?.buckets.done??[]} state={state} emptyHint="暂无已完成任务"/></details>
 </div>;
}
