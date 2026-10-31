const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(process.env.APPDATA, 'coldesk', 'coldesk.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (sql, ...args) => db.prepare(sql).get(...args).c;

console.log('库:', dbPath);
console.log('--- 记账表是否已建 ---');
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'expense%'")
  .all()
  .map((r) => r.name);
console.log('  建到的表:', tables.join(', ') || '（无）');

console.log('--- 数据 ---');
console.log('  分类数 =', one('SELECT COUNT(*) c FROM expense_category'));
console.log('  流水数 =', one('SELECT COUNT(*) c FROM expense_entry'));

console.log('--- 分类与每日目标 ---');
for (const r of db
  .prepare('SELECT name, icon, daily_target FROM expense_category ORDER BY sort_order')
  .all()) {
  console.log(`  ${r.icon} ${r.name}  ¥${r.daily_target}/天`);
}

console.log('--- 每日总预算设置 ---');
const budget = db.prepare("SELECT value FROM setting WHERE key='expense_daily_budget'").get();
console.log('  ', budget ? budget.value : '（未设置）');

console.log('--- 按天汇总（最近 10 天）---');
for (const r of db
  .prepare(
    `SELECT occurred_on, ROUND(SUM(amount),2) AS total, COUNT(*) AS n
     FROM expense_entry GROUP BY occurred_on ORDER BY occurred_on DESC LIMIT 10`
  )
  .all()) {
  console.log(`  ${r.occurred_on}  ¥${r.total}  (${r.n} 笔)`);
}

console.log('--- 按分类汇总 ---');
for (const r of db
  .prepare(
    `SELECT c.name, ROUND(SUM(e.amount),2) AS total, c.daily_target
     FROM expense_entry e JOIN expense_category c ON c.id = e.category_id
     GROUP BY c.id ORDER BY total DESC`
  )
  .all()) {
  const over = r.total > r.daily_target ? '  ← 超目标' : '';
  console.log(`  ${r.name.padEnd(6)} ¥${String(r.total).padEnd(7)} 目标 ¥${r.daily_target}${over}`);
}

db.close();
