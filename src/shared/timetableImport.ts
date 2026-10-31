import { validHomeDate } from './home';

export interface TimetableImport {
  semester:{name:string;startDate:string;totalWeeks:number};
  timeSlots:Array<{slot:number;start:string;end:string}>;
  courses:Array<{name:string;teacher:string;sessions:Array<{weekday:number;startSlot:number;endSlot:number;weeks:number[];room:string;startTime?:string;endTime?:string}>}>;
  notes?:string[];
}
export const TIMETABLE_PROMPT = `帮我把这张课程表整理成 ColDesk 可以导入的 JSON，大致按下面的格式输出就好。我会自己核对结果。
请整理课程名、星期、开始和结束节次、上课周次、教室，以及每节课的起止时间。教师和教室看不清可以留空；周次可写成 "1-16"、"1-16单周" 或 [1,3,5]，星期可写 1 到 7，也可写“周一”等。尽量使用示例里的字段名，多一些字段没关系。
学期开始日期和作息时间如果图片里没有，可以向我问一下。看不清的内容请标出来，我会再检查。
格式示例（请替换成我的课表内容）：
{"semester":{"name":"我的学期","startDate":"2026-09-07","totalWeeks":16},"timeSlots":[{"slot":1,"start":"08:00","end":"08:45"},{"slot":2,"start":"08:55","end":"09:40"}],"courses":[{"name":"高等数学","sessions":[{"weekday":"周一","startSlot":1,"endSlot":2,"weeks":"1-16","room":"A101"}]}]}
最好将 JSON 放在一个代码框里，方便我复制。`;

