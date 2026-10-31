import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseHduCalendar} from '../src/shared/hduCalendar';
import {timetableWarnings} from '../src/shared/timetableImport';
const file=process.argv[2];if(!file)throw new Error('请选择本机课表日历文件');
const text=await readFile(file,'utf8');
const result=parseHduCalendar(text),warnings=timetableWarnings(result.data);
const report={ok:true,courses:result.data.courses.length,arrangements:result.occurrenceCount,range:{start:result.firstDate,end:result.lastDate},skippedExams:result.skippedExams,warnings,notes:result.notes};
await writeFile(resolve('preview/hdu-integration/real-calendar-report.json'),JSON.stringify(report,null,2));
// 私密课程详情仅写入本机预览文件，不输出到聊天或打包。
await writeFile(resolve('preview/hdu-integration/real-calendar-preview.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(report));
