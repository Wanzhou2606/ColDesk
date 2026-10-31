import {strict as assert} from 'node:assert';
import {after,before,describe,it} from 'node:test';
import {parseHduCalendar,validateHduSubscription} from '@shared/hduCalendar';
import {fetchHduCalendar} from '../hduFetch';
import {expandDayLessons} from '@shared/timetable';
import {timetableWarnings} from '@shared/timetableImport';
process.env.COLDESK_DB_FACTORY='fake';
const calendar=(events:string[])=>['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ColDesk//isolated test//ZH','X-WR-TIMEZONE:Asia/Shanghai',...events,'END:VCALENDAR'].join('\r\n');
const event=(extra:string[]=[])=>['BEGIN:VEVENT','UID:course-test','DTSTART;TZID=Asia/Shanghai:20260914T084000','DTEND;TZID=Asia/Shanghai:20260914T101500','SUMMARY:测试数学','LOCATION:测试教室','DESCRIPTION:教师：测试老师',...extra,'END:VEVENT'].join('\r\n');
const url='https://api.hduhelp.com/hduhelp-neo/feed/schedule?token=test-only-not-a-credential';
describe('杭电日历订阅：时区、重复课程、边界与落库',()=>{
  let db:typeof import('../db'),repo:typeof import('../db/repositories'),importer:typeof import('../timetableImport');
  before(async()=>{db=await import('../db');repo=await import('../db/repositories');importer=await import('../timetableImport');});after(()=>db.closeDatabase());
  it('只接受官方接口，支持 webcal，不允许内网、相似域名、登录信息或其他接口',()=>{
    assert.equal(validateHduSubscription(url.replace('https:','webcal:')),url);
    assert.equal(validateHduSubscription(url.replace('api.hduhelp.com','neo.hduhelp.com')),url.replace('api.hduhelp.com','neo.hduhelp.com'));
    for(const value of ['http://127.0.0.1/feed?token=x','https://api.hduhelp.com.evil.test/hduhelp-neo/feed/schedule?token=x','https://user:pass@api.hduhelp.com/hduhelp-neo/feed/schedule?token=x','https://api.hduhelp.com/hduhelp-neo/academic/student-info?token=x',url+'&target=other'])assert.throws(()=>validateHduSubscription(value));
  });
  it('解析真实时刻、教师与教室，UTC 转北京时间而不是错排 8 小时',()=>{
    const local=parseHduCalendar(calendar([event()]));assert.equal(local.data.courses[0].sessions[0].startTime,'08:40');assert.equal(local.data.courses[0].teacher,'测试老师');
    const utc=event().replace('DTSTART;TZID=Asia/Shanghai:20260914T084000','DTSTART:20260914T004000Z').replace('DTEND;TZID=Asia/Shanghai:20260914T101500','DTEND:20260914T021500Z');
    assert.equal(parseHduCalendar(calendar([utc])).data.courses[0].sessions[0].startTime,'08:40');
  });
  it('官方授课老师字段可读取，同名课程不同教师合并展示，保留两个日期',()=>{
    const first=event().replace('教师：测试老师','授课老师：测试老师');
    const second=event().replaceAll('20260914','20260921').replace('教师：测试老师','授课老师：另一位老师');
    const result=parseHduCalendar(calendar([first,second]));assert.equal(result.data.courses.length,1);assert.equal(result.occurrenceCount,2);assert.equal(result.data.courses[0].teacher,'测试老师 / 另一位老师');
  });
  it('正确展开单双周、排除停课，重复日历事件不会产生重复课程',()=>{
    const text=calendar([event(['RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4','EXDATE;TZID=Asia/Shanghai:20260928T084000']),event(['RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4','EXDATE;TZID=Asia/Shanghai:20260928T084000'])]);
    const result=parseHduCalendar(text);assert.equal(result.occurrenceCount,3);assert.deepEqual(result.data.courses[0].sessions[0].weeks,[1,5,7]);assert.equal(result.data.courses.length,1);
  });
  it('调课例外使用新的日期、时间和教室，已取消的课程不导入',()=>{
    const changed=['BEGIN:VEVENT','UID:course-test','RECURRENCE-ID;TZID=Asia/Shanghai:20260921T084000','DTSTART;TZID=Asia/Shanghai:20260922T133000','DTEND;TZID=Asia/Shanghai:20260922T141500','SUMMARY:测试数学','LOCATION:调整后的教室','END:VEVENT'].join('\r\n');
    const result=parseHduCalendar(calendar([event(['RRULE:FREQ=WEEKLY;COUNT=2']),changed]));assert.equal(result.occurrenceCount,2);assert.equal(result.data.courses[0].sessions[1].weekday,2);assert.equal(result.data.courses[0].sessions[1].startTime,'13:30');
  });
  it('跳过考试和全天事件，并明确说明；拒绝无限重复和跨天课程',()=>{
    const exam=event().replace('SUMMARY:测试数学','SUMMARY:考试 测试数学').replace('UID:course-test','UID:exam-test');
    const allDay=['BEGIN:VEVENT','UID:holiday-test','DTSTART;VALUE=DATE:20261001','SUMMARY:全天活动','END:VEVENT'].join('\r\n');
    const result=parseHduCalendar(calendar([event(),exam,allDay]));assert.equal(result.occurrenceCount,1);assert.equal(result.skippedExams,1);assert.ok(result.notes.some(n=>n.includes('全天')));
    assert.throws(()=>parseHduCalendar(calendar([event(['RRULE:FREQ=WEEKLY'])])),/结束日期/);
    assert.throws(()=>parseHduCalendar(calendar([event().replace('20260914T101500','20260915T101500')])),/跨天/);
  });
  it('网络读取只返回预览，错误不泄露链接，超大响应被拒绝',async()=>{
    const fetched=await fetchHduCalendar(url,async()=>new Response(calendar([event()])));assert.equal(fetched.data.courses.length,1);
    await assert.rejects(()=>fetchHduCalendar(url,async()=>{throw new Error('SECRET-URL-'+url);}),e=>e instanceof Error&&!e.message.includes('SECRET')&&!e.message.includes('token='));
    await assert.rejects(()=>fetchHduCalendar(url,async()=>new Response('x',{headers:{'content-length':'99999999'}})),/过大/);
  });
  it('无需节次表即可保存并展开课程，反复确认更新原课表且不产生副本',()=>{
    try{db.closeDatabase();}catch{}db.initDatabase('.',':memory:');
    const result=parseHduCalendar(calendar([event(['RRULE:FREQ=WEEKLY;COUNT=2'])]));assert.equal(timetableWarnings(result.data).length,0);
    importer.importValidatedTimetable(result.data,'replace');const semester=repo.getActiveSemester()!;
    const lessons=expandDayLessons({date:'2026-09-21',semester,courses:repo.getCourses(semester.id),sessions:repo.getSessions(),overrides:[],timeSlots:[]});
    assert.equal(lessons[0].startAt,'2026-09-21T08:40');assert.equal(lessons[0].endAt,'2026-09-21T10:15');assert.equal(lessons[0].room,'测试教室');
    importer.importValidatedTimetable(result.data,'replace');assert.equal(repo.getCourses(semester.id).length,1);assert.equal(repo.getSessions().length,1);
  });
  it('同一天不同时刻的订阅课程不被误判为节次冲突，真实重叠仍拒绝',()=>{
    try{db.closeDatabase();}catch{}db.initDatabase('.',':memory:');
    const first=parseHduCalendar(calendar([event(['RRULE:FREQ=WEEKLY;COUNT=2'])]));importer.importValidatedTimetable(first.data,'replace');
    const changed=event(['RRULE:FREQ=WEEKLY;COUNT=2']).replace('测试数学','订阅英语').replaceAll('T084000','T133000').replaceAll('T101500','T141500');
    const second=parseHduCalendar(calendar([changed]));assert.equal(timetableWarnings(parseHduCalendar(calendar([event(),changed])).data).length,0);importer.importValidatedTimetable(second.data,'append');
    assert.equal(repo.getCourses(repo.getActiveSemester()!.id).length,2);
    const overlap=parseHduCalendar(calendar([event(['RRULE:FREQ=WEEKLY;COUNT=2']).replace('测试数学','重叠课程')]));assert.throws(()=>importer.importValidatedTimetable(overlap.data,'append'),/冲突/);
  });
});
