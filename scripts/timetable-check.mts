/**
 * 生成"课表核对清单"。
 *
 * 目的：预览的课表为虚构示例，我需要用户用最短时间核对我读得对不对。
 * 因此从**虚构的种子数据**（而不是另写一份）反向生成一份人能读的清单：
 * 按周一到周日列出每门课、节次、真实起止时间（按当前校区作息换算）、场地、周次，
 * 并把我不确定的地方单独汇总成一份待确认列表。
 *
 * 用法：pnpm timetable-check
 * 产物：preview/课表核对清单.md
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SEED_COURSES, SEED_SEMESTER } from '../src/main/db/seed-data.ts';

const root = process.cwd();
const outDir = join(root, 'preview');
mkdirSync(outDir, { recursive: true });

/**
 * 作息表（与 db/index.ts 里录入的一致）。
 * 这里复制一份是因为清单要在没有数据库的情况下也能生成；
 * 两边不一致时由 realTimetable.test.ts 的断言兜住。
 */
const BELLS: Record<string, Record<number, [string, string]>> = {
  绍兴: {
    1: ['08:40', '09:25'],
    2: ['09:30', '10:15'],
    3: ['10:25', '11:10'],
    4: ['11:15', '12:00'],
    6: ['13:30', '14:15'],
    7: ['14:20', '15:05'],
    8: ['15:15', '16:00'],
    9: ['16:05', '16:50'],
    10: ['18:00', '18:45'],
    11: ['18:50', '19:35'],
    12: ['19:40', '20:25']
  },
  下沙: {
    1: ['08:05', '08:50'],
    2: ['08:55', '09:40'],
    3: ['10:00', '10:45'],
    4: ['10:50', '11:35'],
    5: ['11:40', '12:25'],
    6: ['13:30', '14:15'],
    7: ['14:20', '15:05'],
    8: ['15:15', '16:00'],
    9: ['16:05', '16:50'],
    10: ['18:30', '19:15'],
    11: ['19:20', '20:05'],
    12: ['20:10', '20:55']
  }
};

const PREPARE = {
  绍兴: { am: '08:35', pm: '13:25', eve: '17:55' },
  下沙: { am: '08:00', pm: '13:25', eve: '18:25' }
};

const WEEKDAY_CN = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const CAMPUS = '绍兴';

/** 把 "2-6,9-17" 展开成人类可读的周次描述 */
function describeWeeks(weekList: string): string {
  const parts: string[] = [];
  for (const raw of weekList.split(',')) {
    const range = raw.match(/^(\d+)-(\d+)$/);
    if (range) {
      parts.push(`第 ${range[1]}–${range[2]} 周`);
    } else if (/^\d+$/.test(raw)) {
      parts.push(`第 ${raw} 周`);
    } else {
      parts.push(raw);
    }
  }
  return parts.join('、');
}

function timeRange(startSlot: number, endSlot: number, campus: string): string {
  const table = BELLS[campus];
  const start = table[startSlot]?.[0];
  const end = table[endSlot]?.[1];
  if (!start || !end) return '（该节次无作息数据）';
  return `${start} – ${end}`;
}

const lines: string[] = [];
lines.push('# 课表核对清单');
lines.push('');
lines.push(`> 由 \`pnpm timetable-check\` 从实际录入的数据生成，用于核对截图转写是否准确。`);
lines.push('');
lines.push(`- 学期：**${SEED_SEMESTER.name}**`);
lines.push(`- 班级 / 专业：${SEED_SEMESTER.className} / ${SEED_SEMESTER.major}`);
lines.push(`- 第 1 教学周周一：**${SEED_SEMESTER.startDate}**（共 ${SEED_SEMESTER.totalWeeks} 周）`);
lines.push(`- 本节次时间按 **${CAMPUS}** 校区换算`);
lines.push('');

