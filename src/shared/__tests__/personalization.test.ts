import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isThemeId, scheduleWindow, scheduleHours, scheduleLabelHours, validateScheduleWindow } from '../personalization';
import {courseColorAt,nextCourseColor,softCourseColor} from '../courseColors';
describe('个性化与日程显示范围',()=>{
 it('新用户和无效旧设置恢复 06:00–24:00',()=>{assert.deepEqual(scheduleWindow(),{startMinute:360,endMinute:1440,startLabel:'06:00',endLabel:'24:00'});assert.equal(scheduleWindow({scheduleStart:'wrong',scheduleEnd:'25:00'}).startMinute,360);});
 it('接受分钟范围，刻度包括两端和整点',()=>{const range=validateScheduleWindow('07:30','10:15');assert.deepEqual(scheduleHours(range),[7.5,8,9,10,10.25]);assert.equal(range.endMinute,615);});
 it('拒绝错误时刻、反向和跨天显示范围',()=>{for(const [a,b]of [['24:00','24:00'],['06:00','06:00'],['22:00','06:00'],['07:60','22:00'],['07:00','24:01']])assert.throws(()=>validateScheduleWindow(a,b));assert.equal(validateScheduleWindow('00:00','24:00').endMinute,1440);});
 it('分钟边界不会与相邻整点刻度重叠',()=>{const labels=scheduleLabelHours(validateScheduleWindow('07:59','22:01'),26);assert.equal(labels[0],479/60);assert.equal(labels.at(-1),1321/60);assert.ok(!labels.includes(8)&&!labels.includes(22));for(let i=1;i<labels.length;i++)assert.ok((labels[i]-labels[i-1])*26>=14);});
 it('主题只接受提供的六个配色选项',()=>{for(const id of ['default','blue','mint','lavender','rose','garden'])assert.equal(isThemeId(id),true);for(const bad of ['red','#fff','url(file://test)',null,{}])assert.equal(isThemeId(bad),false);});
 it('超过预设数目的课程仍分配独立淡彩，深色自动柔化',()=>{const colors=Array.from({length:80},(_,index)=>courseColorAt(index));assert.equal(new Set(colors).size,80);for(const color of colors){assert.match(color,/^#[0-9a-f]{6}$/);assert.ok(Math.min(...[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)))>=149);}assert.ok(!colors.includes(nextCourseColor(colors)));assert.equal(softCourseColor('#000000'),'#9b9b9b');assert.equal(softCourseColor('#A9C7E8'),'#a9c7e8');assert.throws(()=>softCourseColor('red'));});
});
