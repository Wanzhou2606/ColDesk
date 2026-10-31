import {randomUUID} from 'node:crypto';
import {getDb} from './db';
import {validHomeDate} from '@shared/home';
import {today} from '@shared/time';
import type {GoalNode,GoalSummary,GoalDetail,GoalProgressEntry,GoalProgressMonth} from '@shared/goals';
const fields='id,root_id AS rootId,parent_id AS parentId,title,note,completed_at AS completedAt,last_completed_at AS lastCompletedAt,created_at AS createdAt,updated_at AS updatedAt,sort_order AS sortOrder,target_amount AS targetAmount,current_amount AS currentAmount,unit,EXISTS(SELECT 1 FROM goal_preference p WHERE p.root_id=goal_node.id) AS isPrimary';
function id(value:unknown):string{if(typeof value!=='string'||!value||value.length>160)throw Error('请选择有效的长期项目');return value;}
function node(value:unknown){const found=getDb().prepare(`SELECT ${fields} FROM goal_node WHERE id=?`).get(id(value)) as GoalNode|undefined;if(!found)throw Error('这个长期项目已不存在');return found;}
function stamp(){return new Date().toISOString();}
function event(nodeId:string,action:'completed'|'reopened',time:string){getDb().prepare('INSERT INTO goal_event(id,node_id,action,occurred_at) VALUES(?,?,?,?)').run(randomUUID(),nodeId,action,time);}
function reopenAncestors(start:string|null,time:string){const seen=new Set<string>();while(start&&!seen.has(start)){seen.add(start);const current=node(start);if(!current.completedAt)break;getDb().prepare('UPDATE goal_node SET completed_at=NULL,updated_at=? WHERE id=?').run(time,current.id);event(current.id,'reopened',time);start=current.parentId;}}
export function listGoals():GoalSummary[]{
 return getDb().prepare(`SELECT g.id,g.root_id AS rootId,g.parent_id AS parentId,g.title,g.note,g.completed_at AS completedAt,g.last_completed_at AS lastCompletedAt,g.created_at AS createdAt,g.updated_at AS updatedAt,g.sort_order AS sortOrder,g.target_amount AS targetAmount,g.current_amount AS currentAmount,g.unit,EXISTS(SELECT 1 FROM goal_preference p WHERE p.root_id=g.id) AS isPrimary,
 (SELECT COUNT(*) FROM goal_node n WHERE n.root_id=g.id AND n.parent_id IS NOT NULL) AS itemCount,
 (SELECT COUNT(*) FROM goal_node n WHERE n.root_id=g.id AND n.parent_id IS NOT NULL AND n.completed_at IS NOT NULL) AS completedCount,
 (SELECT COUNT(DISTINCT l.diary_date) FROM journal_link l JOIN goal_node n ON n.id=l.source_id WHERE l.source_kind='goal' AND n.root_id=g.id) AS diaryCount
 FROM goal_node g WHERE g.parent_id IS NULL ORDER BY isPrimary DESC,g.completed_at IS NOT NULL,g.updated_at DESC,g.id`).all() as GoalSummary[];
}
export function readGoal(value:unknown):GoalDetail{
 const root=node(value);if(root.parentId)throw Error('请先打开所属的长期任务');
 return {root,nodes:getDb().prepare(`SELECT ${fields} FROM goal_node WHERE root_id=? ORDER BY sort_order,created_at,id`).all(root.id) as GoalNode[],
 links:getDb().prepare("SELECT l.source_id AS nodeId,l.diary_date AS diaryDate,l.created_at AS createdAt FROM journal_link l JOIN goal_node n ON n.id=l.source_id WHERE l.source_kind='goal' AND n.root_id=? ORDER BY l.diary_date DESC,l.created_at DESC").all(root.id) as GoalDetail['links'],
 history:getDb().prepare('SELECT e.id,e.node_id AS nodeId,e.action,e.occurred_at AS occurredAt FROM goal_event e JOIN goal_node n ON n.id=e.node_id WHERE n.root_id=? ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT 100').all(root.id) as GoalDetail['history']};
}
export function saveGoal(input:{id?:unknown;parentId?:unknown;title?:unknown;note?:unknown;targetAmount?:unknown;unit?:unknown}){
 if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>120)throw Error('请输入 1–120 个字符的名称');
 if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>8000))throw Error('说明最多 8000 个字符');
 if(input.targetAmount!==undefined&&input.targetAmount!==null)amount(input.targetAmount,true);
 if(input.unit!==undefined&&(typeof input.unit!=='string'||input.unit.trim().length>16))throw Error('单位最多 16 个字符');
 const time=stamp(),title=input.title.trim(),noteText=typeof input.note==='string'?input.note:'';
 return getDb().transaction(()=>{
  if(input.id!==undefined){const current=node(input.id),target=input.targetAmount===undefined?current.targetAmount:input.targetAmount,unit=input.unit===undefined?current.unit:(input.unit as string).trim();
   const hasRecords=getDb().prepare('SELECT 1 FROM goal_progress WHERE node_id=? LIMIT 1').get(current.id);
   if(hasRecords&&unit!==current.unit)throw Error('已有进度记录的分支不能更改单位，请新建分支记录另一种单位');
   getDb().prepare('UPDATE goal_node SET title=?,note=?,target_amount=?,unit=?,updated_at=? WHERE id=?').run(title,noteText,target,unit,time,current.id);
   reconcileQuantified(current.id,time);getDb().prepare('UPDATE goal_node SET updated_at=? WHERE id=?').run(time,current.rootId);return current.id;}
  const parent=input.parentId==null?null:node(input.parentId),newId=randomUUID(),rootId=parent?.rootId??newId;
  const position=getDb().prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS position FROM goal_node WHERE parent_id IS ?').get(parent?.id??null) as {position:number};
  getDb().prepare('INSERT INTO goal_node(id,root_id,parent_id,title,note,created_at,updated_at,sort_order,target_amount,unit) VALUES(?,?,?,?,?,?,?,?,?,?)').run(newId,rootId,parent?.id??null,title,noteText,time,time,position.position,input.targetAmount??null,typeof input.unit==='string'?input.unit.trim():'');
  if(parent)reopenAncestors(parent.id,time);getDb().prepare('UPDATE goal_node SET updated_at=? WHERE id=?').run(time,rootId);return newId;
 })();
}
export function completeGoal(value:unknown,done:unknown){
 if(typeof done!=='boolean')throw Error('请选择项目状态');const current=node(value),time=stamp();
 return getDb().transaction(()=>{
  if(current.targetAmount!==null)throw Error('量化项目通过更新进度完成，达到目标且下级完成后会自动标记');
  if(done){if(current.completedAt)return true;const pending=getDb().prepare('SELECT COUNT(*) AS count FROM goal_node WHERE parent_id=? AND completed_at IS NULL').get(current.id) as {count:number};if(pending.count)throw Error('请先完成下级分支，再完成这个项目');getDb().prepare('UPDATE goal_node SET completed_at=?,last_completed_at=?,updated_at=? WHERE id=?').run(time,time,time,current.id);event(current.id,'completed',time);reconcileQuantified(current.parentId,time);}
  else reopenAncestors(current.id,time);
  getDb().prepare('UPDATE goal_node SET updated_at=? WHERE id=?').run(time,current.rootId);return true;
 })();
}
export function deleteGoal(value:unknown){const current=node(value),nodes=getDb().prepare('SELECT id,parent_id AS parentId FROM goal_node WHERE root_id=?').all(current.rootId) as Array<{id:string;parentId:string|null}>;const children=new Map<string,string[]>();for(const item of nodes){if(!item.parentId)continue;const list=children.get(item.parentId)??[];list.push(item.id);children.set(item.parentId,list);}const ids:string[]=[],stack=[current.id],seen=new Set<string>();while(stack.length){const next=stack.pop()!;if(seen.has(next))continue;seen.add(next);ids.push(next);for(const child of children.get(next)??[])stack.push(child);}
 return getDb().transaction(()=>{for(let offset=0;offset<ids.length;offset+=400){const batch=ids.slice(offset,offset+400),placeholders=batch.map(()=>'?').join(',');getDb().prepare(`DELETE FROM journal_link WHERE source_kind='goal' AND source_id IN (${placeholders})`).run(...batch);getDb().prepare(`DELETE FROM goal_event WHERE node_id IN (${placeholders})`).run(...batch);getDb().prepare(`DELETE FROM goal_progress WHERE node_id IN (${placeholders})`).run(...batch);getDb().prepare(`DELETE FROM goal_preference WHERE root_id IN (${placeholders})`).run(...batch);getDb().prepare(`DELETE FROM goal_node WHERE id IN (${placeholders})`).run(...batch);}const time=stamp();reconcileQuantified(current.parentId,time);getDb().prepare('UPDATE goal_node SET updated_at=? WHERE id=?').run(time,current.rootId);return true;})();
}
export function linkGoalDiary(value:unknown,date:unknown,remove=false){const current=node(value);if(!validHomeDate(date))throw Error('请选择有效的日记日期');if(remove)getDb().prepare("DELETE FROM journal_link WHERE source_kind='goal' AND source_id=? AND diary_date=?").run(current.id,date);else getDb().prepare("INSERT OR IGNORE INTO journal_link(source_kind,source_id,diary_date,created_at) VALUES('goal',?,?,?)").run(current.id,date,stamp());return true;}

