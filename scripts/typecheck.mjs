/**
 * 类型检查入口。
 *
 * 为什么不直接在 package.json 里写 `tsc -p a && tsc -p b`：
 * 这个项目有过一次很贵的教训——`tsc` 从 PATH 找不到时命令会直接失败，
 * 而当时的脚本是 `tsc node && tsc web` 两段式，
 * **第一段一失败，第二段永远不会执行**，于是"类型检查"这件事长期等于没做。
 * 更糟的是它看起来像"通过了"，因为没有人去确认输出。
 *
 * 结果：主进程积压了 12 个类型错误都没人知道，其中一个
 * （`win.moveBottom()` —— 该方法只在 macOS 存在）会在 Windows 上直接抛异常。
 *
 * 所以这里改成：
 *   1. 显式用 Node 执行本地 tsc，不依赖 PATH
 *   2. 两个 tsconfig **都跑**，且各自报告结果，互不影响
 *   3. 缺 @types/node 这类环境问题会给出可操作的提示，而不是一句 "not found type definition file"
 *   4. 退出码反映"生产代码是否干净"，便于接进 CI
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

if (!existsSync(tsc)) {
  console.error('找不到本地 typescript：node_modules/typescript/bin/tsc');
  console.error('请先执行 pnpm install');
  process.exit(1);
}

// 主进程编译需要 Node 的类型定义；缺了会报 "Cannot find type definition file for 'node'"，
// 而那条报错信息完全没提"你没装 @types/node"，对排查很不友好，所以在这里先拦一道。
const nodeTypes = join(root, 'node_modules', '@types', 'node', 'package.json');
if (!existsSync(nodeTypes)) {
  console.error('缺少 @types/node —— 主进程代码将无法进行类型检查。');
  console.error('修复：pnpm add -D @types/node');
  process.exit(1);
}

const projects = [
  { name: '主进程 / preload / shared', config: 'tsconfig.node.json' },
  { name: '渲染层 / 测试', config: 'tsconfig.web.json' }
];

const failures = [];

for (const project of projects) {
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', project.config], {
    cwd: root,
    encoding: 'utf8'
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.status === 0) {
    console.log(`✔ ${project.name}  类型检查通过`);
    continue;
  }

  failures.push(project.name);
  console.log(`✖ ${project.name}  类型检查未通过`);
  if (output) console.log(output);
}

console.log('');
if (failures.length === 0) {
  console.log('全部类型检查通过。');
  process.exit(0);
}

console.log(`${failures.length} 个检查未通过：${failures.join('、')}`);
process.exit(1);
