import ICAL from 'ical.js';
import { mondayOf, weekOf } from './time';
import type { TimetableImport } from './timetableImport';

export interface HduCalendarPreview { data:TimetableImport; firstDate:string; lastDate:string; occurrenceCount:number; skippedExams:number; notes:string[] }
type Occurrence={title:string;teacher:string;room:string;start:string;end:string};
const localDateTime=(time:ICAL.Time, zone:string):string=>{
  if(time.isDate)throw new Error('全天事件不能当作课程导入');
  if(time.zone.tzid==='floating'){
    if(zone&&!['Asia/Shanghai','Asia/Chongqing','Asia/Chungking'].includes(zone))throw new Error('订阅使用了暂不支持的时区');
    return time.toString().slice(0,16);
  }
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(time.toJSDate());
  return parts.replace(' ','T').slice(0,16);
};

/** 仅解析日历文本，不连接网站、不读取登录凭证。 */
export function parseHduCalendar(input:unknown):HduCalendarPreview {
  if(typeof input!=='string'||input.length>6*1024*1024||!input.trimStart().startsWith('BEGIN:VCALENDAR'))throw new Error('没有读到有效的课表日历，请重新获取官方订阅链接');
  const rows:Occurrence[]=[],notes:string[]=[];let skippedExams=0,skippedAllDay=0;
  try{
    ICAL.TimezoneService.reset();
    const calendar=new ICAL.Component(ICAL.parse(input.trimStart()));
    for(const zone of calendar.getAllSubcomponents('vtimezone'))ICAL.TimezoneService.register(new ICAL.Timezone({component:zone}));
    const components=calendar.getAllSubcomponents('vevent');
    if(components.length>4000)throw new Error('订阅事件过多，请选择单个学期');
    const masters=new Set(components.filter(c=>!c.hasProperty('recurrence-id')).map(c=>String(c.getFirstPropertyValue('uid')??'')));
    const defaultZone=String(calendar.getFirstPropertyValue('x-wr-timezone')??'Asia/Shanghai');
    const seen=new Set<string>();
    for(const component of components){
      const item=new ICAL.Event(component),uid=String(item.uid??'');
      if(component.hasProperty('recurrence-id')&&uid&&masters.has(uid))continue;
      if(String(component.getFirstPropertyValue('status')).toUpperCase()==='CANCELLED')continue;
      const title=String(item.summary??'').trim().slice(0,100);if(!title)continue;
      const category=String(component.getFirstPropertyValue('categories')??'');
      if(/考试|exam/i.test(category)||/^(?:\[?考试\]?|期[中末]考试)/.test(title)){skippedExams++;continue;}
      if(!item.startDate||item.startDate.isDate){skippedAllDay++;continue;}
      for(const exception of components.filter(c=>c.hasProperty('recurrence-id')&&String(c.getFirstPropertyValue('uid'))===uid))item.relateException(exception);
      const zone=String(component.getFirstProperty('dtstart')?.getParameter('tzid')??defaultZone);
      const description=String(item.description??''),teacher=(description.match(/(?:^|\n)\s*(?:任课教师|任课老师|授课教师|授课老师|教师|老师|Teacher)\s*[:：]\s*([^\n]+)/i)?.[1]??'').trim().slice(0,100);
      const add=(event:ICAL.Event,startDate:ICAL.Time,endDate:ICAL.Time)=>{
        if(String(event.component.getFirstPropertyValue('status')).toUpperCase()==='CANCELLED')return;
        const start=localDateTime(startDate,zone),end=localDateTime(endDate,zone);
        if(start.slice(0,10)!==end.slice(0,10)||start>=end)throw new Error('订阅包含跨天或无效时间的课程，请先核对原始课表');
        const room=String(event.location??item.location??'').trim().slice(0,100),name=String(event.summary??title).trim().slice(0,100),key=JSON.stringify([name,teacher,room,start,end]);
        if(!seen.has(key)){seen.add(key);rows.push({title:name,teacher,room,start,end});}
        if(rows.length>5000)throw new Error('订阅课程过多，请选择单个学期');
      };
      if(item.isRecurring()){
        const rule=component.getFirstPropertyValue('rrule') as ICAL.Recur|undefined;
        if(rule&&!rule.count&&!rule.until)throw new Error('订阅课程没有结束日期，暂不能确定完整学期');
        const iterator=item.iterator();let steps=0,next:ICAL.Time|null;
        while((next=iterator.next())){if(++steps>600)throw new Error('课程重复次数过多，请核对订阅范围');const details=item.getOccurrenceDetails(next);add(details.item,details.startDate,details.endDate);}
      }else add(item,item.startDate,item.endDate);
    }
  }catch(error){if(error instanceof Error&&/订阅|课程|时区/.test(error.message))throw error;throw new Error('课表日历暂时无法解析，请重新获取官方订阅');}
  finally{ICAL.TimezoneService.reset();}
  if(!rows.length)throw new Error('这份订阅还没有可导入的课程');
  rows.sort((a,b)=>a.start.localeCompare(b.start));
  const firstDate=rows[0].start.slice(0,10),lastDate=rows.at(-1)!.start.slice(0,10),startDate=mondayOf(firstDate),totalWeeks=weekOf(lastDate,startDate);
  if(totalWeeks>60||new Date(lastDate).getTime()-new Date(firstDate).getTime()>420*86400000)throw new Error('订阅跨越多个学期，请先核对范围');
  const courseMap=new Map<string,TimetableImport['courses'][number]>();
  for(const row of rows){
    const key=row.title;let course=courseMap.get(key);if(!course){course={name:row.title,teacher:row.teacher,sessions:[]};courseMap.set(key,course);}else if(row.teacher&&!course.teacher.split(' / ').includes(row.teacher)){course.teacher=[course.teacher,row.teacher].filter(Boolean).join(' / ').slice(0,100);}
    const date=row.start.slice(0,10),weekday=new Date(date+'T12:00').getDay()||7,startTime=row.start.slice(11),endTime=row.end.slice(11),week=weekOf(date,startDate);
    let session=course.sessions.find(s=>s.weekday===weekday&&s.startTime===startTime&&s.endTime===endTime&&s.room===row.room);
    if(!session){session={weekday,startSlot:1,endSlot:1,startTime,endTime,room:row.room,weeks:[]};course.sessions.push(session);}
    if(!session.weeks.includes(week))session.weeks.push(week);
  }
  if(courseMap.size>100)throw new Error('课程数量过多，请选择单个学期');
  if(skippedExams)notes.push(`订阅还包含 ${skippedExams} 项考试，本次只导入课程。`);
  if(skippedAllDay)notes.push(`已跳过 ${skippedAllDay} 项没有上课时间的全天事件。`);
  notes.push('按订阅中的实际日期和时刻导入，不需要补填节次或开学时间。');
  return {data:{semester:{name:`杭电助手课表 ${startDate}`,startDate,totalWeeks},timeSlots:[],courses:[...courseMap.values()]},firstDate,lastDate,occurrenceCount:rows.length,skippedExams,notes};
}

export function validateHduSubscription(input:unknown):string {
  if(typeof input!=='string'||input.length>2048)throw new Error('请使用杭电助手官方生成的课表订阅链接');
  let url:URL;try{url=new URL(input.trim().replace(/^webcal:/i,'https:'));}catch{throw new Error('订阅链接格式不正确');}
  if(url.protocol!=='https:'||!['api.hduhelp.com','neo.hduhelp.com'].includes(url.hostname)||url.port||url.username||url.password||url.hash||url.pathname!=='/hduhelp-neo/feed/schedule'||!url.searchParams.get('token')||[...url.searchParams.keys()].some(k=>k!=='token'))throw new Error('请使用杭电助手官方生成的课表订阅链接');
  return url.toString();
}
