/**
 * 核实接手指南里写下的可验证数字/路径是否与工程实际一致。
 *
 * 文档里的数字如果错了，会让接手的 AI 直接误判环境。所以逐个对一遍。
 * 用法：node --import tsx scripts/verify-handoff.mts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

/* 路径 */
check('src/shared/quote.ts 存在', existsSync(join(root, 'src/shared/quote.ts')));
check('src/main/quote.ts 已删除（不应存在）', !existsSync(join(root, 'src/main/quote.ts')));
check('src/main/db/schema.ts 存在', existsSync(join(root, 'src/main/db/schema.ts')));
check('src/renderer/src/pages/HabitsPage.tsx 存在', existsSync(join(root, 'src/renderer/src/pages/HabitsPage.tsx')));
check('src/renderer/src/pages/ExpensesPage.tsx 存在', existsSync(join(root, 'src/renderer/src/pages/ExpensesPage.tsx')));
check('scripts/start-coldesk.bat 存在', existsSync(join(root, 'scripts/start-coldesk.bat')));
check('scripts/typecheck.mjs 存在', existsSync(join(root, 'scripts/typecheck.mjs')));
check('preview/app.html 存在', existsSync(join(root, 'preview/app.html')));

/* 表数量 */
const schema = readFileSync(join(root, 'src/main/db/schema.ts'), 'utf8');
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
check('表数量 = 21', tables.length === 21, `实际 ${tables.length}：${tables.join(', ')}`);
check('expense_month_budget 表在', tables.includes('expense_month_budget'));
check('habit_checkin 表在', tables.includes('habit_checkin'));

/* 测试文件 vs package.json 列表 */
const testFiles: string[] = [];
for (const dir of ['src/shared/__tests__', 'src/main/__tests__', 'src/renderer/__tests__']) {
  for (const f of readdirSync(join(root, dir))) {
    if (f.endsWith('.test.ts')) testFiles.push(`${dir}/${f}`);
  }
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: { test: string };
};
const listed = pkg.scripts.test.split(/\s+/).filter((s) => s.endsWith('.test.ts'));
const missing = testFiles.filter((t) => !listed.includes(t));
check('所有测试文件都已列入 test 脚本', missing.length === 0, missing.join(', '));
check('测试文件数量 = 14', testFiles.length === 14, `实际 ${testFiles.length}`);

/* 环境开关 */
const allSrc = readdirSync(join(root, 'src'), { recursive: true })
  .filter((f): f is string => typeof f === 'string' && /\.(ts|tsx|mts|mjs|cjs)$/.test(f))
  .map((f) => readFileSync(join(root, 'src', f), 'utf8'))
  .join('\n');
for (const flag of ['COLDESK_DB_FACTORY', 'COLDESK_DISABLE_SCHEDULER', 'COLDESK_LOG_STDOUT']) {
  check(`环境开关 ${flag} 存在`, allSrc.includes(flag));
}

/* 关键防护是否还在 */
const windowsSrc = readFileSync(join(root, 'src/main/windows.ts'), 'utf8');
// 注意：注释里会提到 moveBottom（用来解释为什么不能用），所以要先剥掉注释再判断。
// 简单子串匹配会命中注释并误报——这个坑本身也值得记在文档里。
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

check(
  'windows.ts 不在代码里调用 moveBottom（注释里提到是允许的）',
  !stripComments(windowsSrc).includes('moveBottom')
);
check('windows.ts 不设 backgroundMaterial', !/backgroundMaterial\s*:/.test(windowsSrc));
const storeSrc = readFileSync(join(root, 'src/main/store.ts'), 'utf8');
check('store.load 里有 refreshReminders', /refreshReminders\(\)/.test(storeSrc));
check('store 有 ensureDefaults', /ensureDefaults/.test(storeSrc));
check('store 有 replanCount', /replanCount/.test(storeSrc));
const bootstrapSrc = readFileSync(join(root, 'src/main/__tests__/bootstrap.test.ts'), 'utf8');
// 替身里不该再定义 moveBottom 方法；但断言里要提到这个字符串，所以判断"是否定义了方法"
check(
  'bootstrap 替身不再定义 moveBottom 方法',
  !/moveBottom\(\)\s*\{/.test(bootstrapSrc)
);
check(
  'bootstrap 有"不得调用 moveBottom"的防回归断言',
  bootstrapSrc.includes('不得调用 moveBottom')
);
check('bootstrap 用 schedulableDueAt', bootstrapSrc.includes('schedulableDueAt'));
const tsNode = readFileSync(join(root, 'tsconfig.node.json'), 'utf8');
check('tsconfig.node 排除主进程测试文件', tsNode.includes('src/main/__tests__'));

/* 报告 */
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? '✔' : '✖'} ${c.name}${c.detail ? `  → ${c.detail}` : ''}`);
}
console.log('');
console.log(`${checks.length - failed} / ${checks.length} 项与文档描述一致`);
process.exit(failed === 0 ? 0 : 1);
