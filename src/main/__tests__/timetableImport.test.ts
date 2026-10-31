import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { parseTimetable, timetableWarnings } from '@shared/timetableImport';
import { expandDayLessons } from '@shared/timetable';
process.env.COLDESK_DB_FACTORY='fake';
const example={semester:{name:'我的学期',startDate:'2026-10-05',totalWeeks:4},timeSlots:[{slot:1,start:'08:00',end:'08:45'},{slot:2,start:'08:55',end:'09:40'}],courses:[{name:'高等数学',teacher:'',sessions:[{weekday:1,startSlot:1,endSlot:2,weeks:[1,3],room:'A101'}]}]};
describe('课表导入：识别结果校验与落库',()=>{
  let db:typeof import('../db'),repo:typeof import('../db/repositories'),importer:typeof import('../timetableImport');
  before(async()=>{db=await import('../db');repo=await import('../db/repositories');importer=await import('../timetableImport');});after(()=>db.closeDatabase());
  const fresh=()=>{try{db.closeDatabase();}catch{}db.initDatabase('.',':memory:');};
  it('接受 JSON 代码框，验证周一、节次、时间、周次，拒绝错值和重叠',()=>{
    assert.equal(parseTimetable('```json\n'+JSON.stringify(example)+'\n```').courses[0].name,'高等数学');
    for(const bad of [{...example,semester:{...example.semester,startDate:'2026-10-35'}},{...example,timeSlots:[{slot:1,start:'25:00',end:'25:45'}]},{...example,courses:[{...example.courses[0],sessions:[{...example.courses[0].sessions[0],weeks:[5]}]}]}])assert.throws(()=>parseTimetable(JSON.stringify(bad)));
    const conflict=parseTimetable(JSON.stringify({...example,courses:[...example.courses,{...example.courses[0],name:'冲突课程'}]}));assert.equal(timetableWarnings(conflict).length,1);
  });
  it('接受常见别名、中文星期、数字字符串、周次范围和代码框外的说明',()=>{
    const loose={term:{start_date:'2026/10/6',total_weeks:'4周'},slots:[{slotIndex:'第1节',startTime:'8:0',endTime:'8：45'},{slotIndex:'2',startTime:'8:55',endTime:'9:40'}],classes:[{title:'高等数学',weekday:'星期一',start_slot:'1',end_slot:'2',weekList:'1 - 4 单周',location:'A101',extra:'无关字段'}]};
    const parsed=parseTimetable('这是识别结果：\n```json\n'+JSON.stringify(loose)+'\n```\n请核对。');
    assert.equal(parsed.semester.startDate,'2026-10-05');assert.equal(parsed.semester.name,'我的学期');assert.equal(parsed.timeSlots[0].start,'08:00');assert.deepEqual(parsed.courses[0].sessions[0].weeks,[1,3]);assert.ok(parsed.notes?.some(note=>note.includes('对齐')));
  });
  it('缺少可选信息使用明确展示的默认值，单双周仍正确，极端周次不能展开',()=>{
    const loose={...example,semester:{startDate:'2026-10-05'},courses:[{name:'绘画',weekday:'周日',startSlot:1,weeks:'双周'}]};
    const parsed=parseTimetable(JSON.stringify(loose));assert.equal(parsed.semester.totalWeeks,20);assert.equal(parsed.courses[0].sessions[0].endSlot,1);assert.deepEqual(parsed.courses[0].sessions[0].weeks,[2,4,6,8,10,12,14,16,18,20]);assert.ok(parsed.notes?.some(note=>note.includes('20 周')));
    assert.throws(()=>parseTimetable(JSON.stringify({...loose,courses:[{...loose.courses[0],weeks:'1-99999999'}]})),/周次/);
  });
  it('首次导入创建学期和作息，单双周展开正确，重复导入不产生课程副本',()=>{
    fresh();importer.importTimetable({text:JSON.stringify(example),mode:'replace'});
    const semester=repo.getActiveSemester()!,courses=repo.getCourses(semester.id),sessions=repo.getSessions(),timeSlots=repo.getTimeSlots(semester.id,'导入课表');
    const lessons=(date:string)=>expandDayLessons({date,semester,courses,sessions,timeSlots,overrides:[]});
    assert.equal(lessons('2026-10-05')[0].startAt,'2026-10-05T08:00');assert.equal(lessons('2026-10-12').length,0);assert.equal(lessons('2026-10-19').length,1);assert.equal(lessons('2026-11-02').length,0);
    importer.importTimetable({text:JSON.stringify(example),mode:'replace'});assert.equal(repo.getCourses(semester.id).length,1);assert.equal(repo.getSessions().filter(s=>s.courseId===courses[0].id).length,1);
  });
  it('追加校验现有学期与冲突，失败不改变现有课表，切换学期保留旧课记录',()=>{
    fresh();importer.importTimetable({text:JSON.stringify(example),mode:'replace'});const old=repo.getActiveSemester()!;
    const conflicting={...example,courses:[{...example.courses[0],name:'冲突课程'}]};assert.throws(()=>importer.importTimetable({text:JSON.stringify(conflicting),mode:'append'}),/冲突/);assert.equal(repo.getCourses(old.id).length,1);
    const second={...example,semester:{...example.semester,name:'下学期',startDate:'2027-02-22'},courses:[{...example.courses[0],name:'大学英语'}]};
    assert.throws(()=>importer.importTimetable({text:JSON.stringify(second),mode:'append'}),/不同/);
    importer.importTimetable({text:JSON.stringify(second),mode:'replace'});assert.equal(repo.getCourses(old.id).length,1);assert.equal(repo.getCourses(repo.getActiveSemester()!.id)[0].name,'大学英语');
  });
  it('不同课程默认淡彩各异，自选颜色重导入仍保留且新课程不抢旧颜色',()=>{
    fresh();const second={...example.courses[0],name:'大学英语',sessions:[{...example.courses[0].sessions[0],weekday:2}]};const data={...example,courses:[...example.courses,second]};
    importer.importTimetable({text:JSON.stringify(data),mode:'replace'});let courses=repo.getCourses();assert.equal(new Set(courses.map(c=>c.color)).size,2);const math=courses.find(c=>c.name==='高等数学')!,mathColor=math.color;
    repo.setCourseColor(math.id,'#c3b6e7');assert.equal(repo.getCourses().find(c=>c.id===math.id)!.color,'#c3b6e7');
    const third={...example.courses[0],name:'新课程',sessions:[{...example.courses[0].sessions[0],weekday:3}]};importer.importTimetable({text:JSON.stringify({...data,courses:[third,...data.courses]}),mode:'replace'});courses=repo.getCourses();assert.equal(courses.find(c=>c.id===math.id)!.color,'#c3b6e7');assert.equal(new Set(courses.map(c=>c.color)).size,3);assert.ok(mathColor);
    repo.resetCourseColors();courses=repo.getCourses();assert.equal(new Set(courses.map(c=>c.color)).size,3);assert.throws(()=>repo.setCourseColor(math.id,'url(test)'));assert.throws(()=>repo.setCourseColor('missing','#a9c7e8'));assert.throws(()=>repo.setCourseColor(math.id,{}));
  });
});