export function parseTimetable(input:unknown):TimetableImport {
  if(typeof input!=='string'||input.length>300000)throw new Error('请粘贴 AI 输出的 JSON（不超过 300 KB）');
  const notes:string[]=[];
  let raw:any;try{const value=input.trim(),code=value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];const json=code??value.slice(value.indexOf('{'),value.lastIndexOf('}')+1);raw=JSON.parse(json);}catch{throw new Error('没有找到完整的 JSON，请复制包含课表的那一段内容');}
  const pick=(value:any,...keys:string[])=>keys.map(key=>value?.[key]).find(v=>v!==undefined&&v!==null);
  const integer=(v:unknown,min:number,max:number,label:string)=>{const number=typeof v==='string'&&/^\s*(?:第)?\d+(?:节|周)?\s*$/.test(v)?Number(v.replace(/\D/g,'')):v;if(typeof number!=='number'||!Number.isInteger(number)||number<min||number>max)throw new Error(label+'不正确');return number;};
  const text=(v:unknown,max:number,label:string,required=false)=>{if((v===undefined||v===null)&&!required)return '';if(typeof v!=='string'||v.length>max||required&&!v.trim())throw new Error(label+'不正确');return v.trim();};
  const s=pick(raw,'semester','term','学期')??raw;
  const startValue=pick(s,'startDate','start_date','firstWeekMonday','开始日期','开学日期');
  const matched=typeof startValue==='string'?startValue.trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/):undefined;
  let startDate=matched?`${matched[1]}-${matched[2].padStart(2,'0')}-${matched[3].padStart(2,'0')}`:'';
  if(!validHomeDate(startDate))throw new Error('请补充第一教学周的日期，才能把课程放到正确的日历上');
  const start=new Date(startDate+'T12:00'),weekday=start.getDay()||7;
  if(weekday!==1){start.setDate(start.getDate()-weekday+1);startDate=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;notes.push(`开始日期已对齐到所在周的周一 ${startDate}，请核对这是否是第一教学周。`);}
  const total=pick(s,'totalWeeks','total_weeks','weekCount','总周数','总教学周数');
  const semester={name:text(pick(s,'name','学期名称')??'我的学期',100,'学期名称',true),startDate,totalWeeks:total===undefined?20:integer(total,1,60,'总教学周数')};
  if(total===undefined)notes.push('未提供总周数，暂按 20 周处理，请核对。');
  const rawSlots=pick(raw,'timeSlots','time_slots','slots','节次','作息');
  if(!Array.isArray(rawSlots)||!rawSlots.length||rawSlots.length>30)throw new Error('请提供 1–30 个节次时间');
  const clock=(v:unknown)=>{const match=typeof v==='string'?v.trim().match(/^(\d{1,2})[:：](\d{1,2})$/):undefined;if(!match||Number(match[1])>23||Number(match[2])>59)throw new Error('节次时间需要包含时和分，例如 8:00');return match[1].padStart(2,'0')+':'+match[2].padStart(2,'0');};
  const timeSlots=rawSlots.map((t:any)=>({slot:integer(pick(t,'slot','slotIndex','index','节次'),1,30,'节次'),start:clock(pick(t,'start','startTime','start_time','开始时间')),end:clock(pick(t,'end','endTime','end_time','结束时间'))})).sort((a:any,b:any)=>a.slot-b.slot);
  if(new Set(timeSlots.map((t:any)=>t.slot)).size!==timeSlots.length||timeSlots.some((t:any,i:number)=>t.start>=t.end||i>0&&t.start<timeSlots[i-1].end))throw new Error('节次不能重复，时间必须按节次递增且不重叠');
  const slots=new Set<number>(timeSlots.map((t:any)=>t.slot));
  const rawCourses=pick(raw,'courses','classes','课程');
  if(!Array.isArray(rawCourses)||!rawCourses.length||rawCourses.length>100)throw new Error('请提供 1–100 门课程');
  let sessionCount=0;
  const courses=rawCourses.map((c:any)=>{
    const name=text(pick(c,'name','title','courseName','课程名称'),100,'课程名称',true),teacher=text(pick(c,'teacher','教师','老师'),100,'教师名称');
    const rawSessions=pick(c,'sessions','schedule','安排','上课安排')??[c];
    if(!Array.isArray(rawSessions)||!rawSessions.length||rawSessions.length>30)throw new Error(name+'缺少上课安排');
    const sessions=rawSessions.map((v:any)=>{
      sessionCount++;if(sessionCount>300)throw new Error('上课安排总数不能超过 300');
      const day=pick(v,'weekday','day','星期');const cn=typeof day==='string'?day.trim().replace(/^(星期|周|礼拜)/,''):'';
      const weekday=integer(/^[一二三四五六日天]$/.test(cn)?(cn==='天'?7:'一二三四五六日'.indexOf(cn)+1):day,1,7,name+'星期'),startSlot=integer(pick(v,'startSlot','start_slot','开始节次'),1,30,name+'开始节次'),endSlot=integer(pick(v,'endSlot','end_slot','结束节次')??startSlot,startSlot,30,name+'结束节次');
      for(let slot=startSlot;slot<=endSlot;slot++)if(!slots.has(slot))throw new Error(name+'引用了未提供时间的第 '+slot+' 节');
      let values:unknown=pick(v,'weeks','weekList','week_list','周次'),mode=pick(v,'weekMode','week_mode','单双周');
      if(values===undefined||values===''||['all','每周','全部'].includes(String(values))){values=Array.from({length:semester.totalWeeks},(_,i)=>i+1);notes.push('未注明周次的课程按全学期处理，请核对。');}
      if(typeof values==='string'){
        if(values.length>300)throw new Error(name+'周次过长');
        if(/单/.test(values))mode='odd';if(/双/.test(values))mode='even';
        const expression=values.replace(/第|周|单|双|\(|\)|（|）/g,'').trim().replace(/\s*([-–—~至])\s*/g,'$1'),expanded:number[]=[];
        if(!expression)for(let w=1;w<=semester.totalWeeks;w++)expanded.push(w);
        for(const part of expression.split(/[,，、\s]+/)){if(!part)continue;const range=part.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);if(range){const from=integer(range[1],1,semester.totalWeeks,name+'周次'),to=integer(range[2],from,semester.totalWeeks,name+'周次');for(let w=from;w<=to;w++)expanded.push(w);}else expanded.push(integer(part,1,semester.totalWeeks,name+'周次'));}
        values=expanded;
      }
      if(!Array.isArray(values)||!values.length||values.length>300)throw new Error(name+'请填写上课周次，例如 1-16');
      let weeks=[...new Set<number>(values.map((w:unknown)=>integer(w,1,semester.totalWeeks,name+'周次')))].sort((a,b)=>a-b);
      if(['odd','单','单周'].includes(String(mode)))weeks=weeks.filter(w=>w%2===1);if(['even','双','双周'].includes(String(mode)))weeks=weeks.filter(w=>w%2===0);
      if(!weeks.length)throw new Error(name+'没有有效的上课周次');
      return {weekday,startSlot,endSlot,weeks,room:text(pick(v,'room','classroom','location','教室'),100,'教室')};
    });return {name,teacher,sessions};
  });
  return {semester,timeSlots,courses,...(notes.length?{notes:[...new Set(notes)]}:{})};
}
export function timetableWarnings(data:TimetableImport):string[] {
  const flat=data.courses.flatMap(c=>c.sessions.map(s=>({...s,name:c.name}))),warnings:string[]=[];
  for(let i=0;i<flat.length;i++)for(let j=i+1;j<flat.length;j++){const a=flat[i],b=flat[j];const overlap=a.startTime&&a.endTime&&b.startTime&&b.endTime?a.startTime<b.endTime&&b.startTime<a.endTime:a.startSlot<=b.endSlot&&b.startSlot<=a.endSlot;if(a.weekday===b.weekday&&overlap&&a.weeks.some(w=>b.weeks.includes(w)))warnings.push(`${a.name} 与 ${b.name} 在周${a.weekday}存在重叠，请检查识别结果。`);}
  return [...new Set(warnings)].slice(0,20);
}
