import {strict as assert} from 'node:assert';
import {before,after,describe,it} from 'node:test';
process.env.COLDESK_DB_FACTORY='fake';
describe('提醒刷新不会制造垃圾数据',()=>{
 let db:typeof import('../db'),repo:typeof import('../db/repositories');
 before(async()=>{db=await import('../db');repo=await import('../db/repositories');db.initDatabase('.',':memory:');});after(()=>db.closeDatabase());
 const task=()=>repo.saveTask({title:'提醒回归',domain:'study',type:'todo',urgency:3,dueAt:'2027-01-05T18:00'});
 const drafts=[{fireAt:'2027-01-05T16:00',level:'h2',reason:'两小时后'}],meta={title:'提醒回归',urgency:3};
 it('反复刷新保持提醒ID，已发出的提醒不重新创建',()=>{
  const t=task();repo.replaceRemindersForTask(t.id,drafts,meta);const first=repo.getPendingReminders().find(r=>r.taskId===t.id)!;repo.setReminderState(first.id,'fired');for(let i=0;i<100;i++)repo.replaceRemindersForTask(t.id,drafts,meta);const rows=db.getDb().prepare('SELECT id,state FROM reminder WHERE task_id=?').all(t.id);assert.deepEqual(rows,[{id:first.id,state:'fired'}]);
 });
 it('稍后提醒刷新后保留，修改截止时间只替换原来的普通提醒',()=>{
  const t=task();repo.replaceRemindersForTask(t.id,drafts,meta);const old=repo.getPendingReminders().find(r=>r.taskId===t.id)!;repo.snoozeReminder(old.id,'2027-01-05T16:10');repo.replaceRemindersForTask(t.id,[{...drafts[0],fireAt:'2027-01-05T17:00'}],meta);const rows=repo.getPendingReminders().filter(r=>r.taskId===t.id);assert.equal(rows.length,2);assert.ok(rows.some(r=>r.level==='snooze'&&r.fireAt==='2027-01-05T16:10'));
 });
 it('历史重复合并时保留已触发状态，失效任务的派生提醒清掉且不删任务',()=>{
  const t=task();repo.replaceRemindersForTask(t.id,drafts,meta);const first=repo.getPendingReminders().find(r=>r.taskId===t.id)!;repo.setReminderState(first.id,'fired');db.getDb().prepare("INSERT INTO reminder(id,task_id,fire_at,level,state,created_at,updated_at) VALUES('dupe',?,?,?,'pending','t','t')").run(t.id,drafts[0].fireAt,'h2');repo.replaceRemindersForTask(t.id,drafts,meta);assert.equal((db.getDb().prepare('SELECT count(*) AS n FROM reminder WHERE task_id=?').get(t.id) as any).n,1);assert.equal(repo.getPendingReminders().filter(r=>r.taskId===t.id).length,0);repo.setTaskStatus(t.id,'done');repo.pruneInactiveTaskReminders();assert.equal((db.getDb().prepare('SELECT count(*) AS n FROM reminder WHERE task_id=?').get(t.id) as any).n,0);assert.equal(repo.getTask(t.id)!.status,'done');
 });
 it('只清理废弃自动编排，手动安排与历史任务保持原样',()=>{
  const t=task(),insert=db.getDb().prepare("INSERT INTO schedule_block(id,task_id,date,start_at,end_at,planned_minutes,locked,origin,created_at,updated_at,deleted_at) VALUES(?,?,'2027-01-05','2027-01-05T09:00','2027-01-05T10:00',60,?,?,'t','t',?)");
  insert.run('cache-auto',t.id,0,'auto','t');insert.run('history-manual',t.id,1,'manual','t');insert.run('current-manual',t.id,1,'manual',null);repo.cleanDerivedData();
  assert.equal((db.getDb().prepare("SELECT count(*) AS n FROM schedule_block WHERE id='cache-auto'").get() as any).n,0);assert.equal((db.getDb().prepare("SELECT count(*) AS n FROM schedule_block WHERE id IN ('history-manual','current-manual')").get() as any).n,2);assert.ok(repo.getTask(t.id));
 });
});
