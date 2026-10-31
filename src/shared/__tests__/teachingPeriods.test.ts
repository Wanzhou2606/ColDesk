import {strict as assert} from 'node:assert';
import {describe,it} from 'node:test';
import {teachingPeriods} from '../teachingPeriods';
const week=(pairs:number[][])=>({days:[{date:'2026-10-14',weekday:'周三',dayLabel:'10/14',isToday:true,blocks:pairs.map(([startMinute,endMinute],i)=>({id:String(i),kind:'lesson' as const,title:'课程',startMinute,endMinute,timeLabel:''}))}],weekStart:'2026-10-14',dueCount:0,firstBusyIndex:0});
describe('课表数字刻度',()=>{
 it('使用导入的真实节次编号与起止时间，不重新排序编号',()=>{const slots=[{slotIndex:6,startTime:'13:30',endTime:'14:15'},{slotIndex:1,startTime:'08:40',endTime:'09:25'}];const actual=teachingPeriods(slots,week([[520,615]]));assert.deepEqual(actual.periods.map(p=>p.slotIndex),[1,6]);assert.equal(actual.estimated,false);assert.equal(slots[0].slotIndex,6);});
 it('杭电订阅匹配绍兴作息时提供每一节的时间节点',()=>{const actual=teachingPeriods([],week([[520,615],[810,960]]),true);assert.equal(actual.estimated,false);assert.equal(actual.periods[0].startTime,'08:40');assert.equal(actual.periods[1].startTime,'09:30');assert.equal(actual.periods.find(p=>p.startTime==='13:30')?.slotIndex,6);});
 it('只包含两校区公共时段时不猜测上午和晚上时间',()=>{const actual=teachingPeriods([],week([[810,905]]),true);assert.equal(actual.estimated,false);assert.deepEqual(actual.periods.map(p=>p.slotIndex),[6,7,8,9]);});
 it('通用或不匹配的订阅保持真实时段，不伪造每节课的时间',()=>{for(const hdu of [true,false]){const actual=teachingPeriods([],week([[545,640],[810,905]]),hdu);assert.equal(actual.estimated,true);assert.equal(actual.periods.length,2);assert.equal(actual.periods[0].startTime,'09:05');assert.equal(actual.periods[0].endTime,'10:40');assert.deepEqual(actual.periods.map(p=>p.slotIndex),[1,2]);}assert.equal(teachingPeriods([]).periods.length,0);});
});
