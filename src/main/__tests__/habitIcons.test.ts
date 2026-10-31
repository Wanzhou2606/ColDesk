import {strict as assert} from 'node:assert';
import {before,after,describe,it} from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HABIT_ICONS,normalizeHabitIcon} from '../../shared/habitIcons';
import {addDays} from '../../shared/time';
process.env.COLDESK_DB_FACTORY='fake';

describe('打卡图标与归档找回',()=>{
 let db:any,repo:any,store:any;
 before(async()=>{db=await import('../db');repo=await import('../db/repositories');store=(await import('../store')).store;});after(()=>db.closeDatabase());
 const fresh=()=>{db.closeDatabase();db.initDatabase('.',':memory:');store.load();store.setHabitMonth(store.getState().date.slice(0,7));};
 it('20 个常用图标完整且不重复，保留变体选择符和旧自定义图标',()=>{
  assert.equal(HABIT_ICONS.length,20);assert.equal(new Set(HABIT_ICONS.map(item=>item.icon)).size,20);
  for(const {icon} of HABIT_ICONS)assert.equal(normalizeHabitIcon(icon),icon);
  for(const icon of ['🗣️','☀️','✍️','🌅','👩‍💻'])assert.equal(normalizeHabitIcon(icon),icon);
  assert.equal(normalizeHabitIcon(undefined),undefined);assert.equal(normalizeHabitIcon(''),undefined);
  for(const icon of ['⭐📚','<img>','\ud83d','\udc00',false,{},'a'.repeat(40)]){
   assert.throws(()=>normalizeHabitIcon(icon));
  }
 });
 it('图标可新建、修改与读取，修改时不改变名称、开始日期和打卡记录',()=>{
  fresh();for(const option of HABIT_ICONS)repo.createHabit({name:option.label,icon:normalizeHabitIcon(option.icon)});
  assert.deepEqual(repo.getHabits().map((habit:any)=>habit.icon),HABIT_ICONS.map(option=>option.icon));
  const task=repo.getHabits()[3],date=store.getState().date;repo.setCheckin(task.id,date,true);repo.updateHabit(task.id,{icon:normalizeHabitIcon('✍️')});
  const changed=repo.getHabits().find((h:any)=>h.id===task.id);assert.equal(changed.icon,'✍️');assert.equal(changed.name,task.name);assert.equal(changed.startDate,task.startDate);assert.ok(repo.isCheckedOn(task.id,date));
 });
 it('归档后可在状态中找回，移出日常列表和当前统计；恢复后原记录仍在',()=>{
  fresh();const date=store.getState().date,yesterday=addDays(date,-1),task=repo.createHabit({name:'每日阅读',icon:'📚',startDate:yesterday});
  repo.setCheckin(task.id,yesterday,true);repo.setCheckin(task.id,date,true);store.refresh();assert.ok(store.getState().habit.today.cells.find((cell:any)=>cell.habit.id===task.id).done);
  repo.updateHabit(task.id,{archived:true});store.refresh();let view=store.getState().habit;
  assert.ok(view.archivedHabits.some((h:any)=>h.id===task.id));assert.ok(!view.habits.some((h:any)=>h.id===task.id));assert.equal(view.today.cells.length,0);assert.equal(view.board.totals.expected,0);
  assert.ok(repo.isCheckedOn(task.id,yesterday));assert.ok(repo.isCheckedOn(task.id,date));
  repo.updateHabit(task.id,{archived:false});store.refresh();view=store.getState().habit;
  assert.ok(!view.archivedHabits.some((h:any)=>h.id===task.id));assert.ok(view.today.cells.find((cell:any)=>cell.habit.id===task.id).done);assert.equal(view.habits[0].startDate,yesterday);assert.ok(view.board.totals.done>=1);assert.equal(repo.getCheckins(yesterday,date).filter((row:any)=>row.habitId===task.id).length,2);
 });
 it('关闭再打开数据库后，已归档习惯、完整图标及历史签到都能恢复',()=>{
  db.closeDatabase();const dir=mkdtempSync(join(tmpdir(),'coldesk-habit-icons-'));db.initDatabase(dir);store.load();const date=store.getState().date,task=repo.createHabit({name:'练习写作',icon:'✍️'});repo.setCheckin(task.id,date,true);repo.updateHabit(task.id,{archived:true});
  db.closeDatabase();db.initDatabase(dir);store.load();const archived=store.getState().habit.archivedHabits.find((h:any)=>h.id===task.id);assert.equal(archived.icon,'✍️');assert.ok(repo.isCheckedOn(task.id,date));
  repo.updateHabit(task.id,{archived:false});store.refresh();assert.ok(store.getState().habit.today.cells.find((cell:any)=>cell.habit.id===task.id).done);
 });
});
