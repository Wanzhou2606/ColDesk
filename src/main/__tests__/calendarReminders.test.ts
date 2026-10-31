import {strict as assert} from 'node:assert';
import {before,after,describe,it} from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isReminderEvent,validateCalendarEvent,eventTimeLabel} from '../../shared/calendarEvents';
process.env.COLDESK_DB_FACTORY='fake';

describe('无结束时间的单次事件提醒',()=>{
 let db:any,events:any,store:any,repo:any;
 before(async()=>{db=await import('../db');events=await import('../calendarEvents');store=(await import('../store')).store;repo=await import('../db/repositories');});
 after(()=>db.closeDatabase());
 const fresh=()=>{db.closeDatabase();db.initDatabase('.',':memory:');store.load();};
 const input={title:'出发前带上证件',detail:'学生证与身份证',type:'activity',startAt:'2030-10-20T08:40'};
 it('结束时间为空、缺省或 null 保存为时间点，开始时间仍必填',()=>{
  for(const endAt of [undefined,null,'']){const value=validateCalendarEvent({...input,endAt});assert.ok(isReminderEvent(value));assert.equal(eventTimeLabel(value),'08:40');}
  for(const startAt of ['',undefined,'2030-02-30T08:40','2030-10-20T24:00'])assert.throws(()=>validateCalendarEvent({...input,startAt}),/开始时间/);
  for(const endAt of ['2030-10-20T08:40','2030-10-20T08:39','2030-10-21T09:00','2030-10-20T24:01'])assert.throws(()=>validateCalendarEvent({...input,endAt}),/结束需晚于开始/);
  assert.equal(validateCalendarEvent({...input,endAt:'2030-10-20T24:00'}).endAt,'2030-10-20T24:00');
 });
 it('时间点保留在日视图和周视图，同时允许任务跨过提醒时间',()=>{
  fresh();const id=events.saveCalendarEvent(input);store.reloadSnapshot();
  const view=store.scheduleView('2030-10-20');
  assert.ok(view.timeline.some((b:any)=>b.eventId===id&&b.startAt===b.endAt));
  const week=view.week.days.flatMap((d:any)=>d.blocks).find((b:any)=>b.eventId===id);
  assert.equal(week.timeLabel,'08:40');assert.equal(week.startMinute,week.endMinute);
  const task=repo.saveTask({title:'可以同时进行的安排',urgency:3});
  assert.doesNotThrow(()=>store.placeTask({taskId:task.id,startAt:'2030-10-20T08:30',durationMinutes:60}));
  assert.equal(repo.getBlocksForTask(task.id)[0].endAt,'2030-10-20T09:30');
 });
 it('到点只取出一次；编辑文字、反复刷新或重载后不会重发',()=>{
  fresh();const id=events.saveCalendarEvent(input);
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T08:39'),[]);
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T08:40').map((e:any)=>e.id),[id]);
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T08:41'),[]);
  events.saveCalendarEvent({...input,id,title:'改了标题但无需重发'});store.load();
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T08:42'),[]);
  events.saveCalendarEvent({...input,id,startAt:'2030-10-20T09:40'});
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T09:40').map((e:any)=>e.id),[id]);
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T09:41'),[]);
 });
 it('关闭数据库再打开仍记得已经提醒，休眠补发一次，删除和时间段事件不弹提醒',()=>{
  db.closeDatabase();const dir=mkdtempSync(join(tmpdir(),'coldesk-point-reminders-'));db.initDatabase(dir);
  const id=events.saveCalendarEvent(input);assert.equal(events.takeDueCalendarReminders('2030-10-20T08:40').length,1);
  db.closeDatabase();db.initDatabase(dir);assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T08:41'),[]);
  const missed=events.saveCalendarEvent({...input,title:'唤醒后提醒',startAt:'2030-10-20T09:00'});
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T10:00').map((e:any)=>e.id),[missed]);
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T10:01'),[]);
  events.saveCalendarEvent({...input,title:'时间段日程',startAt:'2030-10-20T10:00',endAt:'2030-10-20T11:00'});
  const deleted=events.saveCalendarEvent({...input,title:'删除后不提醒',startAt:'2030-10-20T10:00'});events.deleteCalendarEvent(deleted);
  events.saveCalendarEvent({...input,title:'太久之前的提醒',startAt:'2030-10-18T10:00'});
  assert.deepEqual(events.takeDueCalendarReminders('2030-10-20T10:01'),[]);
  assert.ok(events.getCalendarEvents().some((event:any)=>event.id===id));
 });
});
