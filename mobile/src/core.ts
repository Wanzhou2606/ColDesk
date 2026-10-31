import { createSyncDevice, type SyncDevice } from '@shared/sync';
import { buildAgenda, buildTimeline, primaryMoment, type AgendaSnapshot } from '@shared/agenda';
import { planSchedule, selectPlannableTasks, toPlannerTask } from '@shared/planner';
import { DEFAULT_PREFS_VIEW, sanitizePrefsView, toPlannerPrefs, type PlannerPrefsView } from '@shared/plannerPrefs';
import { manualRange, placementConflict, type ManualPlacement } from '@shared/manualSchedule';
import { validateTaskPatch } from '@shared/taskActions';
import {validateTaskSegments} from '@shared/taskSegments';
import {validateCalendarEvent} from '@shared/calendarEvents';
import {isThemeId,validateScheduleWindow} from '@shared/personalization';
import {emptyGoals,mobileGoals,type MobileGoals} from './goals';
import { normalizeFontName } from '@shared/fonts';
import {courseColorAt,nextCourseColor,softCourseColor} from '@shared/courseColors';
import {validateMobileAppearance,importedFontFamily,type MobileAppearance,type MobileFont,type MobileFontTarget} from './personalization';
import { addDays, dateOf, nowLocal, today } from '@shared/time';
import type { AppSettingsView, TodayView, TaskBucketsView } from '@shared/view';
import type { Task, Urgency, ScheduleBlock, Course, CourseSession, TimeSlot } from '@shared/types';
import { buildExpenseSummary, shiftDate, type ExpenseCategory, type ExpenseEntry, type ExpenseViewMode } from '@shared/expense';
import { buildDayDetail, buildMonthlyBoard, currentStreak, type Habit, type HabitCheckin } from '@shared/habit';
import { FALLBACK_QUOTES, fallbackQuoteFor, type Quote } from '@shared/quote';
import { parseTimetable, timetableWarnings, TIMETABLE_PROMPT, type TimetableImport } from '@shared/timetableImport';
import { parseHduCalendar, type HduCalendarPreview } from '@shared/hduCalendar';
import type { HomeAsset, HomeEntry, HomeExportOptions, HomeExportResult } from '@shared/home';
import { validHomeDate } from '@shared/home';
import { MobileDiary, emptyDiary, type DiaryState } from './diary';
import type { StoragePort } from './storage';

export interface MobilePlatform {
  clipboard():Promise<string>;
  openHdu():Promise<void>;
  calendar(url:unknown):Promise<string>;
  pickAssets(date:string,kind:string):Promise<HomeAsset[]>;
  exportAsset(asset:HomeAsset):Promise<{canceled:boolean}>;
  exportDiary(entries:HomeEntry[],options:HomeExportOptions,asset:(date:string,id:string)=>HomeAsset):Promise<HomeExportResult>;
  pickIcon?():Promise<{data:string}|null>;
  pickFont?():Promise<MobileFont|null>;
  notifications?(view:TodayView,snapshot:AgendaSnapshot):Promise<void>;
}
export interface MobileData {
  schema:1;
  mobileUiVersion?:number;
  appearance?:MobileAppearance;
  goals?:MobileGoals;
  expenseLinks?:Array<{date:string;expenseId:string}>;
  sync?:SyncDevice;
  snapshot:AgendaSnapshot;
  settings:AppSettingsView;
  prefs:PlannerPrefsView;
  categories:ExpenseCategory[];
  expenses:ExpenseEntry[];
  dailyBudget:number;
  budgets:Record<string,{month:string;openingBalance:number;note:string}>;
  expenseMode:ExpenseViewMode;
  expenseAnchor:string;
  habits:Habit[];
  checkins:HabitCheckin[];
  habitMonth:string;
  quote?:Quote;
  home:DiaryState;
  notificationPermissionAsked?:boolean;
}
const id=()=>crypto.randomUUID();
const number=(value:unknown,min:number,max:number,label:string)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(label+'不正确');return value;};
const name=(value:unknown,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('请输入有效名称');return value.trim();};
export function initialMobileData():MobileData {return {schema:1,mobileUiVersion:2,goals:emptyGoals(),sync:createSyncDevice('android',id()),snapshot:{courses:[],sessions:[],overrides:[],timeSlots:[],tasks:[],exams:[],blocks:[],busy:[]},settings:{dailyDigestAt:'07:30',classReminder:true,autoSchedule:false,mainTheme:'default',homeTheme:'default',scheduleStart:'06:00',scheduleEnd:'24:00',autoLaunch:false,desktopMode:'widget',glassOpacity:.62,quietOnFullscreen:false,desktopLayer:'normal',onboardingVersion:0,highContrast:false,uiFont:'system',homeCoverFont:'ColDeskHand'},prefs:structuredClone(DEFAULT_PREFS_VIEW),categories:[['餐饮','🍜','#d7a35f'],['交通','🚇','#6d9ec5'],['学习','📚','#8b80c8'],['购物','🛍','#c7869d'],['其他','✨','#82ad9a']].map(([name,icon,color],i)=>({id:'category-'+i,name,icon,color,dailyTarget:0,sortOrder:i})),expenses:[],dailyBudget:0,budgets:{},expenseMode:'day',expenseAnchor:today(),habits:[],checkins:[],habitMonth:today().slice(0,7),home:emptyDiary()};}

