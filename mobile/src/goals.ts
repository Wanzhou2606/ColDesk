import type {GoalNode, GoalDiaryLink, GoalEvent, GoalProgressEntry, GoalSummary} from '@shared/goals';
import {validHomeDate} from '@shared/home';
import {today} from '@shared/time';

export interface MobileGoals {nodes:GoalNode[]; links:GoalDiaryLink[]; history:GoalEvent[]; progress:GoalProgressEntry[]}
export const emptyGoals = ():MobileGoals => ({nodes:[], links:[], history:[], progress:[]});
const round = (value:number) => Math.round(value * 1000) / 1000;
function amount(value:unknown, positive=false):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||(positive&&value===0)||Math.abs(value-round(value))>1e-7)throw Error('数量须为 0 到 10 亿之间的数字，最多三位小数；目标须大于 0');
  return round(value);
}
export function mobileGoals(data:MobileGoals, channel:string, p:Record<string,any>):unknown {
  const stamp = new Date().toISOString();
  const node = (id:unknown) => {const found=data.nodes.find(n=>n.id===id);if(!found)throw Error('这个长期项目已不存在');return found;};
  const status = (n:GoalNode, done:boolean) => {
    if(!!n.completedAt===done)return;
    n.completedAt=done?stamp:null;if(done)n.lastCompletedAt=stamp;n.updatedAt=stamp;
    data.history.unshift({id:crypto.randomUUID(),nodeId:n.id,action:done?'completed':'reopened',occurredAt:stamp});
  };
  const reconcile = (start:GoalNode) => {
    let current:GoalNode|undefined=start;const seen=new Set<string>();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);const children=data.nodes.filter(n=>n.parentId===current!.id),ready=children.every(n=>!!n.completedAt);
      if(current.targetAmount!==null)status(current,current.currentAmount>=current.targetAmount&&ready);
      else if(!ready)status(current,false);
      current=current.parentId?node(current.parentId):undefined;
    }
    node(start.rootId).updatedAt=stamp;
  };
  switch(channel){
    case 'goals:list':return data.nodes.filter(n=>!n.parentId).map(root=>{
      const children=data.nodes.filter(n=>n.rootId===root.id&&n.parentId);
      return {...root,itemCount:children.length,completedCount:children.filter(n=>n.completedAt).length,diaryCount:new Set(data.links.filter(l=>data.nodes.some(n=>n.id===l.nodeId&&n.rootId===root.id)).map(l=>l.diaryDate)).size} as GoalSummary;
    }).sort((a,b)=>b.isPrimary-a.isPrimary||Number(!!a.completedAt)-Number(!!b.completedAt)||b.updatedAt.localeCompare(a.updatedAt));
    case 'goals:get':{const root=node(p.id);if(root.parentId)throw Error('请先打开所属的长期任务');const nodes=data.nodes.filter(n=>n.rootId===root.id),ids=new Set(nodes.map(n=>n.id));return {root,nodes,links:data.links.filter(l=>ids.has(l.nodeId)),history:data.history.filter(h=>ids.has(h.nodeId)).slice(0,100)};}
    case 'goals:save':{
      if(typeof p.title!=='string'||!p.title.trim()||p.title.trim().length>120)throw Error('请输入 1–120 个字符的名称');
      if(typeof p.note!=='string'||p.note.length>8000)throw Error('说明最多 8000 个字符');
      if(p.targetAmount!=null)amount(p.targetAmount,true);
      if(typeof p.unit!=='string'||p.unit.trim().length>16)throw Error('单位最多 16 个字符');
      if(p.id){const current=node(p.id);if(data.progress.some(e=>e.nodeId===current.id)&&p.unit.trim()!==current.unit)throw Error('已有进度记录的分支不能更改单位，请新建分支记录另一种单位');Object.assign(current,{title:p.title.trim(),note:p.note,targetAmount:p.targetAmount??null,unit:p.unit.trim(),updatedAt:stamp});reconcile(current);return current.id;}
      const parent=p.parentId?node(p.parentId):null,id=crypto.randomUUID();
      const created:GoalNode={id,rootId:parent?.rootId??id,parentId:parent?.id??null,title:p.title.trim(),note:p.note,targetAmount:p.targetAmount??null,currentAmount:0,unit:p.unit.trim(),isPrimary:0,completedAt:null,lastCompletedAt:null,createdAt:stamp,updatedAt:stamp,sortOrder:data.nodes.filter(n=>n.parentId===(parent?.id??null)).length};
      data.nodes.push(created);if(parent)reconcile(parent);return id;
    }
    case 'goals:primary':{const chosen=p.id?node(p.id):null;if(chosen?.parentId)throw Error('请选择一个长期方向作为主任务');for(const n of data.nodes)n.isPrimary=n.id===chosen?.id?1:0;return true;}
    case 'goals:complete':{const current=node(p.id);if(typeof p.done!=='boolean')throw Error('请选择项目状态');if(current.targetAmount!==null)throw Error('量化项目通过更新进度完成');if(p.done&&data.nodes.some(n=>n.parentId===current.id&&!n.completedAt))throw Error('请先完成下级分支，再完成这个项目');status(current,p.done);if(current.parentId)reconcile(node(current.parentId));return true;}
    case 'goals:delete':{const current=node(p.id),ids=new Set([current.id]),queue=[current.id];while(queue.length){const parent=queue.pop();for(const n of data.nodes)if(n.parentId===parent&&!ids.has(n.id)){ids.add(n.id);queue.push(n.id);}}data.nodes=data.nodes.filter(n=>!ids.has(n.id));data.links=data.links.filter(l=>!ids.has(l.nodeId));data.history=data.history.filter(e=>!ids.has(e.nodeId));data.progress=data.progress.filter(e=>!ids.has(e.nodeId));if(current.parentId)reconcile(node(current.parentId));return true;}
    case 'goals:link':{const current=node(p.id);if(!validHomeDate(p.date))throw Error('请选择有效的日记日期');if(p.remove)data.links=data.links.filter(l=>l.nodeId!==current.id||l.diaryDate!==p.date);else if(!data.links.some(l=>l.nodeId===current.id&&l.diaryDate===p.date))data.links.push({nodeId:current.id,diaryDate:p.date,createdAt:stamp});return true;}
    case 'goals:progress':{
      const current=node(p.id);if(current.targetAmount===null)throw Error('请选择量化分支');if(!validHomeDate(p.date)||p.date>today())throw Error('请选择今天或之前的日期');
      if(!['add','total'].includes(p.mode)||typeof p.requestId!=='string'||!p.requestId||p.requestId.length>160)throw Error('请重新提交进度');
      if(data.progress.some(e=>e.id===p.requestId))return true;
      const input=amount(p.amount,p.mode==='add'),next=p.mode==='add'?amount(round(current.currentAmount+input)):input,delta=round(next-current.currentAmount);
      if(typeof p.note!=='string'||p.note.length>2000)throw Error('备注最多 2000 个字符');
      data.progress.push({id:p.requestId,nodeId:current.id,date:p.date,delta,valueAfter:next,unit:current.unit,note:p.note,createdAt:stamp});current.currentAmount=next;reconcile(current);return true;
    }
    case 'goals:progressMonth':{const current=node(p.id);if(!validHomeDate(p.month+'-01'))throw Error('请选择有效月份');const entries=data.progress.filter(e=>e.nodeId===current.id).sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));return {month:p.month,openingAmount:round(entries.filter(e=>e.date<p.month+'-01').reduce((sum,e)=>sum+e.delta,0)),entries:entries.filter(e=>e.date.startsWith(p.month))};}
    default:throw Error('这个长期操作暂不可用');
  }
}
