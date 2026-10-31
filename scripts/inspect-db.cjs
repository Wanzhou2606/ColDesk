const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.env.APPDATA, 'coldesk', 'coldesk.db');
console.log('数据库:', dbPath, '存在:', fs.existsSync(dbPath));

const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (sql) => db.prepare(sql).get().c;

console.log('--- 设置 ---');
for (const r of db.prepare('SELECT key, value FROM setting').all()) {
  console.log(`  ${r.key} = ${r.value.length > 240 ? r.value.slice(0, 240) + '…' : r.value}`);
}

console.log('--- 作息与课程 ---');
console.log('  作息时段总数 =', one('SELECT COUNT(*) c FROM time_slot'), '（绍兴 14 + 下沙 15 = 29）');
const sxAll = one("SELECT COUNT(*) c FROM time_slot WHERE campus='绍兴'");
const sxBell = one("SELECT COUNT(*) c FROM time_slot WHERE campus='绍兴' AND is_prepare_bell=1");
console.log(`  绍兴：合计 ${sxAll}，其中预备铃 ${sxBell}，正常节次 ${sxAll - sxBell}`);
console.log('  课程 =', one('SELECT COUNT(*) c FROM course WHERE deleted_at IS NULL'));
console.log('  上课安排 =', one('SELECT COUNT(*) c FROM course_session WHERE deleted_at IS NULL'));
console.log('  任务 =', one('SELECT COUNT(*) c FROM task WHERE deleted_at IS NULL'));
console.log('  已编排块 =', one('SELECT COUNT(*) c FROM schedule_block WHERE deleted_at IS NULL'));
console.log('  提醒条数 =', one('SELECT COUNT(*) c FROM reminder'));

const sem = db.prepare('SELECT name, start_date FROM semester WHERE is_active = 1').get();
console.log('--- 学期 ---');
console.log(' ', sem.name, '| 第1周周一', sem.start_date);

console.log('--- 真实课表抽查（前 6 条安排）---');
const rows = db
  .prepare(
    `SELECT cs.weekday, cs.start_slot, cs.end_slot, cs.week_list, cs.room, c.name
     FROM course_session cs JOIN course c ON c.id = cs.course_id
     WHERE cs.deleted_at IS NULL
     ORDER BY cs.weekday, cs.start_slot LIMIT 6`
  )
  .all();
for (const r of rows) {
  const wd = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][r.weekday];
  console.log(`  ${wd} 第${r.start_slot}-${r.end_slot}节 [${r.week_list}周] ${r.name} @${r.room}`);
}

db.close();
