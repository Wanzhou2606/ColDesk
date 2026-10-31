/**
 * 检查当前数据库里的流水是否"仍是示例数据"。
 *
 * 这直接决定界面上"清空示例数据"按钮是否出现：
 * 指纹一致 → 出现；用户改过任何一笔 → 自动消失。
 *
 * 用真实的 seed-data 指纹做比对，不重新实现一份逻辑，
 * 避免"检查脚本与产品代码各算各的"导致结论不一致。
 *
 * 用法：node --import tsx scripts/check-sample-state.mts
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { SEED_EXPENSE_ENTRIES, SEED_EXPENSE_CATEGORIES, SEED_EXPENSE_FINGERPRINT } from '../src/main/db/seed-data';

const dbPath = join(process.env.APPDATA ?? '.', 'coldesk', 'coldesk.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const rows = db
  .prepare(
    `SELECT c.name AS name, e.amount AS amount, e.note AS note
     FROM expense_entry e JOIN expense_category c ON c.id = e.category_id`
  )
  .all() as Array<{ name: string; amount: number; note: string }>;

// 与 repositories.expenseEntriesFingerprint 完全相同的排序方式
const actual = rows
  .map((r, index) => ({ key: `${r.name}|${r.amount}|${r.note}`, index }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
  .map((r) => r.key)
  .join('\n');

const isSample = rows.length > 0 && actual === SEED_EXPENSE_FINGERPRINT;

console.log('库:', dbPath);
console.log('种子示例笔数 =', SEED_EXPENSE_ENTRIES.length, '| 种子分类数 =', SEED_EXPENSE_CATEGORIES.length);
console.log('当前流水笔数 =', rows.length);
console.log('指纹是否一致 =', actual === SEED_EXPENSE_FINGERPRINT ? '一致' : '不一致');
console.log('');
console.log(
  isSample
    ? '结论：当前仍是示例数据 → 界面会显示「清空示例数据」按钮'
    : '结论：流水已被改动过 → 按钮不显示（避免误删真实记录）'
);

db.close();
