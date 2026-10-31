import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.COLDESK_DB_FACTORY='fake';
describe('课表删除：范围、备份和防止旧课表回流',()=>{
  let db:typeof import('../db'), repo:typeof import('../db/repositories'), maintenance:typeof import('../timetableMaintenance');
  const fresh=(dir?:string)=>{db.closeDatabase();db.initDatabase(dir??'.',dir?'coldesk.db':':memory:');const d=db.getDb();
    for(const id of ['old','current']){d.prepare('INSERT INTO semester(id,name,start_date,total_weeks,is_active,created_at,updated_at) VALUES(?,?,?,20,?,?,?)').run(id,id,'2026-09-14',id==='current'?1:0,'now','now');repo.upsertCourse({id:'c-'+id,semesterId:id,name:id});repo.upsertSession({id:'s-'+id,courseId:'c-'+id,weekday:1,startSlot:1,endSlot:1});}
    d.prepare("INSERT INTO course_session_override(id,session_id,date,kind,created_at,updated_at) VALUES('o','s-current','2026-10-26','cancel','now','now')").run();
    d.prepare("INSERT INTO home_entry(date,payload,updated_at) VALUES('2026-10-30','private diary','now')").run();
    d.prepare("INSERT INTO task(id,title,type,urgency,course_id,created_at,updated_at) VALUES('task','保留的任务','todo',3,'c-current','now','now')").run();
    repo.saveTimeSlots('current','绍兴',[{slotIndex:1,startTime:'08:40',endTime:'09:25',period:'am'}]);
  };
  before(async()=>{db=await import('../db');repo=await import('../db/repositories');maintenance=await import('../timetableMaintenance');});after(()=>db.closeDatabase());
  it('只删除当前课程、安排与调课；个人记录、旧学期与作息保留，旧课表不会被当作当前',()=>{
    fresh();const d=db.getDb(),personal=()=>JSON.stringify([d.prepare('SELECT * FROM home_entry').all(),d.prepare('SELECT * FROM task').all()]);const before=personal();
    assert.equal(maintenance.deleteCurrentTimetable('current').count,1);assert.equal(repo.getCourses('current').length,0);assert.equal(repo.getSessions().filter(s=>s.courseId==='c-current').length,0);assert.equal(repo.getOverrides().length,0);
    assert.equal(repo.getActiveSemester()?.id,'current');assert.equal(repo.getCourses('old').length,1);assert.equal(maintenance.currentTimetable().count,0);assert.equal(repo.getTimeSlots('current','绍兴').length,1);assert.equal(personal(),before);
    assert.equal(d.prepare('PRAGMA foreign_key_check').all().length,0);
  });
  it('过期确认或非法参数不改变课表',()=>{fresh();for(const id of [null,'old','missing',{}])assert.throws(()=>maintenance.deleteCurrentTimetable(id),/已变化/);assert.equal(repo.getCourses('current').length,1);});
  it('真实数据库删除前生成可打开的完整备份，备份失败就不删除',()=>{
    const dir=mkdtempSync(join(tmpdir(),'coldesk-timetable-delete-'));fresh(dir);const result=maintenance.deleteCurrentTimetable('current');assert.ok(result.backup);const backup=new DatabaseSync(result.backup,{readOnly:true});assert.equal((backup.prepare("SELECT count(*) AS n FROM course WHERE semester_id='current' AND deleted_at IS NULL").get() as any).n,1);assert.equal(backup.prepare('SELECT payload FROM home_entry').get()?.payload,'private diary');backup.close();
    // Simulate backup failure to prove deletion cannot proceed without a complete backup.
    db.closeDatabase();const failed=mkdtempSync(join(tmpdir(),'coldesk-timetable-delete-'));fresh(failed);const original=db.getDb().exec.bind(db.getDb());db.getDb().exec=(sql:string)=>{if(sql.startsWith('VACUUM INTO'))throw Error('disk full');original(sql);};
    assert.throws(()=>maintenance.deleteCurrentTimetable('current'),/备份未能完成/);assert.equal(repo.getCourses('current').length,1);
  });
});
