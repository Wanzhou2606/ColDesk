export interface GoalNode {
  id:string; rootId:string; parentId:string|null; title:string; note:string;
  completedAt:string|null; lastCompletedAt:string|null; createdAt:string; updatedAt:string; sortOrder:number;
  targetAmount:number|null; currentAmount:number; unit:string; isPrimary:number;
}
export interface GoalSummary extends GoalNode { itemCount:number; completedCount:number; diaryCount:number }
export interface GoalDiaryLink {nodeId:string;diaryDate:string;createdAt:string}
export interface GoalEvent {id:string;nodeId:string;action:'completed'|'reopened';occurredAt:string}
export interface GoalDetail {root:GoalNode;nodes:GoalNode[];links:GoalDiaryLink[];history:GoalEvent[]}
export interface GoalProgressEntry {id:string;nodeId:string;date:string;delta:number;valueAfter:number;unit:string;note:string;createdAt:string}
export interface GoalProgressMonth {month:string;openingAmount:number;entries:GoalProgressEntry[]}
export function goalPercent(node:Pick<GoalNode,'targetAmount'|'currentAmount'>){return node.targetAmount?Math.min(100,Math.max(0,node.currentAmount/node.targetAmount*100)):0;}
/** Iterative traversal keeps deeply nested plans usable without a recursion limit. */
export function visibleGoalNodes(nodes:GoalNode[],rootId:string,expanded:ReadonlySet<string>){
 const children=new Map<string,GoalNode[]>();
 for(const node of nodes){if(!node.parentId)continue;const list=children.get(node.parentId)??[];list.push(node);children.set(node.parentId,list);}
 const stack=(children.get(rootId)??[]).slice().reverse().map(node=>({node,depth:0}));
 const result:Array<{node:GoalNode;depth:number;childCount:number}>=[],seen=new Set<string>();
 while(stack.length){const item=stack.pop()!;if(seen.has(item.node.id))continue;seen.add(item.node.id);const nested=children.get(item.node.id)??[];result.push({...item,childCount:nested.length});if(expanded.has(item.node.id))for(let i=nested.length-1;i>=0;i--)stack.push({node:nested[i],depth:item.depth+1});}
 return result;
}
