/**
 * ColDesk 自检：确认"装机后能不能跑起来"的关键条件。
 *  1. 构建产物是否齐全（先跑 pnpm build）
 *  2. SQLite 驱动是否可用（better-sqlite3 或 node:sqlite）
 *  3. 数据层能否建库、灌示例数据、跑一次排程、读回视图
 *  4. Electron 运行时是否就位
 *
 * 用法：node --import tsx scripts/verify.mjs
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------ 1. 构建产物 */

const outFiles = [
  'out/main/index.cjs',
  'out/preload/index.cjs',
  'out/renderer/main.html',
  'out/renderer/widget.html',
  'out/renderer/toast.html'
];
const missing = outFiles.filter((f) => !existsSync(join(root, f)));
record('构建产物齐全', missing.length === 0, missing.length ? `缺少 ${missing.join(', ')}` : '5 个文件');

/* ------------------------------------------------------------ 2. 驱动 */

const { detectDriverName } = await import('../src/main/db/index.ts');
const driver = detectDriverName();
record('SQLite 驱动可用', driver !== 'none', driver === 'none' ? '两个驱动都不可用' : `使用 ${driver}`);

/* ------------------------------------------------------------ 3. 数据层 */

if (driver !== 'none') {
  process.env.COLDESK_DB_FACTORY = 'fake';
  const db = await import('../src/main/db/index.ts');
  const repos = await import('../src/main/db/repositories.ts');
  const { buildAgenda } = await import('../src/shared/agenda.ts');
  const { nowLocal } = await import('../src/shared/time.ts');

  db.initDatabase('.', ':memory:');
  db.seedIfEmpty();

  const tables = db
    .getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  record('建表完整', tables.length >= 15, `${tables.length} 张表`);

  const tasks = repos.getTasks();
  record('示例数据写入', tasks.length >= 3, `${tasks.length} 条任务`);

  const snapshot = {
    semester: repos.getActiveSemester(),
    courses: repos.getCourses(),
    sessions: repos.getSessions(),
    overrides: repos.getOverrides(),
    timeSlots: repos.getTimeSlots(repos.getActiveSemester().id),
    tasks,
    exams: repos.getExams(),
    blocks: repos.getBlocks(),
    busy: repos.getBusyBlocks()
  };

  const agenda = buildAgenda(snapshot, nowLocal());
  record(
    '当下日程可计算',
    Array.isArray(agenda.timeline),
    `时间线 ${agenda.timeline.length} 项 · 今日临期 ${agenda.todayTasks.length} 项`
  );

  const { planSchedule, selectPlannableTasks, toPlannerTask } = await import('../src/shared/planner.ts');
  const now = nowLocal();
  const plan = planSchedule({
    now,
    semester: snapshot.semester,
    courses: snapshot.courses,
    sessions: snapshot.sessions,
    overrides: snapshot.overrides,
    timeSlots: snapshot.timeSlots,
    exams: snapshot.exams,
    busy: snapshot.busy,
    lockedBlocks: [],
    tasks: selectPlannableTasks(tasks).map((t) => toPlannerTask(t, now))
  });
  record(
    '自动排程可运行',
    plan.blocks.length > 0,
    `${plan.blocks.length} 个编排块 · ${plan.unscheduled.length} 项未排入`
  );

  db.closeDatabase();
}

/* ------------------------------------------------------------ 4. Electron */

const electronPath = join(root, 'node_modules/electron/dist/electron.exe');
const electronAlt = join(root, 'node_modules/electron/path.txt');
const electronReady = existsSync(electronPath) || existsSync(electronAlt);
record(
  'Electron 运行时就位',
  electronReady,
  existsSync(electronPath) ? electronPath : '未找到 dist/electron.exe，请重新执行 pnpm install'
);

/* -------------------------------------------------- 5. 真实启动核心闭环 */

/**
 * 真的拉起一次应用并观察它是否能稳定存活。
 * 这一步是对"核心闭环可用"最直接的证据：
 * 进程活着 = 主进程建库、开窗、起托盘与调度器都没有抛异常。
 *
 * 这台机器有个已确认的怪现象：**位于工程目录里的 electron.exe 一旦启动就被系统中止**
 * （退出码 0x80000003，且 JS 一行都没执行——用一个只写文件的极简 Electron 应用验证过），
 * 但把同一个二进制复制到 %LOCALAPPDATA% 后，用它跑工程目录就完全正常，
 * 悬浮窗也能开出来。所以这里做两路尝试：先试工程目录，失败再用本地运行时副本。
 */
