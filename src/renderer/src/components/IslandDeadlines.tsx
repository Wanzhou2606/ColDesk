import * as React from 'react';
import {t} from '@shared/i18n';
import {urgencyMeta} from '@shared/scoring';
import type {nearbyDeadlineTasks} from '@shared/taskActions';
import {TaskMenu} from './TaskMenu';
import {getApi} from '../lib/api';

export function IslandDeadlines({groups}:{groups:ReturnType<typeof nearbyDeadlineTasks>}){
 return <section className="island-deadlines" aria-label="今天和明天截止的任务">{(['today','tomorrow'] as const).map(day=><div key={day} className={'island-deadline-group '+day}>
  <h3><span>{day==='today'?t('今天截止'):t('明天截止')}</span><small>{groups[day].length}</small></h3>
  {groups[day].length?<ul>{groups[day].map(({task,overdue})=><li key={task.id} data-deadline-task={task.id} data-task-id={task.id} className={overdue?'is-overdue':''}><span className="island-deadline-dot" style={{background:urgencyMeta(task.urgency).color}}/><button type="button" className="island-deadline-open" title={task.title} onClick={()=>void getApi().invoke('task:openEditor',{id:task.id,field:'all'})}><strong>{task.title}</strong><span>{task.dueAt?.slice(11,16)}{overdue?' · '+t('已截止'):''}</span></button><TaskMenu task={task}/></li>)}</ul>:<p>{day==='today'?t('今天没有截止任务'):t('明天没有截止任务')}</p>}
 </div>)}</section>;
}