/** 业务层只依赖数据/平台接口，安卓和未来小程序可以替换平台实现。 */
export class MobileCore {
  data=initialMobileData();
  readonly diary=new MobileDiary(()=>this.data.home);
  private listeners=new Map<string,Set<(value:unknown)=>void>>();
  private queue:Promise<unknown>=Promise.resolve();
  private ready:Promise<void>;
  private hduPreview:{id:string;until:number;value:HduCalendarPreview}|null=null;
  constructor(private storage:StoragePort,private platform:MobilePlatform) {
    this.ready=storage.load().then(async value=>{if(value!==undefined){const data=value as MobileData;if(data.schema!==1||!Array.isArray(data.snapshot?.tasks)||!data.home||!data.settings||!data.prefs)throw new Error('本机记录格式不正确，请保留应用并重试');validateMobileBackup(data);const missing=!data.sync;if(missing)data.sync=createSyncDevice('android',id());this.data=data;this.data.goals??=emptyGoals();const migrate=data.mobileUiVersion!==2;if(migrate){data.mobileUiVersion=2;data.settings.autoSchedule=false;for(const key of ['mainTheme','homeTheme'] as const)if(!data.settings[key]||data.settings[key]==='garden')data.settings[key]='default';}if(missing||migrate)await this.storage.save(data);}});
  }
  on(channel:string,handler:(value:unknown)=>void) {const set=this.listeners.get(channel)??new Set();set.add(handler);this.listeners.set(channel,set);return()=>{set.delete(handler);};}
  emit(channel:string,value:unknown) {for(const handler of this.listeners.get(channel)??[])handler(value);}
  invoke(channel:string,payload?:unknown):Promise<unknown> {
    const run=async()=>{await this.ready;const readOnly=['appearance:iconGet','mobile:appearance','state:get','state:refresh','schedule:replan','window:ready','home:dirty','home:flushResult','task:list','task:openEditor','timetable:prompt','timetable:preview','hdu:open','hdu:clipboard','hdu:preview','hdu:clear','home:status','home:unlock','home:lock','home:get','home:month','home:attachmentRead','home:attachmentExport','home:export','mobile:day','mobile:notifications','sync:status','goals:list','goals:get','goals:progressMonth','links:list','links:expenses'].includes(channel);if(readOnly)return this.handle(channel,(payload??{}) as any);const previous=structuredClone(this.data),checkpoint=this.diary.checkpoint();try{const result=await this.handle(channel,(payload??{}) as any);if(JSON.stringify(this.data)!==JSON.stringify(previous)){await this.storage.save(this.data);const view=this.view();this.emit('state:changed',view);if(channel==='appearance:iconPick'||channel==='appearance:iconReset'||channel==='mobile:restore')this.emit('appearance:iconChanged',this.icon());if(channel.startsWith('goals:'))this.emit('goals:changed',true);if(this.platform.notifications)void this.platform.notifications(view,this.planning().snapshot).catch(()=>this.emit('mobile:notificationError','手机提醒暂时不可用，请检查通知权限'));}return result;}catch(e){this.data=previous;this.diary.restore(checkpoint);throw e;}};
    const job=this.queue.catch(()=>undefined).then(run);this.queue=job;return job;
  }
  private planning() {
    const snapshot=structuredClone(this.data.snapshot),now=nowLocal();
    snapshot.blocks=snapshot.blocks.filter(b=>snapshot.tasks.some(t=>t.id===b.taskId&&t.status!=='done'&&t.status!=='canceled'));
    let warnings:TodayView['warnings']=[],unscheduled:TodayView['unscheduled']=[];
    if(this.data.settings.autoSchedule){const manual=new Set(snapshot.blocks.map(b=>b.taskId));const result=planSchedule({...snapshot,now,lockedBlocks:snapshot.blocks,tasks:selectPlannableTasks(snapshot.tasks).filter(t=>!manual.has(t.id)).map(t=>toPlannerTask(t,now)),prefs:toPlannerPrefs(this.data.prefs)});snapshot.blocks.push(...result.blocks.map((b,i)=>({...b,id:'auto:'+b.taskId+':'+b.startAt+':'+i,locked:false})));warnings=result.warnings;unscheduled=result.unscheduled.map(u=>({taskId:u.taskId,title:u.title,reason:u.reason}));}
    return {snapshot,warnings,unscheduled};
  }
  view():TodayView {
    const {snapshot,warnings,unscheduled}=this.planning(),now=nowLocal(),date=dateOf(now),agenda=buildAgenda(snapshot,now),buckets:TaskBucketsView={overdue:[],today:[],tomorrow:[],thisWeek:[],later:[],done:[]};
    for(const task of snapshot.tasks){if(task.status==='done'){buckets.done.push(task);continue;}if(task.status==='canceled')continue;const due=task.dueAt?.slice(0,10);buckets[!due?'later':task.dueAt!<now?'overdue':due===date?'today':due===addDays(date,1)?'tomorrow':due<=addDays(date,7)?'thisWeek':'later'].push(task);}
    const budget=this.data.budgets[this.data.expenseAnchor.slice(0,7)],habits=this.data.habits.filter(h=>!h.archived);
    return {...agenda,taskSegments:structuredClone(snapshot.blocks),teachingSlots:snapshot.timeSlots.map(s=>({slotIndex:s.slotIndex,startTime:s.startTime,endTime:s.endTime})),primary:primaryMoment(agenda),courses:snapshot.courses.map(({id,name,color})=>({id,name,color})),buckets,warnings,unscheduled,ui:{glassTintAlpha:this.data.settings.glassOpacity,showWidget:false,showDrawer:false},settings:this.data.settings,plannerPrefs:this.data.prefs,
      expense:{mode:this.data.expenseMode,anchorDate:this.data.expenseAnchor,today:date,categories:this.data.categories,entries:[...this.data.expenses].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)),totalDailyBudget:this.data.dailyBudget,monthBudget:budget,isSampleData:false,summary:buildExpenseSummary({mode:this.data.expenseMode,anchorDate:this.data.expenseAnchor,today:date,categories:this.data.categories,entries:this.data.expenses,totalDailyBudget:this.data.dailyBudget,openingBalance:budget?.openingBalance,hasOpeningBalance:!!budget})},
      habit:{month:this.data.habitMonth,habits,board:buildMonthlyBoard({month:this.data.habitMonth,habits,checkins:this.data.checkins,today:date}),today:buildDayDetail(date,habits,this.data.checkins),streak:currentStreak(habits,this.data.checkins,date),quote:this.data.quote??fallbackQuoteFor(date),quoteFromFallback:true}};
  }
  private task(key:unknown) {const task=this.data.snapshot.tasks.find(t=>t.id===key);if(!task)throw new Error('任务不存在');return task;}
  private importCourses(data:TimetableImport,mode:unknown) {
    if(!['replace','append'].includes(String(mode)))throw new Error('请选择导入方式');if(timetableWarnings(data).length)throw new Error('课程有重叠，请先核对');const old=this.data.snapshot;
    if(mode==='append'&&old.semester&&(old.semester.startDate!==data.semester.startDate||old.semester.totalWeeks!==data.semester.totalWeeks||data.timeSlots.some(s=>!old.timeSlots.some(o=>o.slotIndex===s.slot&&o.startTime===s.start&&o.endTime===s.end))))throw new Error('学期或节次时间不同，请切换课表');
    const semesterId=mode==='append'&&old.semester?old.semester.id:id();const courses:Course[]=mode==='append'?[...old.courses]:[],sessions:CourseSession[]=mode==='append'?[...old.sessions]:[];
    for(const course of data.courses){let target=courses.find(c=>c.name===course.name&&c.teacher===course.teacher);if(!target){target={id:id(),semesterId,name:course.name,teacher:course.teacher,color:old.courses.find(c=>c.name===course.name&&c.teacher===course.teacher)?.color??nextCourseColor(courses.map(c=>c.color))};courses.push(target);}for(const s of course.sessions){const session:CourseSession={id:id(),courseId:target.id,weekday:s.weekday,startSlot:s.startSlot,endSlot:s.endSlot,startTime:s.startTime,endTime:s.endTime,room:s.room,weekMode:'custom',weekList:s.weeks.join(',')};if(!sessions.some(o=>o.courseId===session.courseId&&o.weekday===session.weekday&&o.startSlot===session.startSlot&&o.endSlot===session.endSlot&&o.startTime===session.startTime&&o.endTime===session.endTime&&o.room===session.room&&o.weekList===session.weekList))sessions.push(session);}}
    const timeSlots:TimeSlot[]=data.timeSlots.map(s=>({id:id(),semesterId,slotIndex:s.slot,startTime:s.start,endTime:s.end,period:Number(s.start.slice(0,2))<12?'am':Number(s.start.slice(0,2))<18?'pm':'eve',campus:'手机导入'}));
    const candidate={...old,semester:{...data.semester,id:semesterId,isActive:true},courses,sessions,timeSlots:mode==='append'&&old.timeSlots.length?old.timeSlots:timeSlots,overrides:mode==='append'?old.overrides:[]};
    // 合并后仍使用同一套实际时间轴检查，不允许追加课程产生重叠。
    for(let offset=0;offset<data.semester.totalWeeks*7;offset++){const lessons=buildTimeline({date:addDays(data.semester.startDate,offset),snapshot:candidate}).filter(b=>b.kind==='lesson');for(let i=0;i<lessons.length;i++)for(let j=i+1;j<lessons.length;j++)if(lessons[i].startAt<lessons[j].endAt&&lessons[i].endAt>lessons[j].startAt)throw new Error('课程与现有课表重叠，请核对后再导入');}
    this.data.snapshot=candidate;return {count:data.courses.length,sessions:data.courses.reduce((sum,c)=>sum+c.sessions.length,0)};
  }
  private saveSegments(taskId:string,input:unknown){
    const task=this.task(taskId);if(['done','canceled'].includes(task.status))throw Error('任务已经结束');
    const rows=validateTaskSegments(input),existing=this.data.snapshot.blocks.filter(b=>b.taskId===taskId);
    const snapshot=structuredClone(this.planning().snapshot);snapshot.blocks=snapshot.blocks.filter(b=>b.taskId!==taskId);
    const ids=new Set(existing.map(b=>b.id));for(const row of rows){if(row.id&&!ids.has(row.id))throw Error('分段记录已更新，请重新打开任务');const conflict=placementConflict(buildTimeline({date:row.date,snapshot}),row.startAt,row.plannedMinutes,undefined,taskId);if(conflict)throw Error(conflict);}
    this.data.snapshot.blocks=this.data.snapshot.blocks.filter(b=>b.taskId!==taskId);
    this.data.snapshot.blocks.push(...rows.map(row=>({id:row.id??id(),taskId,date:row.date,startAt:row.startAt,endAt:row.endAt,plannedMinutes:row.plannedMinutes,locked:true,origin:'manual' as const})));
  }
  private icon(){const data=this.data.appearance?.icon?.data;return {custom:!!data,url:data?'data:image/png;base64,'+data:'./app-icon.png'};}
  private async handle(channel:string,p:any):Promise<unknown> {
    if(channel.startsWith('goals:'))return mobileGoals(this.data.goals??=emptyGoals(),channel,p);
    switch(channel) {
      case 'appearance:iconGet':return this.icon();
      case 'mobile:appearance':return this.data.appearance??{};
      case 'appearance:iconPick':{if(!p.icon&&!this.platform.pickIcon)throw Error('当前设备暂不支持选择图片');const icon=p.icon??await this.platform.pickIcon!();if(!icon)return null;const appearance={...this.data.appearance,icon};validateMobileAppearance(appearance);this.data.appearance=appearance;return this.icon();}
      case 'appearance:iconReset':{this.data.appearance={...this.data.appearance,icon:undefined};return this.icon();}
      case 'mobile:fontImport':{if(!['uiFont','homeCoverFont'].includes(p.target))throw Error('请选择字体位置');if(!p.font&&!this.platform.pickFont)throw Error('当前设备暂不支持导入字体');const font=p.font??await this.platform.pickFont!();if(!font)return null;const target=p.target as MobileFontTarget,appearance={...this.data.appearance,fonts:{...this.data.appearance?.fonts,[target]:font}};validateMobileAppearance(appearance);this.data.appearance=appearance;this.data.settings[target]=importedFontFamily(target);return {name:font.name};}
      case 'mobile:fontReset':{if(!['uiFont','homeCoverFont'].includes(p.target))throw Error('请选择字体位置');const target=p.target as MobileFontTarget;const fonts={...this.data.appearance?.fonts};delete fonts[target];this.data.appearance={...this.data.appearance,fonts};this.data.settings[target]=target==='uiFont'?'system':'ColDeskHand';return true;}
      case 'courses:color':{const course=this.data.snapshot.courses.find(c=>c.id===p.id);if(!course)throw Error('课程不存在');course.color=p.color==null?courseColorAt(this.data.snapshot.courses.indexOf(course)):softCourseColor(p.color);return true;}
      case 'courses:colorReset':this.data.snapshot.courses.forEach((c,i)=>c.color=courseColorAt(i));return true;
      case 'sync:status':return this.data.sync??createSyncDevice('android',id());
      case 'state:get':case 'state:refresh':return this.view();
      case 'schedule:replan':this.emit('state:changed',this.view());return this.view();
      case 'mobile:day':if(!validHomeDate(p.date))throw new Error('请选择有效日期');return buildTimeline({date:p.date,snapshot:this.planning().snapshot});
      case 'mobile:notifications':if(this.platform.notifications)await this.platform.notifications(this.view(),this.planning().snapshot);return true;
      case 'mobile:restore':{if(typeof p.text!=='string'||p.text.length>150*1024*1024)throw new Error('请选择有效的手机备份');let next:MobileData;try{next=JSON.parse(p.text);}catch{throw new Error('备份文件无法读取');}validateMobileBackup(next);next.sync=this.data.sync??createSyncDevice('android',id());this.diary.lock();next.goals??=emptyGoals();next.mobileUiVersion=2;next.settings.autoSchedule=false;this.data=next;this.emit('goals:changed',true);return this.view();}
      case 'window:ready':case 'home:dirty':case 'home:flushResult':return true;
      case 'task:list':return structuredClone(this.data.snapshot.tasks);
      case 'task:create':case 'task:quickAdd': {const timestamp=nowLocal(),title=name(p.title),urgency=number(p.urgency??3,1,5,'紧迫程度') as Urgency;if(!Number.isInteger(urgency))throw new Error('请选择紧迫程度');const patch=validateTaskPatch({title,dueAt:p.dueAt||undefined,estMinutes:p.estMinutes??45,detail:p.detail??''});const task:Task={id:id(),title,domain:p.domain==='life'?'life':'study',type:['assignment','experiment','paper','exam_prep','event','todo'].includes(p.type)?p.type:'todo',source:'manual',urgency,status:'open',progress:0,allDay:false,splittable:p.splittable!==false,remindPolicy:'default',autoScheduled:false,createdAt:timestamp,updatedAt:timestamp,...patch,dueAt:patch.dueAt??undefined,courseId:p.courseId};this.data.snapshot.tasks.push(task);if(p.segments!==undefined)this.saveSegments(task.id,p.segments);return this.view();}
      case 'task:update':Object.assign(this.task(p.id),validateTaskPatch(p.patch),{updatedAt:nowLocal()});if(p.segments!==undefined)this.saveSegments(p.id,p.segments);return this.view();
      case 'schedule:saveSegments':this.saveSegments(p.taskId,p.segments);return this.view();
      case 'schedule:notToday':if(!validHomeDate(p.date))throw Error('请选择有效日期');this.task(p.taskId);this.data.snapshot.blocks=this.data.snapshot.blocks.filter(b=>b.taskId!==p.taskId||b.date!==p.date);return this.view();
      case 'schedule:saveEvent':{const fields=validateCalendarEvent({...p,detail:p.detail??''}),events=this.data.snapshot.events??=[];if(p.id){const existing=events.find(e=>e.id===p.id);if(!existing)throw Error('日程已经不存在');Object.assign(existing,fields,{updatedAt:nowLocal()});}else events.push({...fields,id:id(),createdAt:nowLocal(),updatedAt:nowLocal()});return this.view();}
      case 'schedule:deleteEvent':this.data.snapshot.events=(this.data.snapshot.events??[]).filter(e=>e.id!==p.id);return this.view();
      case 'task:pin':this.task(p.id).pinned=p.pinned===true;return this.view();
      case 'task:delete':this.task(p.id);this.data.snapshot.tasks=this.data.snapshot.tasks.filter(t=>t.id!==p.id);this.data.snapshot.blocks=this.data.snapshot.blocks.filter(b=>b.taskId!==p.id);return this.view();
      case 'task:complete':Object.assign(this.task(p.id),{status:'done',doneAt:nowLocal(),progress:1});this.data.snapshot.blocks=this.data.snapshot.blocks.filter(b=>b.taskId!==p.id);return this.view();
      case 'task:reopen':Object.assign(this.task(p.id),{status:'open',doneAt:undefined,progress:0});return this.view();
      case 'task:openEditor':this.task(p.id);this.emit('navigate',{action:'edit-task',taskId:p.id,field:p.field,domain:this.task(p.id).domain});return true;
      case 'schedule:placeTask': {const input=p as ManualPlacement,task=this.task(input.taskId),existing=this.data.snapshot.blocks.filter(b=>b.taskId===task.id);if(input.blockId&&!existing.some(b=>b.id===input.blockId))throw Error('日程已更新，请重新选择');const range=manualRange(input.startAt,input.durationMinutes);this.saveSegments(task.id,[...existing.filter(b=>b.id!==input.blockId).map(b=>({id:b.id,startAt:b.startAt,endAt:b.endAt})),{id:input.blockId,startAt:range.startAt,endAt:range.endAt}]);return this.view();}
      case 'schedule:removePlacement':this.data.snapshot.blocks=this.data.snapshot.blocks.filter(b=>b.id!==p.blockId);return this.view();
      case 'settings:update': {if(p.glassOpacity!==undefined)this.data.settings.glassOpacity=number(p.glassOpacity,.2,1,'玻璃透明度');if(p.mainTheme!==undefined){if(!isThemeId(p.mainTheme))throw Error('请选择有效主题');this.data.settings.mainTheme=p.mainTheme;}if(p.homeTheme!==undefined){if(!isThemeId(p.homeTheme))throw Error('请选择有效主题');this.data.settings.homeTheme=p.homeTheme;}if(p.scheduleStart!==undefined||p.scheduleEnd!==undefined){const range=validateScheduleWindow(p.scheduleStart??this.data.settings.scheduleStart??'06:00',p.scheduleEnd??this.data.settings.scheduleEnd??'24:00');this.data.settings.scheduleStart=range.startLabel;this.data.settings.scheduleEnd=range.endLabel;}const allowed=['dailyDigestAt','classReminder','autoSchedule','onboardingVersion','highContrast','uiFont','homeCoverFont'] as const;for(const key of allowed){if(p[key]===undefined)continue;if(key==='uiFont'||key==='homeCoverFont')this.data.settings[key]=normalizeFontName(p[key],key==='uiFont'?'system':'ColDeskHand');else if(key==='dailyDigestAt'){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p[key]))throw new Error('汇总时间不正确');this.data.settings[key]=p[key];}else if(key==='onboardingVersion')this.data.settings[key]=number(p[key],0,100,'教程版本');else if(typeof p[key]==='boolean')this.data.settings[key]=p[key];}return this.view();}
      case 'prefs:update':this.data.prefs=sanitizePrefsView({...this.data.prefs,...p});return this.view();
      case 'expense:setView':if(['day','week','month'].includes(p.mode))this.data.expenseMode=p.mode;if(p.anchorDate&&validHomeDate(p.anchorDate))this.data.expenseAnchor=p.anchorDate;if(p.shift)this.data.expenseAnchor=shiftDate(this.data.expenseMode,this.data.expenseAnchor,p.shift>0?1:-1);return this.view();
      case 'expense:add':if(!this.data.categories.some(c=>c.id===p.categoryId))throw new Error('请选择分类');this.data.expenses.push({id:id(),categoryId:p.categoryId,date:validHomeDate(p.date)?p.date:today(),amount:number(p.amount,.01,10000000,'金额'),note:String(p.note??'').slice(0,1000),createdAt:nowLocal()});return this.view();
      case 'links:expenses':return this.data.expenses.filter(e=>(!p.date||e.date===p.date)&&(!p.expenseId||e.id===p.expenseId)).map(e=>({...e,expenseId:e.id}));
      case 'links:list':return (this.data.expenseLinks??[]).filter(link=>(!p.date||link.date===p.date)&&(!p.expenseId||link.expenseId===p.expenseId)).flatMap(link=>{const expense=this.data.expenses.find(e=>e.id===link.expenseId);return expense?[{...expense,expenseId:expense.id,diaryDate:link.date}]:[];});
      case 'links:add':{if(!validHomeDate(p.date)||!this.data.expenses.some(e=>e.id===p.expenseId))throw Error('请选择有效的记账记录与日记日期');const links=this.data.expenseLinks??=[];if(!links.some(link=>link.date===p.date&&link.expenseId===p.expenseId))links.push({date:p.date,expenseId:p.expenseId});return true;}
      case 'links:remove':this.data.expenseLinks=(this.data.expenseLinks??[]).filter(link=>link.date!==p.date||link.expenseId!==p.expenseId);return true;
      case 'expense:remove':this.data.expenseLinks=(this.data.expenseLinks??[]).filter(link=>link.expenseId!==p.id);this.data.expenses=this.data.expenses.filter(e=>e.id!==p.id);return this.view();
      case 'expense:setBudget':this.data.dailyBudget=number(p.amount,0,10000000,'预算');return this.view();
      case 'expense:setMonthBudget':if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month))throw new Error('月份不正确');this.data.budgets[p.month]={month:p.month,openingBalance:number(p.amount,0,10000000,'期初余额'),note:String(p.note??'').slice(0,1000)};return this.view();
      case 'expense:clearMonthBudget':delete this.data.budgets[p.month];return this.view();
      case 'expense:saveCategory': {const category=p.id?this.data.categories.find(c=>c.id===p.id):undefined;if(p.id&&!category)throw new Error('分类不存在');const next={id:p.id??id(),name:name(p.name,30),dailyTarget:number(p.dailyTarget??0,0,1000000,'分类预算'),icon:String(p.icon??category?.icon??'✨').slice(0,16),color:category?.color??'#82ad9a',sortOrder:category?.sortOrder??this.data.categories.length};if(category)Object.assign(category,next);else this.data.categories.push(next);return this.view();}
      case 'expense:removeCategory':if(this.data.expenses.some(e=>e.categoryId===p.id))throw new Error('这个分类还有记录，请先保留它');this.data.categories=this.data.categories.filter(c=>c.id!==p.id);return this.view();
      case 'habit:setMonth':if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month))throw new Error('月份不正确');this.data.habitMonth=p.month;return this.view();
      case 'habit:add':this.data.habits.push({id:id(),name:name(p.name,60),icon:String(p.icon??'⭐').slice(0,16),color:'#82ad9a',activeDays:Array.isArray(p.activeDays)?p.activeDays.filter((d:number)=>Number.isInteger(d)&&d>=1&&d<=7):[],startDate:today(),sortOrder:this.data.habits.length,archived:false});return this.view();
      case 'habit:update': {const h=this.data.habits.find(h=>h.id===p.id);if(!h)throw new Error('习惯不存在');if(p.name!==undefined)h.name=name(p.name,60);if(typeof p.archived==='boolean')h.archived=p.archived;if(p.icon!==undefined){if(typeof p.icon!=='string'||p.icon.length>16)throw Error('请选择有效的打卡图标');h.icon=p.icon;}return this.view();}
      case 'habit:remove':this.data.habits=this.data.habits.filter(h=>h.id!==p.id);this.data.checkins=this.data.checkins.filter(c=>c.habitId!==p.id);return this.view();
      case 'habit:setCheckin': {if(!this.data.habits.some(h=>h.id===p.habitId&&!h.archived))throw new Error('习惯不存在');const date=p.date??today();if(!validHomeDate(date)||date>today())throw new Error('请选择今天或过去的日期');this.data.checkins=this.data.checkins.filter(c=>!(c.habitId===p.habitId&&c.date===date));if(p.done===true)this.data.checkins.push({habitId:p.habitId,date});return this.view();}
      case 'habit:quoteRefresh': {const i=FALLBACK_QUOTES.findIndex(q=>q.text===(this.data.quote??fallbackQuoteFor(today())).text);this.data.quote=FALLBACK_QUOTES[(i+1)%FALLBACK_QUOTES.length];return this.data.quote;}
      case 'timetable:prompt':return TIMETABLE_PROMPT;
      case 'timetable:preview': {const data=parseTimetable(p.text);return {data,warnings:timetableWarnings(data),existing:this.data.snapshot.semester};}
      case 'timetable:import':return this.importCourses(parseTimetable(p.text),p.mode);
      case 'hdu:open':await this.platform.openHdu();return true;
      case 'hdu:clipboard':return this.platform.clipboard();
      case 'hdu:preview': {this.hduPreview=null;const value=parseHduCalendar(await this.platform.calendar(p.url)),previewId=id();this.hduPreview={id:previewId,until:Date.now()+600000,value};return {...value,id:previewId,warnings:timetableWarnings(value.data)};}
      case 'hdu:clear':this.hduPreview=null;return true;
      case 'hdu:commit': {const cached=this.hduPreview;if(!cached||p.id!==cached.id||cached.until<Date.now())throw new Error('预览已过期，请重新读取');const result=this.importCourses(cached.value.data,'replace');this.hduPreview=null;return result;}
      case 'home:status':return this.diary.status();
      case 'home:setup':return this.diary.setup(p.password);
      case 'home:unlock':return this.diary.unlock(p.password);
      case 'home:lock':this.diary.lock();return true;
      case 'home:get':return this.diary.get(p.date);
      case 'home:month':return this.diary.month(p.month);
      case 'home:save':return this.diary.save(p);
      case 'home:protection':await this.diary.protection(p.password);return this.diary.status();
      case 'home:attachmentAdd': {this.diary.get(p.date);const assets=await this.platform.pickAssets(p.date,p.kind);if(!assets.length)return this.diary.get(p.date);return this.diary.add(p.date,assets);}
      case 'home:attachmentRemove':return this.diary.remove(p.date,p.id);
      case 'home:attachmentRead': {const asset=this.diary.asset(p.date,p.id);return {name:asset.name,url:asset.image?'data:image/png;base64,'+asset.image.data:undefined};}
      case 'home:attachmentExport':return this.platform.exportAsset(this.diary.asset(p.date,p.id));
      case 'home:export': {const entries=this.diary.entries(p);if(!entries.length)throw new Error('这个范围还没有日记');return this.platform.exportDiary(entries,p,(date,key)=>this.diary.asset(date,key));}
      default:throw new Error('这个操作在手机版中暂不可用');
    }
  }
}

