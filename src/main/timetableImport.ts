import { createHash } from 'node:crypto';
import { parseTimetable, timetableWarnings, TIMETABLE_PROMPT } from '@shared/timetableImport';
import type { TimetableImport } from '@shared/timetableImport';
import { getDb, backupIfNeeded } from './db';
import { getActiveSemester, getActiveCampus, getTimeSlots, setActiveCampus, upsertCourse, upsertSession, getCourses, getSessions } from './db/repositories';
import { nowLocal, addDays } from '@shared/time';
import { matchesByRule } from '@shared/timetable';
import { store } from './store';

export function previewTimetable(input:unknown) {const data=parseTimetable(input);return {data,warnings:timetableWarnings(data),existing:getActiveSemester()};}
export function importTimetable(input:{text?:unknown;mode?:unknown}) {
  const data=parseTimetable(input?.text);
  return importValidatedTimetable(data,input?.mode);
}
/** 仅由主进程调用，数据已来自受限的订阅读取与校验。 */
export function importValidatedTimetable(data:TimetableImport,mode:unknown) {
  if(!['append','replace'].includes(String(mode)))throw new Error('请选择添加或切换课表');
  if(timetableWarnings(data).length)throw new Error('课表存在重叠，请先修正再导入');
  const old=getActiveSemester(),append=mode==='append'&&!!old,campus=append?getActiveCampus():'导入课表';
  if(append){
    const current=getTimeSlots(old!.id,campus).filter(s=>!s.isPrepareBell);
    if(old!.startDate!==data.semester.startDate||old!.totalWeeks!==data.semester.totalWeeks||data.timeSlots.some(t=>!current.some(c=>c.slotIndex===t.slot&&c.startTime===t.start&&c.endTime===t.end)))throw new Error('学期或节次时间与现有课表不同，请选择“切换为这份课表”');
  }
  const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24),id=append?old!.id:'semester_import_'+digest(data.semester),ts=nowLocal();
  if(append){const courses=getCourses(old!.id),existing=getSessions().filter(s=>courses.some(c=>c.id===s.courseId));
    const slots=getTimeSlots(old!.id,campus).filter(s=>!s.isPrepareBell);
    for(const course of data.courses){const courseId='course_import_'+digest([id,course.name,course.teacher]);for(const session of course.sessions){const sessionId='session_import_'+digest([courseId,session]);for(const prior of existing){if(prior.id===sessionId||prior.weekday!==session.weekday)continue;
      const start=session.startTime??data.timeSlots.find(t=>t.slot===session.startSlot)?.start,end=session.endTime??data.timeSlots.find(t=>t.slot===session.endSlot)?.end,priorStart=prior.startTime??slots.find(t=>t.slotIndex===prior.startSlot)?.startTime,priorEnd=prior.endTime??slots.find(t=>t.slotIndex===prior.endSlot)?.endTime;
      const overlaps=start&&end&&priorStart&&priorEnd?start<priorEnd&&priorStart<end:prior.startSlot<=session.endSlot&&prior.endSlot>=session.startSlot;
      if(!overlaps)continue;
      if(session.weeks.some(w=>matchesByRule(prior,addDays(data.semester.startDate,(w-1)*7+session.weekday-1),old!)))throw new Error(`${course.name} 与现有课表的 ${courses.find(c=>c.id===prior.courseId)?.name} 存在时间冲突，请检查后再添加`);
    }}}
  }
  backupIfNeeded();
  getDb().transaction(()=>{
    if(!append){
      getDb().prepare('UPDATE semester SET is_active=0').run();
      getDb().prepare('INSERT INTO semester (id,name,start_date,total_weeks,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_date=excluded.start_date,total_weeks=excluded.total_weeks,is_active=1,updated_at=excluded.updated_at,deleted_at=NULL').run(id,data.semester.name,data.semester.startDate,data.semester.totalWeeks,ts,ts);
      // 替换同学期的旧安排，记录仍留在库中供备份恢复。
      getDb().prepare('UPDATE course SET deleted_at=?,updated_at=? WHERE semester_id=?').run(ts,ts,id);
      getDb().prepare('UPDATE course_session SET deleted_at=?,updated_at=? WHERE course_id IN (SELECT id FROM course WHERE semester_id=?)').run(ts,ts,id);
      getDb().prepare('DELETE FROM time_slot WHERE semester_id=? AND campus=?').run(id,campus);
      for(const t of data.timeSlots)getDb().prepare('INSERT INTO time_slot (id,semester_id,slot_index,period,start_time,end_time,campus,is_prepare_bell) VALUES (?,?,?,?,?,?,?,0)').run('slot_import_'+digest([id,campus,t.slot]),id,t.slot,t.start<'12:00'?'am':t.start<'18:00'?'pm':'eve',t.start,t.end,campus);
      setActiveCampus(campus);
    }
    for(const course of data.courses){
      const courseId='course_import_'+digest([id,course.name,course.teacher]);
      upsertCourse({id:courseId,semesterId:id,name:course.name,teacher:course.teacher});
      getDb().prepare('UPDATE course SET deleted_at=NULL WHERE id=?').run(courseId);
      for(const session of course.sessions){
        const sessionId='session_import_'+digest([courseId,session]);
        upsertSession({id:sessionId,courseId,weekday:session.weekday,startSlot:session.startSlot,endSlot:session.endSlot,startTime:session.startTime,endTime:session.endTime,room:session.room,weekMode:'custom',weekList:session.weeks.join(',')});
        getDb().prepare('UPDATE course_session SET deleted_at=NULL WHERE id=?').run(sessionId);
      }
    }
  })();
  store.reloadSnapshot();store.replan();store.refresh();return {count:data.courses.length,sessions:data.courses.reduce((sum,c)=>sum+c.sessions.length,0)};
}
export { TIMETABLE_PROMPT };