// 按星期分组
for (let weekday = 1; weekday <= 7; weekday += 1) {
  const entries: Array<{ course: string; teacher: string; room: string; slots: string; time: string; weeks: string; note?: string }> = [];

  for (const course of SEED_COURSES) {
    for (const session of course.sessions) {
      if (session.weekday !== weekday) continue;
      entries.push({
        course: course.name,
        teacher: course.teacher || '（截图未写）',
        room: (session.room ?? course.room) || '（截图未写）',
        slots: session.startSlot === session.endSlot ? `第 ${session.startSlot} 节` : `第 ${session.startSlot}–${session.endSlot} 节`,
        time: timeRange(session.startSlot, session.endSlot, CAMPUS),
        weeks: describeWeeks(session.weekList),
        note: session.uncertain ? `⚠️ ${session.uncertainReason ?? '待确认'}` : session.note
      });
    }
  }

  lines.push(`## ${WEEKDAY_CN[weekday]}`);
  lines.push('');
  if (entries.length === 0) {
    lines.push('（无课）');
    lines.push('');
    continue;
  }
  entries.sort((a, b) => (a.time < b.time ? -1 : 1));
  for (const entry of entries) {
    lines.push(`- **${entry.course}**`);
    lines.push(`  - 节次：${entry.slots} → ${entry.time}`);
    lines.push(`  - 周次：${entry.weeks}`);
    lines.push(`  - 场地：${entry.room}　教师：${entry.teacher}`);
    if (entry.note) lines.push(`  - 备注：${entry.note}`);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## 作息表（预备铃 + 各节次）');
lines.push('');
for (const campus of ['绍兴', '下沙']) {
  lines.push(`### ${campus}校区`);
  lines.push('');
  lines.push(`- 上午预备铃 **${PREPARE[campus as '绍兴' | '下沙'].am}**`);
  const morning = campus === '绍兴' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
  for (const slot of morning) {
    lines.push(`- 第 ${slot} 节：${BELLS[campus][slot][0]} – ${BELLS[campus][slot][1]}`);
  }
  lines.push(`- 下午预备铃 **${PREPARE[campus as '绍兴' | '下沙'].pm}**`);
  for (const slot of [6, 7, 8, 9]) {
    lines.push(`- 第 ${slot} 节：${BELLS[campus][slot][0]} – ${BELLS[campus][slot][1]}`);
  }
  lines.push(`- 晚上预备铃 **${PREPARE[campus as '绍兴' | '下沙'].eve}**`);
  for (const slot of [10, 11, 12]) {
    lines.push(`- 第 ${slot} 节：${BELLS[campus][slot][0]} – ${BELLS[campus][slot][1]}`);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## 需要你确认的地方');
lines.push('');
lines.push('### 1. 校区');
lines.push('');
lines.push(
  `课表截图里场地写的是"正心楼 / 创智楼"，**没有明写校区**。我按 ${CAMPUS} 作息录入，依据是：`
);
lines.push('');
lines.push('- 高等数学A1 在周四第 10–12 节，绍兴作息从 18:00 开始、下沙从 18:30 开始');
lines.push('- 截图里"绍兴/场"字样出现在多门课的场地字段');
lines.push('');
lines.push('**如果实际是下沙校区**，告诉我，我把默认校区换掉即可（课表内容不用改）。');
lines.push('');

lines.push('### 2. 截图本身信息不全的课');
lines.push('');
let idx = 0;
for (const course of SEED_COURSES) {
  for (const session of course.sessions) {
    if (!session.uncertain) continue;
    idx += 1;
    lines.push(
      `${idx}. **${course.name}**（${WEEKDAY_CN[session.weekday]} 第 ${session.startSlot}–${session.endSlot} 节）`
    );
    lines.push(`   - 现状：${session.note}`);
    lines.push(`   - 不确定原因：${session.uncertainReason}`);
  }
}
if (idx === 0) lines.push('（无）');
lines.push('');

lines.push('### 3. 周次含义待确认');
lines.push('');
lines.push('- **大学英语A** 周四 6–7 节，截图写"(双)"，我目前按**连续周次**录入（第 2–16 周每周都上）。');
lines.push('  如果"(双)"是指**只上双周**，需要改成双周规则。');
lines.push('- **"课外实践不在教室"**：周一中国近现代史纲要（第 7–8 周）与心理课（第 4、10 周）都标了这句。');
lines.push('  请确认它表示"这门课照上、只是换地点"，还是"这两周不用来上课"。');
lines.push('');
lines.push('### 4. 其它');
lines.push('');
lines.push('- 形势与政策1 截图写的是 6–9 周；如果实际是别的周次请指出。');
lines.push('- 电子信息类学科导论在周六第 1–4 节、第 8–11 周；教师名我读作"吴老师"，第二字形近可能存在偏差。');
lines.push('');

const target = join(outDir, '课表核对清单.md');
writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`已生成：${target}`);
console.log(`共 ${SEED_COURSES.length} 门课、${SEED_COURSES.reduce((n, c) => n + c.sessions.length, 0)} 条上课安排。`);