export function validateMobileBackup(data:MobileData) {
 if(data?.schema!==1||!data.settings||!data.prefs||!data.home||!data.snapshot||!Array.isArray(data.snapshot.tasks)||!Array.isArray(data.snapshot.courses)||!Array.isArray(data.snapshot.sessions)||!Array.isArray(data.snapshot.timeSlots)||!Array.isArray(data.snapshot.overrides)||!Array.isArray(data.snapshot.exams)||!Array.isArray(data.snapshot.busy)||!Array.isArray(data.snapshot.blocks)||!Array.isArray(data.expenses)||!Array.isArray(data.categories)||!Array.isArray(data.habits)||!Array.isArray(data.checkins)||!data.budgets)throw new Error('这不是有效的 ColDesk 手机备份');
 validateMobileAppearance(data.appearance);
 if(data.snapshot.tasks.length>20000||data.expenses.length>100000||data.habits.length>1000)throw new Error('备份内容过多');
 if(data.snapshot.events!==undefined){if(!Array.isArray(data.snapshot.events))throw Error('日程备份内容不正确');for(const event of data.snapshot.events)validateCalendarEvent({...event,endAt:event.endAt===event.startAt?null:event.endAt});}
 if(data.expenseLinks!==undefined&&(!Array.isArray(data.expenseLinks)||data.expenseLinks.some(link=>!validHomeDate(link.date)||!data.expenses.some(expense=>expense.id===link.expenseId))))throw Error('记账关联备份不正确');
 if(data.goals){if(!Array.isArray(data.goals.nodes)||!Array.isArray(data.goals.links)||!Array.isArray(data.goals.history)||!Array.isArray(data.goals.progress))throw Error('长期备份内容不正确');const ids=new Set<string>();for(const node of data.goals.nodes){name(node.id);name(node.title,120);if(ids.has(node.id))throw Error('长期项目重复');ids.add(node.id);number(node.currentAmount,0,1e9,'进度');if(node.targetAmount!==null)number(node.targetAmount,.001,1e9,'目标');}for(const node of data.goals.nodes)if(!ids.has(node.rootId)||node.parentId&&!ids.has(node.parentId))throw Error('长期项目关系不正确');}
 for(const task of data.snapshot.tasks){name(task.id);validateTaskPatch({title:task.title,urgency:task.urgency,dueAt:task.dueAt,estMinutes:task.estMinutes});if(!['study','life'].includes(task.domain)||!['open','doing','done','canceled'].includes(task.status))throw new Error('任务备份内容不正确');}
 for(const block of data.snapshot.blocks){const range=manualRange(block.startAt,block.plannedMinutes);if(range.endAt!==block.endAt||range.date!==block.date)throw new Error('日程备份内容不正确');}
 for(const expense of data.expenses){if(!validHomeDate(expense.date))throw new Error('记账日期不正确');number(expense.amount,.01,10000000,'金额');}
 for(const habit of data.habits){name(habit.name,60);if(!validHomeDate(habit.startDate)||!Array.isArray(habit.activeDays)||habit.activeDays.some(d=>!Number.isInteger(d)||d<1||d>7))throw new Error('习惯备份内容不正确');}
 if(data.home.passwordEnabled){if(data.home.plain||typeof data.home.salt!=='string'||!data.home.cipher?.iv||!data.home.cipher?.data)throw new Error('密码日记备份不正确');}else if(!data.home.plain?.entries||!data.home.plain?.assets)throw new Error('日记备份不正确');
 data.prefs=sanitizePrefsView(data.prefs);data.settings.uiFont=normalizeFontName(data.settings.uiFont,'system');data.settings.homeCoverFont=normalizeFontName(data.settings.homeCoverFont,'ColDeskHand');
}
