import {describe,it} from 'node:test';
import {strict as assert} from 'node:assert';
import {MobileCore,initialMobileData,type MobilePlatform} from '../src/core';
import {validateMobileAppearance,mobileFontFamily} from '../src/personalization';
import {COURSE_COLORS} from '../../src/shared/courseColors';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const base:MobilePlatform={clipboard:async()=>'',openHdu:async()=>{},calendar:async()=>'',pickAssets:async()=>[],exportAsset:async()=>({canceled:true}),exportDiary:async()=>({canceled:true,count:0,format:'txt',mode:'diary'})};
const setup=(extra:Partial<MobilePlatform>={})=>{let saved:unknown;const storage={load:async()=>saved,save:async(data:unknown)=>{saved=structuredClone(data);}};return {storage,core:new MobileCore(storage,{...base,...extra})};};
describe('手机个性化设置与更新保留',()=>{
 it('默认主题与电脑版相同，升级保留记录和自选的其他主题',async()=>{
  const old=initialMobileData();old.mobileUiVersion=1;old.settings.mainTheme='garden';old.settings.homeTheme='rose';old.home.plain!.entries['2026-10-24']={date:'2026-10-24',cover:'我的记录',weather:'',mood:'',body:'保留',updatedAt:'2026-10-24T10:00'};
  const core=new MobileCore({load:async()=>old,save:async()=>{}},base);await core.invoke('state:get');assert.equal(core.data.settings.mainTheme,'default');assert.equal(core.data.settings.homeTheme,'rose');assert.equal(core.data.home.plain!.entries['2026-10-24'].body,'保留');assert.equal(initialMobileData().settings.homeTheme,'default');
 });
 it('图片更换、取消、恢复与重启，只有保存成功才通知界面更新',async()=>{
  const {core,storage}=setup({pickIcon:async()=>({data:png})});let changes=0;core.on('appearance:iconChanged',()=>changes++);
  await core.invoke('appearance:iconPick');assert.equal(changes,1);const again=new MobileCore(storage,base);assert.equal((await again.invoke('appearance:iconGet') as any).url,'data:image/png;base64,'+png);
  await again.invoke('appearance:iconReset');assert.equal((await again.invoke('appearance:iconGet') as any).custom,false);
  const cancel=setup({pickIcon:async()=>null}).core;assert.equal(await cancel.invoke('appearance:iconPick'),null);assert.equal(cancel.data.appearance,undefined);
  const failing=new MobileCore({load:async()=>undefined,save:async()=>{throw Error('空间不足');}},{...base,pickIcon:async()=>({data:png})});let emitted=false;failing.on('appearance:iconChanged',()=>emitted=true);await assert.rejects(failing.invoke('appearance:iconPick'),/空间不足/);assert.equal(emitted,false);assert.equal(failing.data.appearance,undefined);
 });
 it('应用与封面字体独立导入、备份恢复、重启与重置',async()=>{
  const font={name:'test.ttf',data:btoa(String.fromCharCode(0,1,0,0,0,0,0,0))},{core,storage}=setup({pickFont:async()=>font});
  await core.invoke('mobile:fontImport',{target:'uiFont'});await core.invoke('mobile:fontImport',{target:'homeCoverFont'});
  assert.equal(core.data.settings.uiFont,'ColDeskMobileUI');assert.equal(core.data.settings.homeCoverFont,'ColDeskMobileCover');
  const again=new MobileCore(storage,base);await again.invoke('state:get');assert.deepEqual(again.data.appearance?.fonts?.uiFont,font);
  await again.invoke('mobile:restore',{text:JSON.stringify(again.data)});await again.invoke('mobile:fontReset',{target:'uiFont'});assert.equal(again.data.settings.uiFont,'system');assert.ok(again.data.appearance?.fonts?.homeCoverFont);assert.doesNotThrow(()=>validateMobileAppearance(again.data.appearance));
  assert.equal(mobileFontFamily('serif','uiFont'),'serif');assert.equal(mobileFontFamily('system','homeCoverFont'),'system-ui, sans-serif');
 });
 it('损坏的图标和字体备份会拒绝，当前记录保持不变',async()=>{
  const {core}=setup();await core.invoke('task:create',{title:'仍然保留'});const backup=structuredClone(core.data);backup.appearance={icon:{data:btoa('bad image')}};
  await assert.rejects(core.invoke('mobile:restore',{text:JSON.stringify(backup)}),/PNG/);assert.equal(core.data.snapshot.tasks[0].title,'仍然保留');
  await assert.rejects(setup({pickFont:async()=>({name:'bad.ttf',data:btoa('invalid-font')})}).core.invoke('mobile:fontImport',{target:'uiFont'}),/TTF/);
 });
 it('不同课程默认淡彩、颜色修改与重导保留、恢复默认可持久化',async()=>{
  const {core,storage}=setup(),text=JSON.stringify({semester:{name:'学期',startDate:'2026-10-19',totalWeeks:18},timeSlots:[{slot:1,start:'08:40',end:'09:25'},{slot:2,start:'09:30',end:'10:15'}],courses:[{name:'数学',teacher:'林老师',sessions:[{weekday:1,startSlot:1,endSlot:1,weeks:[1]}]},{name:'英语',teacher:'李老师',sessions:[{weekday:2,startSlot:2,endSlot:2,weeks:[1]}]}]});
  await core.invoke('timetable:import',{text,mode:'replace'});assert.deepEqual(core.data.snapshot.courses.map(c=>c.color),COURSE_COLORS.slice(0,2));
  await core.invoke('courses:color',{id:core.data.snapshot.courses[0].id,color:'#112233'});const custom=core.data.snapshot.courses[0].color;assert.notEqual(custom,'#112233');
  await core.invoke('timetable:import',{text,mode:'replace'});assert.equal(core.data.snapshot.courses[0].color,custom);
  const again=new MobileCore(storage,base);await again.invoke('state:get');assert.equal(again.data.snapshot.courses[0].color,custom);await again.invoke('courses:colorReset');assert.deepEqual(again.data.snapshot.courses.map(c=>c.color),COURSE_COLORS.slice(0,2));
 });
 it('对比度和玻璃浓度持久化，无效值不覆盖有效设置',async()=>{
  const {core,storage}=setup();await core.invoke('settings:update',{highContrast:true,glassOpacity:.8});await assert.rejects(core.invoke('settings:update',{glassOpacity:2}),/透明度/);const again=new MobileCore(storage,base);await again.invoke('state:get');assert.equal(again.data.settings.highContrast,true);assert.equal(again.data.settings.glassOpacity,.8);
 });
});
