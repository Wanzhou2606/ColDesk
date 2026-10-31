import {strict as assert} from 'node:assert';
import {before,after,describe,it} from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateTaskSegments,segmentNumber} from '../../shared/taskSegments';
process.env.COLDESK_DB_FACTORY='fake';
describe('任务自由分段与原子保存',()=>{
 let db:any,repo:any,store:any,events:any;
 before(async()=>{db=await import('../db');repo=await import('../db/repositories');store=(await import('../store')).store;events=await import('../calendarEvents');});after(()=>db.closeDatabase());
 const fresh=()=>{db.closeDatabase();db.initDatabase('.',':memory:');store.load();};
 const row=(day:string,start:string,end:string)=>({startAt:day+'T'+start,endAt:day+'T'+end});
 it('日期、时长、同任务重叠与午夜校验，时间顺序决定编号',()=>{
  assert.deepEqual([1,2,3,20,21,35,36,50,51].map(segmentNumber),['①','②','③','⑳','㉑','㉟','㊱','㊿','(51)']);
  assert.equal(validateTaskSegments([row('2030-10-08','00:00','24:00')])[0].plannedMinutes,1440);
  const sorted=validateTaskSegments([row('2030-10-09','13:02','14:11'),row('2030-10-08','09:37','10:08')]);assert.equal(sorted[0].plannedMinutes,31);
  for(const rows of [[row('2030-02-30','09:00','10:00')],[row('2030-10-08','10:00','09:00')],[row('2030-10-08','10:00','10:00')],[row('2030-10-08','10:00','11:00'),row('2030-10-08','10:59','12:00')]])assert.throws(()=>validateTaskSegments(rows));
  assert.doesNotThrow(()=>validateTaskSegments([row('2030-10-08','10:00','11:00'),row('2030-10-08','11:00','12:00')]));
 });
 it('一个任务可设置多天多段，任务列表仍一项，日程按全局时间顺序标号',()=>{
  fresh();store.updateTask({title:'读一本书',urgency:3},[row('2030-10-09','16:30','17:10'),row('2030-10-08','09:37','10:08'),row('2030-10-08','18:05','18:50')]);
  const task=repo.getTasks()[0];assert.equal(repo.getTasks().length,1);assert.equal(repo.getBlocksForTask(task.id).length,3);
  assert.equal(store.getState().taskSegments.length,3);
  assert.deepEqual(store.scheduleView('2030-10-08').timeline.map((b:any)=>b.title),['读一本书 ①','读一本书 ②']);
  assert.equal(store.scheduleView('2030-10-09').timeline[0].title,'读一本书 ③');
  assert.equal(store.scheduleView('2030-10-08').week.days[1].blocks[0].title,'读一本书 ③');
 });
 it('拖入新增分段，拖动原分段只修改该记录，重复或重叠不写入',()=>{
  fresh();const task=repo.saveTask({title:'分段拖动',urgency:3});
  store.placeTask({taskId:task.id,startAt:'2030-10-08T09:37',durationMinutes:31});const first=repo.getBlocksForTask(task.id)[0];
  store.placeTask({taskId:task.id,startAt:'2030-10-08T13:12',durationMinutes:38});
  assert.equal(repo.getBlocksForTask(task.id).length,2);const second=repo.getBlocksForTask(task.id)[1];
  store.placeTask({taskId:task.id,blockId:first.id,startAt:'2030-10-09T11:07',durationMinutes:53});
  assert.equal(repo.getBlocksForTask(task.id).length,2);assert.deepEqual(repo.getBlocksForTask(task.id).find((b:any)=>b.id===second.id),second);
  const before=JSON.stringify(repo.getBlocksForTask(task.id));
  assert.throws(()=>store.placeTask({taskId:task.id,startAt:second.startAt,durationMinutes:38}),/冲突/);
  assert.throws(()=>store.placeTask({taskId:task.id,blockId:first.id,startAt:'2030-10-08T13:30',durationMinutes:20}),/冲突/);
  assert.equal(JSON.stringify(repo.getBlocksForTask(task.id)),before);
 });
 it('分段可增删、跨日修改并整体清空，不会删除任务或其他任务的安排',()=>{
  fresh();const task=repo.saveTask({title:'调整段数',urgency:3}),other=repo.saveTask({title:'其他任务',urgency:3});
  store.saveTaskSegments(task.id,[row('2030-10-08','09:00','10:00'),row('2030-10-08','11:00','12:00')]);
  store.saveTaskSegments(other.id,[row('2030-10-08','15:00','16:00')]);const keep=repo.getBlocksForTask(task.id)[1],otherBefore=repo.getBlocksForTask(other.id);
  store.saveTaskSegments(task.id,[{id:keep.id,...row('2030-10-10','17:11','18:12')},row('2030-10-09','09:20','10:30'),row('2030-10-11','12:00','13:00')]);
  assert.equal(repo.getBlocksForTask(task.id).length,3);assert.ok(repo.getBlocksForTask(task.id).some((b:any)=>b.id===keep.id));assert.deepEqual(repo.getBlocksForTask(other.id),otherBefore);
  store.returnTaskToBar(task.id,'2030-10-09');assert.equal(repo.getBlocksForTask(task.id).length,2);
  store.saveTaskSegments(task.id,[]);assert.equal(repo.getBlocksForTask(task.id).length,0);assert.ok(repo.getTask(task.id));assert.deepEqual(repo.getBlocksForTask(other.id),otherBefore);
 });
 it('课程仍会检查冲突；任何分段保存失败都保留原任务内容和全部安排',()=>{
  fresh();const task=repo.saveTask({title:'原名称',urgency:3,detail:'原内容'});store.saveTaskSegments(task.id,[row('2030-10-08','09:00','10:00')]);
  events.saveCalendarEvent({title:'讲座',detail:'',type:'lecture',...row('2030-10-08','15:00','16:00')});
  const before=JSON.stringify(repo.getBlocksForTask(task.id));
  assert.throws(()=>store.editTask(task.id,{title:'不能部分保存',detail:'不能丢失原内容'},[row('2030-10-08','11:00','12:00'),row('2030-10-08','15:30','16:30')]),/冲突/);
  assert.equal(repo.getTask(task.id).title,'原名称');assert.equal(repo.getTask(task.id).detail,'原内容');assert.equal(JSON.stringify(repo.getBlocksForTask(task.id)),before);
  assert.throws(()=>store.updateTask({title:'冲突时不创建半成品任务',urgency:3},[row('2030-10-08','15:30','16:30')]),/冲突/);assert.equal(repo.getTasks().length,1);
  assert.throws(()=>store.saveTaskSegments(task.id,[{id:'foreign-or-stale',...row('2030-10-08','17:00','18:00')}]),/已更新/);
 });
 it('数据库中途写入失败时全部回退，任务文字、提醒和原分段保持完整',()=>{
  fresh();const task=repo.saveTask({title:'写入失败前的标题',urgency:3});store.saveTaskSegments(task.id,[row('2030-10-08','09:00','10:00')]);
  const before=JSON.stringify(repo.getBlocksForTask(task.id));
  db.getDb().exec("CREATE TEMP TRIGGER segment_write_failure BEFORE INSERT ON schedule_block WHEN NEW.start_at='2030-10-08T17:00' BEGIN SELECT RAISE(ABORT,'test segment write failure'); END;");
  try{assert.throws(()=>store.editTask(task.id,{title:'不应该被保存的标题'},[row('2030-10-08','14:00','15:00'),row('2030-10-08','17:00','18:00')]),/test segment write failure/);}finally{db.getDb().exec('DROP TRIGGER segment_write_failure');}
  assert.equal(repo.getTask(task.id).title,'写入失败前的标题');assert.equal(JSON.stringify(repo.getBlocksForTask(task.id)),before);
  assert.doesNotThrow(()=>store.editTask(task.id,{detail:'连接仍可正常保存'}));
 });
 it('重启保留多个日期的全部分段，减少为一段后去掉编号',()=>{
  db.closeDatabase();const folder=mkdtempSync(join(tmpdir(),'coldesk-segments-'));db.initDatabase(folder);store.load();
  const task=repo.saveTask({title:'重启保留',urgency:3});store.saveTaskSegments(task.id,[row('2030-10-08','10:17','11:13'),row('2030-10-08','14:07','15:31'),row('2030-10-10','21:00','24:00')]);
  db.closeDatabase();db.initDatabase(folder);store.load();assert.equal(repo.getBlocksForTask(task.id).length,3);assert.equal(store.getState().taskSegments.length,3);
  const keep=repo.getBlocksForTask(task.id)[0];store.saveTaskSegments(task.id,[{id:keep.id,startAt:keep.startAt,endAt:keep.endAt}]);assert.equal(store.scheduleView('2030-10-08').timeline[0].title,'重启保留');
 });
});
