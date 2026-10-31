import * as React from 'react';
import type {TodayView} from '@shared/view';
import {StudyPage} from './StudyPage';
/** Both legacy destinations lead to the same task list. */
export function TasksPage({state,quickAddSignal}:{state:TodayView|null;quickAddSignal:number;initialDomain?:'study'|'life'}){
 return <div className="tasks-workspace"><StudyPage state={state} quickAddSignal={quickAddSignal}/></div>;
}
