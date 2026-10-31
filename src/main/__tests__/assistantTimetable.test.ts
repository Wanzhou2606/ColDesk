import {strict as assert} from 'node:assert';
import {describe,it} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA_SQL} from '../db/schema';
import {readAssistantCourses} from '../assistantTimetable';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(SCHEMA_SQL);
 db.exec(`INSERT INTO semester VALUES('old','旧学期','2026-09-07',20,0,'t','t',NULL),('now','当前学期','2026-10-05',4,1,'t','t',NULL);
 INSERT INTO setting VALUES('campus','A','t');
 INSERT INTO course(id,semester_id,name,color,created_at,updated_at) VALUES('old','old','旧课程','#abc','t','t'),('new','now','课程甲','#abc','t','t');
 INSERT INTO time_slot VALUES('old','old',1,'am','07:00','07:45','A',0),('a1','now',1,'am','08:00','08:45','A',0),('a2','now',2,'am','08:55','09:40','A',0),('b1','now',1,'am','09:00','09:45','B',0),('bell','now',0,'am','07:50','07:50','A',1);
 INSERT INTO course_session(id,course_id,weekday,start_slot,end_slot,room,week_mode,week_list,created_at,updated_at) VALUES('old','old',1,1,1,'旧教室','all',NULL,'t','t'),('new','new',1,1,2,'A101','custom','1,3','t','t');`);
 return db;
}
describe('助手课表与应用共用展开规则',()=>{
 it('仅当前学期、当前校区，节次不减1，不包含预备铃',()=>{
  const db=fixture();try{const result=readAssistantCourses(db,{date:'2026-10-05',week:true});assert.equal(result.courses.length,1);assert.equal(result.courses[0].name,'课程甲');assert.equal(result.courses[0].time,'08:00-09:40');assert.equal(result.teachingWeek,1);}finally{db.close();}
 });
 it('自定义周次、单双周和学期边界均按查询日期计算',()=>{
  const db=fixture();try{assert.equal(readAssistantCourses(db,{date:'2026-10-12',week:true}).courses.length,0);assert.equal(readAssistantCourses(db,{date:'2026-10-19',weekday:1}).courses.length,1);assert.equal(readAssistantCourses(db,{date:'2026-11-02',week:true}).courses.length,0);
   db.exec("UPDATE course_session SET week_mode='even' WHERE id='new'");assert.equal(readAssistantCourses(db,{date:'2026-10-05'}).courses.length,0);assert.equal(readAssistantCourses(db,{date:'2026-10-12'}).courses.length,1);
  }finally{db.close();}
 });
 it('相同课程不同周教室不同时不会全部展开，直接时刻优先',()=>{
  const db=fixture();try{db.exec("UPDATE course_session SET start_time='10:25',end_time='12:00',week_list='1' WHERE id='new'; INSERT INTO course_session(id,course_id,weekday,start_slot,end_slot,start_time,end_time,room,week_mode,week_list,created_at,updated_at) VALUES('other','new',1,1,1,'10:25','12:00','B202','custom','2','t','t')");const result=readAssistantCourses(db,{date:'2026-10-12'});assert.equal(result.courses.length,1);assert.equal(result.courses[0].room,'B202');assert.equal(result.courses[0].time,'10:25-12:00');}finally{db.close();}
 });
 it('停课和调课与应用一致，已删除课程不出现',()=>{
  const db=fixture();try{db.exec("INSERT INTO course_session_override(id,session_id,date,kind,new_date,new_start_slot,new_end_slot,created_at,updated_at) VALUES('move','new','2026-10-05','reschedule','2026-10-06',2,2,'t','t')");assert.equal(readAssistantCourses(db,{date:'2026-10-05'}).courses.length,0);const moved=readAssistantCourses(db,{date:'2026-10-06'}).courses;assert.equal(moved.length,1);assert.equal(moved[0].time,'08:55-09:40');assert.equal(moved[0].rescheduled,true);db.exec("UPDATE course SET deleted_at='t' WHERE id='new'");assert.equal(readAssistantCourses(db,{date:'2026-10-06'}).courses.length,0);}finally{db.close();}
 });
 it('缺少课表返回空结果；无效日期和星期拒绝，不回退成别的日期',()=>{
  const db=fixture();try{assert.throws(()=>readAssistantCourses(db,{date:'2026-02-30'}));assert.throws(()=>readAssistantCourses(db,{weekday:8}));db.exec("UPDATE semester SET deleted_at='t'");assert.deepEqual(readAssistantCourses(db,{date:'2026-10-05'}).courses,[]);}finally{db.close();}
 });
});
