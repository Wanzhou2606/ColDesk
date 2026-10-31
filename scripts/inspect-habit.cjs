const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(process.env.APPDATA, 'coldesk', 'coldesk.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('库:', dbPath);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'habit%'")
  .all()
  .map((r) => r.name);
console.log('打卡表:', tables.join(', ') || '(无)');

console.log('习惯数:', db.prepare('SELECT COUNT(*) c FROM habit').get().c);
console.log('签到数:', db.prepare('SELECT COUNT(*) c FROM habit_checkin').get().c);

if (tables.includes('habit')) {
  console.log('--- 习惯列表 ---');
  for (const r of db.prepare('SELECT name, icon, active_days, start_date FROM habit ORDER BY sort_order').all()) {
    console.log(`  ${r.icon} ${r.name} | 星期 [${r.active_days || '每天'}] | 自 ${r.start_date}`);
  }
}

db.close();
