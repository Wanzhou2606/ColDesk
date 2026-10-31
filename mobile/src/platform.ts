import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import {App as NativeApp} from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { LocalNotifications } from '@capacitor/local-notifications';
import { reminderDraftsForTask } from '@shared/reminders';
import { upcomingLessons } from '@shared/timetable';
import { validateHduSubscription } from '@shared/hduCalendar';
import { homeEntryTxt, type HomeAsset, type HomeEntry, type HomeExportOptions } from '@shared/home';
import { zipSync } from 'fflate';
import type { MobilePlatform } from './core';
import type { AgendaSnapshot } from '@shared/agenda';
import type { TodayView } from '@shared/view';
import { bytesToBase64, base64ToBytes } from './diary';
import type {MobileFont} from './personalization';

interface ExportFile { name:string; data:string; mime:string }
const LocalExport=registerPlugin<{save(options:{files:ExportFile[];folderName:string}):Promise<{canceled:boolean;folder?:string}>}>('ColDeskExport');
const Appearance=registerPlugin<{shortcut(options:{data?:string;pin:boolean}):Promise<{supported:boolean;pinned:boolean;requested:boolean}>}>('ColDeskAppearance');
export async function mobileIconShortcut(data?:string,pin=false){
 if(!Capacitor.isNativePlatform())return {supported:false,pinned:false,requested:false};
 return Appearance.shortcut({data,pin});
}
const safeName=(name:string)=>name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\.+$/,'').slice(0,120)||'文件';
const mime=(name:string)=>/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.pdf$/i.test(name)?'application/pdf':/\.docx$/i.test(name)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':/\.txt$/i.test(name)?'text/plain':'application/octet-stream';
async function saveFiles(files:ExportFile[],folderName:string) {
  if(Capacitor.isNativePlatform())return LocalExport.save({files,folderName:safeName(folderName)});
  const entries:Record<string,Uint8Array>={};for(const file of files)entries[file.name]=base64ToBytes(file.data);
  const single=files.length===1,blob=new Blob([Uint8Array.from(single?base64ToBytes(files[0].data):zipSync(entries)).buffer],{type:single?files[0].mime:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=single?files[0].name:safeName(folderName)+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return {canceled:false,folder:'已生成下载文件'};
}
export async function exportBackup(data:unknown) {return saveFiles([{name:'ColDesk-手机备份-'+new Date().toISOString().slice(0,10)+'.json',data:bytesToBase64(new TextEncoder().encode(JSON.stringify(data))),mime:'application/json'}],'ColDesk备份');}
export function pickFiles(accept='',multiple=true):Promise<File[]> {
  return new Promise(resolve=>{
    const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.style.display='none';document.body.append(input);
    let finished=false,timer:ReturnType<typeof setTimeout>|undefined;
    // Older Android WebViews have no file-input cancel event. Returning from the
    // native picker still resumes this activity, so release its pending selection.
    const returned=()=>{if(!finished&&!document.hidden){clearTimeout(timer);timer=setTimeout(()=>finish(Array.from(input.files??[])),700);}};
    const visible=()=>{if(!document.hidden)returned();};
    const resume=Capacitor.isNativePlatform()?NativeApp.addListener('resume',returned):undefined;
    const finish=(files:File[])=>{if(finished)return;finished=true;clearTimeout(timer);window.removeEventListener('focus',returned);document.removeEventListener('visibilitychange',visible);void resume?.then(listener=>listener.remove()).catch(()=>{});input.remove();resolve(files);};
    window.addEventListener('focus',returned);document.addEventListener('visibilitychange',visible);
    input.onchange=()=>finish(Array.from(input.files??[]));input.addEventListener('cancel',()=>finish([]),{once:true});input.click();
  });
}
async function imageData(file:File) {
  const url=URL.createObjectURL(file);try {const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('照片无法读取，请选择 JPG、PNG 或 WebP'));image.src=url;}),ratio=Math.min(1600/img.naturalWidth,1600/img.naturalHeight,1),width=Math.max(1,Math.round(img.naturalWidth*ratio)),height=Math.max(1,Math.round(img.naturalHeight*ratio)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(img,0,0,width,height);return {data:canvas.toDataURL('image/png').split(',')[1],width,height};}finally{URL.revokeObjectURL(url);}
}
async function diaryDocument(entries:HomeEntry[],asset:(date:string,id:string)=>HomeAsset) {
  const {Document,Paragraph,TextRun,ImageRun,HeadingLevel,Packer}=await import('docx');
  const children:InstanceType<typeof Paragraph>[]=[];
  for(const entry of entries){children.push(new Paragraph({text:entry.date+(entry.title?' '+entry.title:''),heading:HeadingLevel.HEADING_1,pageBreakBefore:children.length>0}),new Paragraph({children:[new TextRun({text:`天气：${entry.weather||'未记录'}    心情：${entry.mood||'未记录'}`,color:'718197'})]}),new Paragraph({text:'封面',heading:HeadingLevel.HEADING_2}),...entry.cover.split('\n').map(text=>new Paragraph({text})),new Paragraph({text:'日记',heading:HeadingLevel.HEADING_2}),...entry.body.split('\n').map(text=>new Paragraph({text})));
    for(const item of entry.attachments??[]){const value=asset(entry.date,item.id);if(value.image){const ratio=Math.min(460/value.image.width,540/value.image.height,1);children.push(new Paragraph({children:[new ImageRun({type:'png',data:base64ToBytes(value.image.data),transformation:{width:Math.round(value.image.width*ratio),height:Math.round(value.image.height*ratio)}})]}),new Paragraph({text:value.name}));}else children.push(new Paragraph({text:'附件：'+value.name}));}
  }
  return Packer.toBlob(new Document({styles:{default:{document:{run:{font:'Microsoft YaHei',size:22},paragraph:{spacing:{after:120,line:320}}}}},sections:[{properties:{page:{margin:{top:1000,bottom:1000,left:1000,right:1000}}},children}]}));
}
export async function requestMobileNotifications() {
  if(!Capacitor.isNativePlatform())throw new Error('提醒权限请在安卓安装版中开启');return (await LocalNotifications.requestPermissions()).display==='granted';
}
let lastNotifications='';
async function scheduleNotifications(view:TodayView,snapshot:AgendaSnapshot) {
  if(!Capacitor.isNativePlatform()||(await LocalNotifications.checkPermissions()).display!=='granted')return;
  const fingerprint=JSON.stringify([snapshot.tasks,snapshot.courses,snapshot.sessions,snapshot.blocks,snapshot.events,view.settings.classReminder,view.date]);if(fingerprint===lastNotifications)return;
  await LocalNotifications.createChannel({id:'coldesk-reminders',name:'日程与任务提醒',description:'课程和任务截止提醒',importance:4,visibility:0});
  const candidates:Array<{id:number;title:string;body:string;at:Date}>=[],hash=(text:string)=>{let value=2166136261;for(const c of text)value=Math.imul(value^c.charCodeAt(0),16777619);return (value>>>0)%2000000000+1;},now=Date.now();
  for(const task of snapshot.tasks.filter(t=>!['done','canceled'].includes(t.status)))for(const draft of reminderDraftsForTask(task)){const at=new Date(draft.fireAt);if(at.getTime()>now+1000&&at.getTime()<now+14*86400000)candidates.push({id:hash(task.id+draft.fireAt),title:task.title,body:draft.reason,at});}
  for(const event of snapshot.events??[]){const at=new Date(event.startAt);if(at.getTime()>now+1000&&at.getTime()<now+14*86400000)candidates.push({id:hash('event:'+event.id),title:event.title,body:event.detail||'你的日程开始了',at});}
  if(snapshot.semester&&view.settings.classReminder){const lessons=upcomingLessons({...snapshot,semester:snapshot.semester,now:view.now,days:14,limit:100}).next;for(const lesson of lessons){const at=new Date(new Date(lesson.startAt).getTime()-15*60000);if(at.getTime()>now)candidates.push({id:hash(lesson.session.id+lesson.startAt),title:'15 分钟后上课：'+lesson.course.name,body:lesson.room??'请准备好上课',at});}}
  const pending=await LocalNotifications.getPending();if(pending.notifications.length)await LocalNotifications.cancel({notifications:pending.notifications.map(n=>({id:n.id}))});
  candidates.sort((a,b)=>a.at.getTime()-b.at.getTime());const unique=candidates.filter((n,i,all)=>all.findIndex(v=>v.id===n.id)===i).slice(0,80);
  if(unique.length)await LocalNotifications.schedule({notifications:unique.map(n=>({id:n.id,title:n.title,body:n.body,channelId:'coldesk-reminders',schedule:{at:n.at},extra:{page:'schedule'}}))});lastNotifications=fingerprint;
}
export const mobilePlatform:MobilePlatform={
  async pickIcon(){
    const [file]=await pickFiles('image/png,image/jpeg,image/webp',false);if(!file)return null;
    if(file.size>20*1024*1024)throw Error('请选择 20 MB 以内的图片');
    const url=URL.createObjectURL(file);try{
      const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片无法读取，请选择 PNG、JPG 或 WebP'));image.src=url;});
      const side=Math.min(img.naturalWidth,img.naturalHeight);if(!side)throw Error('图片内容为空');
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
      canvas.getContext('2d')!.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,512,512);
      return {data:canvas.toDataURL('image/png').split(',')[1]};
    }finally{URL.revokeObjectURL(url);}
  },
  async pickFont():Promise<MobileFont|null>{
    const [file]=await pickFiles('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2',false);if(!file)return null;
    if(!file.size||file.size>20*1024*1024)throw Error('请选择 20 MB 以内的字体文件');
    const buffer=await file.arrayBuffer();try{await new FontFace('ColDeskFontPreview',buffer).load();}catch{throw Error('字体无法读取，请选择有效的 TTF、OTF、WOFF 或 WOFF2 文件');}
    return {name:file.name.slice(0,200),data:bytesToBase64(new Uint8Array(buffer))};
  },
  clipboard:async()=>validateHduSubscription(Capacitor.isNativePlatform()?(await Clipboard.read()).value:await navigator.clipboard.readText()),
  openHdu:async()=>{if(Capacitor.isNativePlatform())await Browser.open({url:'https://neo.hduhelp.com/schedule'});else window.open('https://neo.hduhelp.com/schedule','_blank','noopener,noreferrer');},
  calendar:async(source)=>{const url=validateHduSubscription(source);try{if(Capacitor.isNativePlatform()){const response=await CapacitorHttp.get({url,responseType:'text',headers:{Accept:'text/calendar'},connectTimeout:15000,readTimeout:15000,disableRedirects:true});if(response.status<200||response.status>=300||validateHduSubscription(response.url)!==url)throw new Error();if(typeof response.data!=='string'||response.data.length>6*1024*1024)throw new Error();return response.data;}const response=await fetch(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();const text=await response.text();if(text.length>6*1024*1024)throw new Error();return text;}catch{throw new Error('暂时无法读取杭电订阅，请检查网络和链接后重试');}},
  pickAssets:async(date,kind)=>{const files=await pickFiles(kind==='photo'?'image/jpeg,image/png,image/webp':'',true);if(files.length>10)throw new Error('手机每次最多添加 10 个附件');if(files.some(f=>f.size>10*1024*1024))throw new Error('手机单个附件不能超过 10 MB');if(files.reduce((s,f)=>s+f.size,0)>30*1024*1024)throw new Error('每次附件合计不能超过 30 MB');const assets:HomeAsset[]=[];for(const file of files){const image=file.type.startsWith('image/')?await imageData(file):undefined;if(kind==='photo'&&!image)throw new Error('请选择照片');assets.push({id:crypto.randomUUID(),date,name:safeName(file.name),kind:image?'photo':'file',size:file.size,data:bytesToBase64(new Uint8Array(await file.arrayBuffer())),image});}return assets;},
  exportAsset:async asset=>saveFiles([{name:safeName(asset.name),data:asset.data,mime:mime(asset.name)}],'ColDesk-'+asset.date),
  exportDiary:async(entries,options,asset)=>{const word=options.mode==='overview'||options.format==='word'||entries.some(e=>e.attachments?.some(a=>a.kind==='photo')),files:ExportFile[]=[];
    const documentFile=async(selected:HomeEntry[],fileName:string)=>files.push({name:fileName+'.docx',data:bytesToBase64(new Uint8Array(await (await diaryDocument(selected,asset)).arrayBuffer())),mime:mime('.docx')});
    if(options.mode==='overview')await documentFile(entries,'日记总览-'+entries[0].date+'至'+entries[entries.length-1].date);else for(const entry of entries){const fileName=entry.date+(entry.title?' '+safeName(entry.title):'');if(word)await documentFile([entry],fileName);else files.push({name:fileName+'.txt',data:bytesToBase64(new TextEncoder().encode(homeEntryTxt(entry))),mime:'text/plain'});}
    for(const entry of entries)for(const item of entry.attachments??[]){const value=asset(entry.date,item.id);files.push({name:entry.date+'-附件/'+item.id.slice(0,8)+'-'+safeName(item.name),data:value.data,mime:mime(item.name)});}
    const result=await saveFiles(files,'ColDesk日记-'+new Date().toISOString().replace(/[:.]/g,'-'));return {...result,count:result.canceled?0:entries.length,format:word?'word':'txt',mode:options.mode??'diary'};},
  notifications:scheduleNotifications
};
