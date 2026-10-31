/** End-to-end check using a private, disposable profile and the real assistant CLI. */
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite'),{spawnSync}=require('node:child_process');
const output=path.resolve(__dirname,'../preview/assistant-integration');fs.mkdirSync(output,{recursive:true});
for(const name of ['report.json','error.txt']){const f=path.join(output,name);if(fs.existsSync(f))fs.unlinkSync(f);}
const profile=fs.mkdtempSync(path.join(output,'data-'));app.setPath('userData',profile);app.requestSingleInstanceLock=()=>true;
app.setLoginItemSettings=()=>{};app.getLoginItemSettings=()=>({openAtLogin:false});app.disableHardwareAcceleration();
delete process.env.COLDESK_DISABLE_SCHEDULER;delete process.env.COLDESK_SEED_SAMPLE;
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');require('../out/main/index.cjs');
const wait=async(check,label)=>{for(let i=0;i<120;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error(label);};
const delay=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,label)=>{if(!ok)throw Error(label);};
setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Integration check timed out');app.exit(1);},90000).unref();
(async()=>{let main,external;try{
 await app.whenReady();await wait(()=>{main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ColDesk');return main&&!main.webContents.isLoading();},'Main missing');
 main.setSize(1320,900);main.setIgnoreMouseEvents(true);main.showInactive();main.webContents.setBackgroundThrottling(false);
 const js=code=>main.webContents.executeJavaScript(code),invoke=(channel,payload={})=>js(`window.coldesk.invoke(${JSON.stringify(channel)},${JSON.stringify(payload)})`);
 await invoke('settings:update',{onboardingVersion:1,mainTheme:'mint',classReminder:false,dailyDigestAt:'23:59'});
 const initial=await invoke('state:get'),date=initial.date,wd=new Date(date+'T12:00').getDay()||7;
 const first=new Date(date+'T12:00');first.setDate(first.getDate()-wd+1);const monday=[first.getFullYear(),String(first.getMonth()+1).padStart(2,'0'),String(first.getDate()).padStart(2,'0')].join('-');
 external=new DatabaseSync(path.join(profile,'coldesk.db'));
 external.exec('PRAGMA busy_timeout=5000');
 external.exec(`BEGIN;INSERT INTO semester VALUES('old','旧学期','2026-09-07',20,0,'t','t',NULL),('active','本周课表','${monday}',4,1,'t','t',NULL);
 INSERT INTO course(id,semester_id,name,created_at,updated_at) VALUES('old','old','不应读取的旧课程','t','t'),('active','active','数据结构','t','t');
 INSERT INTO course_session(id,course_id,weekday,start_slot,end_slot,start_time,end_time,week_mode,week_list,room,created_at,updated_at) VALUES('old','old',${wd},1,2,'07:00','08:00','all',NULL,'旧教室','t','t'),('active','active',${wd},1,1,'08:40','10:15','custom','1,3','A101','t','t'),('other','active',${wd},1,1,'08:40','10:15','custom','2,4','B202','t','t');COMMIT;`);
 await wait(async()=>{const state=await invoke('state:get');return state.courses.some(c=>c.name==='数据结构')&&state.summary.lessonCount===1;},'External course change did not refresh automatically');
 const cli=(...args)=>{const env={...process.env,QQ_DESK_DB:path.join(profile,'coldesk.db'),QQ_DESK_READER:path.resolve(__dirname,'../out/assistant-reader.cjs')};delete env.ELECTRON_RUN_AS_NODE;const result=spawnSync(process.execPath,[path.resolve(__dirname,'integrations/desk.js'),...args],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error('CLI failed '+result.stdout+' '+result.stderr);return JSON.parse(result.stdout);};
 // Electron as Node uses an environment flag, without starting another desktop application.
 const week=cli('course','--date',date);assert(week.count===1&&week.courses[0].time==='08:40-10:15'&&week.courses[0].room==='A101','Assistant included old or out-of-week courses');
 const day=cli('day','--date',date);assert(day.lessons.length===1&&day.lessons[0].time==='08:40-10:15','Daily overview differs from the application');
 const added=cli('add','--title','助手写入的任务','--due',date+'T23:50','--urgency','3');assert(added.ok,'CLI task creation failed');
 await wait(()=>js("document.querySelector('.deadline-panel')?.textContent.includes('助手写入的任务')"),'External task did not appear without manual refresh');
 const dbCount=()=>external.prepare('SELECT count(*) AS n FROM reminder').get().n;
 const before=dbCount();for(let i=0;i<5;i++)await invoke('state:refresh');const after=dbCount();assert(before===after&&before>0,'Refresh grew reminder cache');
 assert(external.prepare('SELECT count(*) AS n FROM course').get().n===2,'Old course history was deleted');
 await delay(400);fs.writeFileSync(path.join(output,'schedule.png'),(await main.capturePage()).toPNG());
 external.close();external=null;
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({ok:true,isolatedProfile:true,currentSemesterOnly:true,teachingWeekApplied:true,sameTimetableAsApp:true,externalCourseRefresh:true,externalTaskRefresh:true,reminderCountBefore:before,reminderCountAfter:after,oldHistoryPreserved:true},null,2));app.quit();
}catch(error){fs.writeFileSync(path.join(output,'error.txt'),error.stack||String(error));if(external)external.close();if(main&&!main.isDestroyed())try{fs.writeFileSync(path.join(output,'failure.png'),(await main.capturePage()).toPNG());}catch{}app.exit(1);}})();
