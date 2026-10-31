import {useEffect,useRef,useState} from 'react';
import {App as NativeApp} from '@capacitor/app';
import {Capacitor,registerPlugin} from '@capacitor/core';
import {findViewTask,type TaskEditField} from '@shared/taskActions';
import {getApi} from '../../src/renderer/src/lib/api';
import {useAppState} from '../../src/renderer/src/lib/useAppState';
import {useGlassAppearance} from '../../src/renderer/src/lib/glassAppearance';
import {AppIcon,type AppIconName} from '../../src/renderer/src/components/AppIcon';
import {ControlIcon} from '../../src/renderer/src/components/ControlIcon';
import {TaskForm} from '../../src/renderer/src/components/TaskForm';
import {TaskEditDialog} from '../../src/renderer/src/components/TaskEditDialog';
import {HomePage,type HomePageHandle} from '../../src/renderer/src/pages/HomePage';
import {HabitsPage} from '../../src/renderer/src/pages/HabitsPage';
import {ExpensesPage} from '../../src/renderer/src/pages/ExpensesPage';
import {GoalsPage} from '../../src/renderer/src/pages/GoalsPage';
import {HduCalendarImport} from '../../src/renderer/src/components/HduCalendarImport';
import {TimetableImport} from '../../src/renderer/src/components/TimetableImport';
import {MobileSchedule} from './MobileSchedule';
import {MobileTasks} from './MobileTasks';
import {MobileSettings} from './MobileSettings';
import {MobileMore} from './MobileMore';
import {useMobileAppearance} from './useMobileAppearance';
import {AppLogo} from '../../src/renderer/src/components/AppLogo';
import type {MobileCore} from './core';

