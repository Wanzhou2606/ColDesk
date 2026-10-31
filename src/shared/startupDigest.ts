import type {TodayView} from './view';
import {t} from './i18n';
export function startupDigest(state:TodayView){
 const lessons=state.timeline.filter(b=>b.kind==='lesson');
 const tasks=Object.values(state.buckets).flat().filter(t=>t.urgency>=4&&t.status!=='done'&&t.status!=='canceled');
 const body=[t('今日课程（{0}）',[lessons.length]),...lessons.map(l=>`${l.startAt.slice(11,16)}–${l.endAt.slice(11,16)}  ${l.title}${l.location?' · '+l.location:''}`),...(!lessons.length?[t('今天没有课程')]:[]),'',t('紧急任务（{0}）',[tasks.length]),...tasks.map(task=>`${task.title}${task.dueAt?' · '+task.dueAt.replace('T',' '):''}`),...(!tasks.length?[t('暂无紧急任务')]:[])].join('\n');
 return {title:t('今日课程与紧急任务'),body};
}