const round=(value:number)=>Math.round(value*1000)/1000;
function amount(value:unknown,positive=false):number{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||(positive&&value===0)||Math.abs(value-round(value))>1e-7)throw Error('数量须为 0 到 10 亿之间的数字，最多三位小数；目标须大于 0');
 return round(value);
}
/** Only quantified ancestors auto-complete. Ordinary branches still require an explicit check. */
function reconcileQuantified(start:string|null,time:string){
 const seen=new Set<string>();while(start&&!seen.has(start)){seen.add(start);const current=node(start);
  if(current.targetAmount!==null){const pending=getDb().prepare('SELECT 1 FROM goal_node WHERE parent_id=? AND completed_at IS NULL LIMIT 1').get(current.id),done=current.currentAmount>=current.targetAmount&&!pending;
   if(done&&!current.completedAt){getDb().prepare('UPDATE goal_node SET completed_at=?,last_completed_at=?,updated_at=? WHERE id=?').run(time,time,time,current.id);event(current.id,'completed',time);}
   else if(!done&&current.completedAt)reopenAncestors(current.id,time);
  }
  // An active ordinary branch blocks completion of every ancestor, so no further scan is needed.
  if(current.targetAmount===null&&!current.completedAt)break;
  start=current.parentId;
 }
}
export function setPrimaryGoal(value:unknown){
 return getDb().transaction(()=>{if(value===null){getDb().prepare('DELETE FROM goal_preference WHERE slot=1').run();return true;}
  const root=node(value);if(root.parentId)throw Error('请选择长期任务作为主任务');
  getDb().prepare('INSERT INTO goal_preference(slot,root_id) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET root_id=excluded.root_id').run(root.id);return true;
 })();
}
export function recordGoalProgress(input:{id?:unknown;date?:unknown;mode?:unknown;amount?:unknown;note?:unknown;requestId?:unknown}){
 const current=node(input.id);if(current.targetAmount===null)throw Error('请先为这个分支设置目标数量');
 if(!validHomeDate(input.date)||input.date>today())throw Error('请选择今天或过去的有效日期');
 if(input.mode!=='add'&&input.mode!=='total')throw Error('请选择增加数量或修改累计数量');
 const quantity=amount(input.amount);if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>500))throw Error('进度备注最多 500 个字符');
 const requestId=id(input.requestId),date=input.date,mode=input.mode,noteText=typeof input.note==='string'?input.note.trim():'';
 return getDb().transaction(()=>{
  const existing=getDb().prepare('SELECT node_id AS nodeId FROM goal_progress WHERE id=?').get(requestId) as {nodeId:string}|undefined;
  if(existing){if(existing.nodeId!==current.id)throw Error('这条进度记录已存在');return true;}
  const next=amount(mode==='add'?round(current.currentAmount+quantity):quantity),delta=round(next-current.currentAmount);if(delta===0)throw Error('数量没有变化，无需重复记录');
  // A backdated correction must not make any historical day's cumulative amount negative.
  const days=getDb().prepare('SELECT progress_date AS date,SUM(delta) AS delta FROM goal_progress WHERE node_id=? GROUP BY progress_date ORDER BY progress_date').all(current.id) as Array<{date:string;delta:number}>;
  const daily=new Map(days.map(day=>[day.date,day.delta]));daily.set(date,round((daily.get(date)??0)+delta));let running=0;
  for(const day of [...daily.keys()].sort()){running=round(running+daily.get(day)!);if(running<0)throw Error('这次调整会使历史累计小于 0，请选择正确的日期');}
  const time=stamp();getDb().prepare('INSERT INTO goal_progress(id,node_id,progress_date,delta,value_after,unit,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(requestId,current.id,date,delta,next,current.unit,noteText,time);
  getDb().prepare('UPDATE goal_node SET current_amount=?,updated_at=? WHERE id=?').run(next,time,current.id);reconcileQuantified(current.id,time);
  getDb().prepare('UPDATE goal_node SET updated_at=? WHERE id=?').run(time,current.rootId);return true;
 })();
}
export function readGoalProgress(value:unknown,month:unknown):GoalProgressMonth{
 const current=node(value);if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!validHomeDate(`${month}-01`))throw Error('请选择有效的月份');
 const opening=getDb().prepare('SELECT COALESCE(SUM(delta),0) AS amount FROM goal_progress WHERE node_id=? AND progress_date<?').get(current.id,`${month}-01`) as {amount:number};
 const entries=getDb().prepare('SELECT id,node_id AS nodeId,progress_date AS date,delta,value_after AS valueAfter,unit,note,created_at AS createdAt FROM goal_progress WHERE node_id=? AND progress_date>=? AND progress_date<=? ORDER BY progress_date,created_at,rowid').all(current.id,`${month}-01`,`${month}-31`) as GoalProgressEntry[];
 return {month,openingAmount:round(opening.amount),entries};
}