type Page='home'|'study'|'schedule'|'habits'|'goals'|'expenses'|'settings'|'courses'|'more';
const primary:Array<{page:Page;label:string;icon:AppIconName}>=[{page:'home',label:'Home',icon:'home'},{page:'study',label:'任务',icon:'study'},{page:'schedule',label:'日程',icon:'schedule'},{page:'habits',label:'打卡',icon:'habits'},{page:'more',label:'更多',icon:'more'}];
const pageLabels:Record<Page,string>={home:'Home',study:'任务',schedule:'日程',habits:'打卡',more:'更多',goals:'长期',expenses:'记账',settings:'设置',courses:'课表'};
const privacy=registerPlugin<{privacy(options:{enabled:boolean}):Promise<void>}>('ColDeskExport');
export function MobileApp({core}:{core:MobileCore}){
 const state=useAppState();useGlassAppearance(state);useMobileAppearance(state,core);
 const [page,setPage]=useState<Page>('schedule'),[error,setError]=useState(''),[intro,setIntro]=useState(false),[form,setForm]=useState(false),[homeDate,setHomeDate]=useState<string|undefined>(),[expenseRecord,setExpenseRecord]=useState<{id:string;date:string}|undefined>(),[editing,setEditing]=useState<{id:string;field:TaskEditField;date?:string}|null>(null);
 const home=useRef<HomePageHandle>(null),formDialog=useRef<HTMLDialogElement>(null),content=useRef<HTMLElement>(null),navigationBusy=useRef(false),history=useRef<Page[]>([]),back=useRef(()=>{}),changePage=useRef<(page:Page)=>Promise<void>>(async()=>{});
 const navigate=async(next:Page,returning=false)=>{if(navigationBusy.current)return;if(next===page){content.current?.scrollTo({top:0,behavior:'smooth'});return;}navigationBusy.current=true;try{if(page==='home'&&next!=='home'&&home.current&&!await home.current.beforeLeave())return;if(returning)history.current.pop();else if(primary.some(item=>item.page===next))history.current=[];else history.current.push(page);setPage(next);setError('');content.current?.scrollTo({top:0});}finally{navigationBusy.current=false;}};
 changePage.current=navigate;
 useEffect(()=>{if(form)formDialog.current?.showModal();},[form]);
 useEffect(()=>getApi().on('navigate',payload=>{const p=payload as {action?:string;taskId?:string;field?:TaskEditField;date?:string};if(p.action==='edit-task'&&p.taskId&&p.field)setEditing({id:p.taskId,field:p.field,date:p.date});}),[]);
 useEffect(()=>{void core.invoke('state:get').catch(e=>setError(e.message));const timer=window.setInterval(()=>void core.invoke('state:get').then(value=>core.emit('state:changed',value)).catch(()=>{}),60000);return()=>window.clearInterval(timer);},[core]);
 useEffect(()=>{if(!Capacitor.isNativePlatform())return;void getApi().invoke('home:status').then(status=>privacy.privacy({enabled:page==='home'&&(status as {passwordEnabled:boolean}).passwordEnabled})).catch(()=>{});},[page,state]);
 back.current=()=>{const open=document.querySelector<HTMLDialogElement>('dialog[open]');if(open){open.requestClose();return;}if(editing){setEditing(null);return;}if(page!=='schedule')void navigate(history.current.at(-1)??'schedule',true);else void NativeApp.minimizeApp();};
 useEffect(()=>{if(!Capacitor.isNativePlatform())return;let stopped=false;const subscriptions:Array<{remove:()=>Promise<void>}>=[];
  void NativeApp.addListener('backButton',()=>back.current()).then(s=>stopped?void s.remove():subscriptions.push(s));
  void NativeApp.addListener('appStateChange',({isActive})=>{if(!isActive&&home.current)void home.current.beforeLeave().then(ok=>{if(ok)void changePage.current('schedule');});else if(isActive)void core.invoke('state:get').then(value=>core.emit('state:changed',value)).catch(()=>{});}).then(s=>stopped?void s.remove():subscriptions.push(s));
  return()=>{stopped=true;for(const s of subscriptions)void s.remove();};
 },[core]);
 const returnPage=history.current.at(-1)??'schedule';
 const welcome=intro||!!state&&state.settings.onboardingVersion<1,secondary=['goals','expenses','settings','courses'].includes(page),openDiary=(date:string)=>{setHomeDate(date);void navigate('home');};
 return <div className={`app mobile-app${page==='home'?' is-home':''}`} data-main-theme={state?.settings.mainTheme??'default'} data-home-theme={state?.settings.homeTheme??'default'}>
  {secondary&&<header className="mobile-header"><button className="mobile-back-button" onClick={()=>void navigate(returnPage,true)}><ControlIcon name="left"/>返回{pageLabels[returnPage]}</button><span>ColDesk</span><AppLogo alt=""/></header>}
  <main className="content mobile-content" ref={content} aria-hidden={welcome||undefined}>
   {error&&<p className="mobile-error" role="alert">{error}<button onClick={()=>setError('')}>×</button></p>}
   {!state&&<section className="panel mobile-loading">正在打开你的日常…{error&&<button className="ghost-btn" onClick={()=>location.reload()}>重新打开</button>}</section>}
   {state&&<>
    {page==='schedule'&&<MobileSchedule state={state} onAddTask={()=>setForm(true)} onImport={()=>void navigate('courses')} onTask={(id,field,date)=>setEditing({id,field,date})}/>}
    {page==='study'&&<MobileTasks state={state} onAdd={()=>setForm(true)} onGoals={()=>void navigate('goals')} onEdit={id=>setEditing({id,field:'all'})}/>}
    {page==='home'&&<HomePage ref={home} mobile initialDate={homeDate} onOpenExpense={(id,date)=>{setExpenseRecord(id?{id,date}:undefined);void navigate('expenses');}}/>}
    {page==='habits'&&<HabitsPage state={state}/>}
    {page==='goals'&&<GoalsPage onOpenDiary={openDiary}/>}
    {page==='expenses'&&<ExpensesPage state={state} initialRecord={expenseRecord} onOpenDiary={openDiary}/>}
    {page==='courses'&&<div className="page"><header className="page-head"><div><h1 className="page-title">我的课表</h1><p className="t-caption">导入后，课程会显示在日程中</p></div></header><HduCalendarImport onViewSchedule={()=>void navigate('schedule')}/><TimetableImport/></div>}
    {page==='more'&&<MobileMore onOpen={next=>{if(next==='expenses')setExpenseRecord(undefined);void navigate(next);}}/>}
    {page==='settings'&&<MobileSettings state={state} core={core} onTutorial={()=>setIntro(true)} onImport={()=>void navigate('courses')}/>}
   </>}
  </main>
  <nav className="mobile-tabbar" aria-label="主导航" aria-hidden={welcome||undefined}>{primary.map(item=>{const active=page===item.page||item.page==='more'&&secondary;return <button key={item.page} className={`${active?'active ':''}${item.page==='schedule'?'is-schedule':''}`} aria-current={active?'page':undefined} onClick={()=>void navigate(item.page)}><span className="mobile-tab-icon"><AppIcon name={item.icon}/></span><span>{item.label}</span></button>;})}</nav>

  {form&&state&&<dialog ref={formDialog} className="mobile-sheet mobile-task-create" aria-labelledby="mobile-task-title" onClose={()=>setForm(false)}><header><h2 id="mobile-task-title">新建任务</h2><button className="mobile-round-button" aria-label="关闭新建任务" onClick={()=>formDialog.current?.close()}><ControlIcon name="close"/></button></header><TaskForm courses={state.courses} onDone={()=>setForm(false)}/></dialog>}
  {editing&&state&&<TaskEditDialog placements={state.taskSegments} defaultDate={editing.date??state.date} task={findViewTask(state,editing.id)} field={editing.field} onClose={()=>setEditing(null)} key={editing.id+editing.field}/>}
  {welcome&&state&&<MobileIntro onDone={async()=>{await core.invoke('settings:update',{onboardingVersion:1});setIntro(false);}}/>}
 </div>;
}
function MobileIntro({onDone}:{onDone:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div className="mobile-intro-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="mobile-welcome-title" className="mobile-intro"><AppLogo alt=""/><span className="mobile-eyebrow">你的日常，在手边</span><h1 id="mobile-welcome-title">欢迎使用 ColDesk</h1><p>给重要的事留点时间，也给自己留片田园。</p><div className="mobile-intro-items"><div><AppIcon name="schedule"/><strong>日程，就在正中间</strong><span>默认打开日程，查看今天的课程与待办。新建日程可以记录活动和一次提醒。</span></div><div><AppIcon name="study"/><strong>按自己的节奏安排任务</strong><span>任务统一按今日、近三天、近一周和更远分组。点击安排，自由设置一段或多段起止时间。</span></div><div><AppIcon name="home"/><strong>写下心事，积累日常</strong><span>Home 记录日记、天气、心情、照片与文件。更多页集中放着记账、长期与设置；任务页和日记里的原有入口也可以继续使用。</span></div></div><p className="mobile-intro-foot">以后再看教程：更多 → 设置 → 通用与提醒 → 再看使用指南。<br/>手机与电脑各自保存记录，记得定期导出备份。</p>{error&&<p role="alert">{error}</p>}<button className="primary-btn" disabled={busy} onClick={()=>{setBusy(true);void onDone().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'正在准备…':'开始记录'}</button></section></div>;
}
