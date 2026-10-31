import {strict as assert} from 'node:assert';
import {before,after,describe,it} from 'node:test';
import {visibleGoalNodes} from '../../shared/goals';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.COLDESK_DB_FACTORY='fake';
describe('长期任务与任意深度分支',()=>{
 let db:any,goals:any;
 before(async()=>{db=await import('../db/index.ts');goals=await import('../goals.ts');db.initDatabase('.',':memory:');});
 after(()=>db.closeDatabase());
 it('新建不要求预设步骤总数',()=>{const root=goals.saveGoal({title:'学习日语'});const list=goals.listGoals();assert.equal(list.length,1);assert.equal(list[0].itemCount,0);assert.equal(list[0].id,root);assert.equal(goals.readGoal(root).nodes.length,1);});
 it('完成时间持久保存，重复完成幂等，新增子项重新打开祖先并保留历史',()=>{const root=goals.saveGoal({title:'完成时间测试'}),child=goals.saveGoal({parentId:root,title:'五十音'});assert.throws(()=>goals.completeGoal(root,true),/下级/);goals.completeGoal(child,true);goals.completeGoal(child,true);goals.completeGoal(root,true);let detail=goals.readGoal(root);const time=detail.nodes.find((n:any)=>n.id===child).completedAt;assert.ok(time);assert.equal(detail.history.filter((e:any)=>e.nodeId===child&&e.action==='completed').length,1);goals.saveGoal({parentId:child,title:'补充发音练习'});detail=goals.readGoal(root);assert.equal(detail.root.completedAt,null);assert.equal(detail.nodes.find((n:any)=>n.id===child).completedAt,null);assert.equal(detail.nodes.find((n:any)=>n.id===child).lastCompletedAt,time);assert.ok(detail.history.some((e:any)=>e.nodeId===child&&e.action==='reopened'));});
 it('可创建和遍历超过一千层，删除不受递归外键层数限制',()=>{const root=goals.saveGoal({title:'深层测试'});let parent=root;const expanded=new Set<string>();for(let i=0;i<1100;i++){expanded.add(parent);parent=goals.saveGoal({parentId:parent,title:'第'+i+'级'});}const detail=goals.readGoal(root),visible=visibleGoalNodes(detail.nodes,root,expanded);assert.equal(visible.length,1100);assert.equal(visible.at(-1)?.depth,1099);goals.linkGoalDiary(parent,'2026-10-16');goals.completeGoal(parent,true);goals.deleteGoal(root);assert.throws(()=>goals.readGoal(root));assert.equal(db.getDb().prepare("SELECT COUNT(*) AS c FROM journal_link WHERE source_kind='goal'").get().c,0);});
 it('多个同级分支、独立删除与日记关联不会影响其他方向',()=>{const root=goals.saveGoal({title:'独立方向'}),a=goals.saveGoal({parentId:root,title:'分支一'}),b=goals.saveGoal({parentId:root,title:'分支二'}),nested=goals.saveGoal({parentId:a,title:'下级'});goals.linkGoalDiary(nested,'2026-10-16');goals.linkGoalDiary(nested,'2026-10-16');assert.equal(goals.readGoal(root).links.length,1);goals.linkGoalDiary(root,'2026-10-16');assert.equal(goals.listGoals().find((n:any)=>n.id===root).diaryCount,1);goals.linkGoalDiary(root,'2026-10-16',true);goals.deleteGoal(a);const detail=goals.readGoal(root);assert.equal(detail.links.length,0);assert.equal(detail.nodes.length,2);assert.ok(detail.nodes.some((n:any)=>n.id===b));assert.ok(goals.listGoals().some((n:any)=>n.title==='学习日语'));});
 it('输入验证不会生成孤立或无效分支',()=>{const before=goals.listGoals().length;assert.throws(()=>goals.saveGoal({title:' '}));assert.throws(()=>goals.saveGoal({title:'有效名称',parentId:'missing'}));assert.throws(()=>goals.completeGoal('missing',true));assert.throws(()=>goals.linkGoalDiary(goals.listGoals()[0].id,'2026-02-30'));assert.equal(goals.listGoals().length,before);});
 it('量化分支按日保存增量，同日多次更新合并且重复请求不重复增加',()=>{
  const root=goals.saveGoal({title:'备考'}),id=goals.saveGoal({parentId:root,title:'四级单词',targetAmount:4000,unit:'个'}),requestId=randomUUID();
  const progress={id,date:'2026-10-01',mode:'add',amount:50,requestId};goals.recordGoalProgress(progress);goals.recordGoalProgress(progress);
  goals.recordGoalProgress({id,date:'2026-10-01',mode:'add',amount:30,requestId:randomUUID()});goals.recordGoalProgress({id,date:'2026-10-02',mode:'add',amount:40,note:'复习完成',requestId:randomUUID()});
  const node=goals.readGoal(root).nodes.find((n:any)=>n.id===id);assert.equal(node.currentAmount,120);assert.equal(node.completedAt,null);
  const month=goals.readGoalProgress(id,'2026-10');assert.equal(month.entries.length,3);assert.equal(month.entries.filter((e:any)=>e.date==='2026-10-01').reduce((s:number,e:any)=>s+e.delta,0),80);assert.equal(month.entries[2].note,'复习完成');
 });
 it('跨月补记与累计修正保留历史，不允许历史累计为负',()=>{
  const id=goals.saveGoal({title:'阅读',targetAmount:100,unit:'页'}),record=(date:string,mode:string,amount:number)=>goals.recordGoalProgress({id,date,mode,amount,requestId:randomUUID()});
  record('2026-10-02','add',50);record('2026-09-30','add',20);record('2026-10-03','total',60);
  const month=goals.readGoalProgress(id,'2026-10');assert.equal(month.openingAmount,20);assert.deepEqual(month.entries.map((e:any)=>e.delta),[50,-10]);assert.equal(goals.readGoal(id).root.currentAmount,60);
  assert.throws(()=>record('2026-09-01','total',0),/历史累计/);assert.equal(goals.readGoal(id).root.currentAmount,60);assert.equal(goals.readGoalProgress(id,'2026-09').entries.length,1);
 });
 it('达到目标自动完成，更正后重新打开并保留完成时间，进度可超过目标',()=>{
  const id=goals.saveGoal({title:'词汇',targetAmount:10,unit:'词'}),record=(amount:number)=>goals.recordGoalProgress({id,date:'2026-10-01',mode:'total',amount,requestId:randomUUID()});
  assert.throws(()=>goals.completeGoal(id,true),/量化/);record(12);let root=goals.readGoal(id).root;const time=root.completedAt;assert.ok(time);assert.equal(root.currentAmount,12);record(9);root=goals.readGoal(id).root;assert.equal(root.completedAt,null);assert.equal(root.lastCompletedAt,time);record(10);assert.ok(goals.readGoal(id).root.completedAt);
 });
 it('量化父节点必须同时满足数量与下级完成，子项重新打开会带动上级',()=>{
  const root=goals.saveGoal({title:'项目',targetAmount:5}),child=goals.saveGoal({parentId:root,title:'检查'});goals.recordGoalProgress({id:root,date:'2026-10-01',mode:'add',amount:5,requestId:randomUUID()});assert.equal(goals.readGoal(root).root.completedAt,null);goals.completeGoal(child,true);assert.ok(goals.readGoal(root).root.completedAt);goals.completeGoal(child,false);assert.equal(goals.readGoal(root).root.completedAt,null);goals.deleteGoal(child);assert.ok(goals.readGoal(root).root.completedAt);
 });
 it('修改数量目标可重新评估完成状态，普通编辑不丢失量化数据',()=>{
  const id=goals.saveGoal({title:'书',targetAmount:20,unit:'页'});goals.recordGoalProgress({id,date:'2026-10-01',mode:'add',amount:10,requestId:randomUUID()});goals.saveGoal({id,title:'新名称'});assert.equal(goals.readGoal(id).root.targetAmount,20);goals.saveGoal({id,title:'新名称',targetAmount:10});assert.ok(goals.readGoal(id).root.completedAt);goals.saveGoal({id,title:'新名称',targetAmount:30});assert.equal(goals.readGoal(id).root.completedAt,null);assert.throws(()=>goals.saveGoal({id,title:'新名称',unit:'小时'}),/单位/);assert.equal(goals.readGoal(id).root.unit,'页');
 });
 it('无效数字、日期、月份及非量化分支不产生进度记录',()=>{
  const root=goals.saveGoal({title:'普通'}),id=goals.saveGoal({parentId:root,title:'量化',targetAmount:2});
  for(const value of [-1,NaN,Infinity,0,0.0001,1e10])assert.throws(()=>goals.saveGoal({title:'无效',targetAmount:value}));
  for(const value of [-1,NaN,Infinity,0.0001,1e10])assert.throws(()=>goals.recordGoalProgress({id,date:'2026-10-01',mode:'add',amount:value,requestId:randomUUID()}));
  for(const date of ['2026-02-30','9999-12-31'])assert.throws(()=>goals.recordGoalProgress({id,date,mode:'add',amount:1,requestId:randomUUID()}));
  assert.throws(()=>goals.recordGoalProgress({id:root,date:'2026-10-01',mode:'add',amount:1,requestId:randomUUID()}));assert.throws(()=>goals.readGoalProgress(id,'2026-13'));assert.equal(goals.readGoalProgress(id,'2026-10').entries.length,0);
 });
 it('小数数量不会产生浮点累积误差',()=>{
  const id=goals.saveGoal({title:'运动',targetAmount:0.3,unit:'小时'});for(let i=0;i<3;i++)goals.recordGoalProgress({id,date:'2026-10-01',mode:'add',amount:0.1,requestId:randomUUID()});assert.equal(goals.readGoal(id).root.currentAmount,0.3);assert.ok(goals.readGoal(id).root.completedAt);
 });
 it('主任务唯一，只能选择根任务，取消与删除后回到列表',()=>{
  const a=goals.saveGoal({title:'主方向一'}),b=goals.saveGoal({title:'主方向二'}),child=goals.saveGoal({parentId:a,title:'分支'});goals.setPrimaryGoal(a);assert.equal(goals.listGoals()[0].id,a);assert.equal(goals.readGoal(a).root.isPrimary,1);goals.setPrimaryGoal(b);assert.equal(goals.listGoals().filter((n:any)=>n.isPrimary).length,1);assert.throws(()=>goals.setPrimaryGoal(child),/主任务/);goals.setPrimaryGoal(null);assert.equal(goals.listGoals().filter((n:any)=>n.isPrimary).length,0);goals.setPrimaryGoal(a);goals.deleteGoal(a);assert.equal(goals.listGoals().filter((n:any)=>n.isPrimary).length,0);
 });
 it('删除分支清理进度，保留其他分支记录',()=>{
  const root=goals.saveGoal({title:'删除测试'}),a=goals.saveGoal({parentId:root,title:'一',targetAmount:10}),b=goals.saveGoal({parentId:root,title:'二',targetAmount:10});for(const id of [a,b])goals.recordGoalProgress({id,date:'2026-10-01',mode:'add',amount:2,requestId:randomUUID()});goals.deleteGoal(a);assert.equal(db.getDb().prepare('SELECT COUNT(*) AS c FROM goal_progress WHERE node_id=?').get(a).c,0);assert.equal(goals.readGoalProgress(b,'2026-10').entries.length,1);
 });
 it('旧数据库迁移保留原分支，进度与主任务在重开数据库后仍存在',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coldesk-goal-migration-'));db.closeDatabase();try{
   const {openDatabase}=await import('../db/driver.ts');const legacy=openDatabase(join(directory,'coldesk.db'));legacy.exec("CREATE TABLE goal_node(id TEXT PRIMARY KEY,root_id TEXT NOT NULL,parent_id TEXT,title TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',completed_at TEXT,last_completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0); INSERT INTO goal_node(id,root_id,title,created_at,updated_at) VALUES('legacy','legacy','原来的任务','2026-10-01','2026-10-01');");legacy.close();
   db.initDatabase(directory);assert.equal(goals.readGoal('legacy').root.currentAmount,0);assert.equal(goals.readGoal('legacy').root.targetAmount,null);goals.saveGoal({id:'legacy',title:'原来的任务',targetAmount:4000,unit:'个'});goals.setPrimaryGoal('legacy');goals.recordGoalProgress({id:'legacy',date:'2026-10-01',mode:'add',amount:80,requestId:randomUUID()});db.closeDatabase();db.initDatabase(directory);assert.equal(goals.listGoals()[0].isPrimary,1);assert.equal(goals.readGoal('legacy').root.currentAmount,80);assert.equal(goals.readGoalProgress('legacy','2026-10').entries[0].delta,80);
  }finally{db.closeDatabase();rmSync(directory,{recursive:true,force:true});db.initDatabase('.',':memory:');}
 });
});
