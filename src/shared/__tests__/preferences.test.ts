import {strict as assert} from 'node:assert';
import {describe,it,afterEach} from 'node:test';
import {navigationOrder,validNavPage,validLanguage} from '../navigation';
import {setLanguage,t,weekdayShort} from '../i18n';
import {startupDigest} from '../startupDigest';
import type {TodayView} from '../view';
describe('用户语言、导航与启动摘要',()=>{
 afterEach(()=>setLanguage('zh-CN'));
 it('恢复丢失导航并移除无效和重复项',()=>{
  assert.deepEqual(navigationOrder(['expenses','unknown','expenses']),['expenses','home','schedule','study','habits','goals']);
  assert.deepEqual(navigationOrder(['home','schedule','study','habits','expenses']),['home','schedule','study','habits','goals','expenses']);
  assert.equal(validNavPage('settings'),false);assert.equal(validLanguage('ja'),true);assert.equal(validLanguage('fr'),false);
 });
 it('三种语言支持动态时长、日期和插值，不吞掉原始花括号',()=>{
  setLanguage('en');assert.equal(t('设置'),'Settings');assert.equal(t('  共 '),'  Total ');
  assert.equal(t('90 分钟'),'90 min');assert.equal(t('10月16日 周五'),'10/16 Fri');
  assert.equal(t('{0} 的操作',['学习 {0}']),'Actions for 学习 {0}');assert.equal(t('my {0} task'),'my {0} task');assert.equal(weekdayShort('日'),'Sun');
  setLanguage('ja');assert.equal(t('设置'),'設定');assert.equal(t('90 分钟'),'90分');
  setLanguage('zh-CN');assert.equal(t('设置'),'设置');
 });
 it('启动摘要包含当天课程和未完成紧急任务，保留用户输入原文',()=>{
  const state={timeline:[{kind:'lesson',title:'日本語',location:'A301',startAt:'2026-10-16T08:40',endAt:'2026-10-16T10:15'},{kind:'block',title:'不应混入课程'}],buckets:{today:[{title:'提交报告',urgency:5,status:'todo',dueAt:'2026-10-16T19:00'},{title:'普通任务',urgency:3,status:'todo'}],later:[{title:'无期限也紧急',urgency:4,status:'todo'}],done:[{title:'已完成的紧急任务',urgency:5,status:'done'}]}} as unknown as TodayView;
  const digest=startupDigest(state);assert.ok(digest.body.includes('08:40–10:15  日本語 · A301'));assert.ok(digest.body.includes('紧急任务（2）'));assert.ok(!digest.body.includes('不应混入课程'));assert.ok(!digest.body.includes('普通任务'));assert.ok(!digest.body.includes('已完成的紧急任务'));
  setLanguage('en');const english=startupDigest(state);assert.ok(english.body.includes("Today's classes (1)"));assert.ok(english.body.includes('提交报告'));
 });
});