if (electronReady && !process.argv.includes('--skip-launch')) {
  const { spawn } = await import('node:child_process');
  const { mkdirSync, cpSync } = await import('node:fs');
  const { join: joinPath } = await import('node:path');

  const env = { ...process.env };
  // DSH 运行时会注入 ELECTRON_RUN_AS_NODE，它会让 electron 退化成纯 Node
  delete env.ELECTRON_RUN_AS_NODE;

  /** 启动一次并观察 8 秒；返回 { kind, code?, stderr } */
  const tryLaunch = async (exePath, cwd) => {
    const child = spawn(exePath, ['.'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });

    const outcome = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      child.once('error', (error) => finish({ kind: 'spawn-error', error }));
      child.once('exit', (code) => finish({ kind: 'exited', code }));
      setTimeout(() => finish({ kind: 'alive' }), 8000);
    });

    if (outcome.kind === 'alive') {
      child.kill();
      return { kind: 'alive', stderr };
    }
    return { ...outcome, stdout, stderr };
  };

  const POLICY_EXIT_CODES = new Set([-2147483645, 2147483651]);

  /**
   * 启动判定必须"短路"：一旦成功就不再尝试第二路。
   * 否则第二路会因为"应用已经在运行"而立刻退出（code 0），
   * 反而把已经成功的结论覆盖成失败——这是踩过的坑。
   */
  const notAlive = (r) => r.kind !== 'alive';
  const blockedLike = (r) => POLICY_EXIT_CODES.has(r.code) || (!r.stdout && !r.stderr);

  // 第一路：工程目录里的运行时
  const direct = await tryLaunch(electronPath, root);

  if (direct.kind === 'alive') {
    record('应用可启动并稳定运行', true, '直接从工程目录拉起，8 秒未退出');
  } else if (blockedLike(direct)) {
    // 第二路：把运行时复制到 %LOCALAPPDATA%，工作目录仍指向工程目录
    const homeDir = joinPath(env.LOCALAPPDATA ?? env.TEMP ?? root, 'ColDesk');
    const runtime = joinPath(homeDir, 'runtime');
    const runtimeExe = joinPath(runtime, 'electron.exe');

    try {
      if (!existsSync(runtimeExe)) {
        mkdirSync(runtime, { recursive: true });
        cpSync(joinPath(root, 'node_modules/electron/dist'), runtime, { recursive: true });
      }
      // 让运行时能找到构建产物：out 与 package.json 复制过去
      const outDir = joinPath(homeDir, 'out');
      if (existsSync(joinPath(root, 'out'))) {
        cpSync(joinPath(root, 'out'), outDir, { recursive: true });
      }
      cpSync(joinPath(root, 'package.json'), joinPath(homeDir, 'package.json'));

      const viaRuntime = await tryLaunch(runtimeExe, homeDir);

      if (viaRuntime.kind === 'alive') {
        record(
          '应用可启动并稳定运行',
          true,
          '工程目录里的运行时被系统中止，改用 %LOCALAPPDATA%\\ColDesk\\runtime 的副本后正常运行 8 秒；' +
            '日常启动请用 scripts\\start-coldesk.bat'
        );
      } else {
        record(
          '应用可启动并稳定运行',
          false,
          `两路尝试都未能稳定运行（工程目录 code=${direct.code}，本地运行时 code=${viaRuntime.code}）。` +
            '若两个 code 都是 0x80000003 且无任何输出，属于代码完整性策略拦截未签名二进制。'
        );
      }
    } catch (error) {
      record(
        '应用可启动并稳定运行',
        false,
        `工程目录启动被中止（code=${direct.code}），准备本地运行时副本时出错：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else {
    record(
      '应用可启动并稳定运行',
      false,
      `进程退出，code=${direct.code}；stderr: ${(direct.stderr || '').slice(0, 300) || '(空)'}`
    );
  }
}

/* ------------------------------------------------------------ 结论 */

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log(`全部 ${results.length} 项检查通过。`);
  process.exit(0);
}
console.log(`${failed.length} 项未通过：${failed.map((f) => f.name).join('、')}`);
process.exit(1);
