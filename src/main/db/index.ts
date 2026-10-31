/**
 * 数据库连接与迁移。放在主进程，渲染进程只能通过 IPC 访问。
 *
 * 驱动选择交给 driver.ts：优先原生 better-sqlite3，缺失时回退 node:sqlite。
 *
 * 测试隔离：当环境变量 COLDESK_DB_FACTORY=fake 时，使用真正的 SQLite 驱动，
 * 但设置项改为内存实现，这样主进程数据层可以在纯 Node 下端到端测试，
 * 不需要把 electron 一起拉进来。
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { SCHEMA_SQL } from './schema';
import { SEED_COURSES, SEED_EXPENSE_CATEGORIES, SEED_EXPENSE_ENTRIES, SEED_HABITS, SEED_SEMESTER, SEED_TASKS } from './seed-data';
import { detectDriver, openDatabase, type DriverDatabase } from './driver';
import { createAppDatabase, type AppDatabase } from './factory';
import { nowLocal, today } from '@shared/time';
import {courseColorAt} from '@shared/courseColors';

let db: AppDatabase | null = null;
let dataDir = '';
let activeDriver: ReturnType<typeof detectDriver> = 'none';

export function getDataDir(): string {
  return dataDir;
}

export function getDriver(): ReturnType<typeof detectDriver> {
  return activeDriver;
}

/** 探针：不初始化数据库也能知道当前环境能用哪个驱动 */
export function detectDriverName(): ReturnType<typeof detectDriver> {
  return detectDriver();
}

export function getDb(): AppDatabase {
  if (!db) throw new Error('数据库尚未初始化，请先调用 initDatabase()');
  return db;
}

export function initDatabase(dir: string, filename = 'coldesk.db'): AppDatabase {
  const inMemory = filename === ':memory:';
  if (!inMemory) {
    dataDir = dir;
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'backup'), { recursive: true });
  }

  activeDriver = detectDriver();
  if (activeDriver === 'none') {
    throw new Error(
      '没有可用的 SQLite 驱动：better-sqlite3 未构建，且当前运行时不含 node:sqlite。' +
        '请重新执行 pnpm install（需要网络下载 Electron 与预编译模块），或升级 Electron。'
    );
  }

  const driver: DriverDatabase = openDatabase(inMemory ? ':memory:' : join(dir, filename));
  db = createAppDatabase(driver);

  driver.exec('PRAGMA foreign_keys = ON;');
  driver.exec(SCHEMA_SQL);
  // 兼容安装过旧版本的用户；迁移只添加字段，不改动已有任务。
  driver.transaction(() => {
    const courseColumns=driver.prepare('PRAGMA table_info(course)').all() as Array<{name:string}>;
    if(!courseColumns.some(column=>column.name==='color_custom')){
      driver.exec('ALTER TABLE course ADD COLUMN color_custom INTEGER NOT NULL DEFAULT 0');
      const courses=driver.prepare('SELECT id,semester_id AS semesterId FROM course ORDER BY semester_id,name,id').all() as Array<{id:string;semesterId:string}>;
      const counts=new Map<string,number>();for(const course of courses){const index=counts.get(course.semesterId)??0;driver.prepare('UPDATE course SET color=? WHERE id=?').run(courseColorAt(index),course.id);counts.set(course.semesterId,index+1);}
    }
    const taskColumns = driver.prepare('PRAGMA table_info(task)').all() as Array<{ name: string }>;
    if (!taskColumns.some(column => column.name === 'is_pinned')) driver.exec('ALTER TABLE task ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
    const sessionColumns=driver.prepare('PRAGMA table_info(course_session)').all() as Array<{name:string}>;
    for(const column of ['start_time','end_time'])if(!sessionColumns.some(c=>c.name===column))driver.exec(`ALTER TABLE course_session ADD COLUMN ${column} TEXT`);
    const goalColumns=driver.prepare('PRAGMA table_info(goal_node)').all() as Array<{name:string}>;
    for(const [name,definition] of [['target_amount','REAL'],['current_amount','REAL NOT NULL DEFAULT 0'],['unit',"TEXT NOT NULL DEFAULT ''"]]){
      if(!goalColumns.some(column=>column.name===name))driver.exec(`ALTER TABLE goal_node ADD COLUMN ${name} ${definition}`);
    }
  })();

  if (!inMemory) {
    driver.exec('PRAGMA journal_mode = WAL;');
    backupIfNeeded();
  }
  return db;
}

/** 启动时做一次滚动备份，保留最近 14 份 */
export function backupIfNeeded(): string | undefined {
  if (!db || !dataDir) return undefined;
  const dir = join(dataDir, 'backup');
  const stamp = nowLocal().replace(/[:T]/g, '-').slice(0, 16);
  const target = join(dir, `coldesk-${stamp}.db`);
  if (existsSync(target)) return target;

  try {
    // 先 checkpoint，保证备份内容完整
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch {
    return undefined;
  }

  const files = readdirSync(dir)
    .filter((f: string) => f.startsWith('coldesk-') && f.endsWith('.db'))
    .map((f: string) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a: { t: number }, b: { t: number }) => b.t - a.t);
  for (const stale of files.slice(14)) {
    try {
      unlinkSync(join(dir, stale.f));
    } catch {
      /* 文件被占用时忽略，下次启动再清理 */
    }
  }
  return target;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      /* 忽略 */
    }
    db.close();
    db = null;
  }
}

const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * 首次运行时写入示例数据，让悬浮窗一打开就有内容可看。
 * 用户提供的真实作息表替换这里的时间即可。
 */
export function seedIfEmpty(): void {
  const d = getDb();
  const ts = nowLocal();

  /*
   * 记账的种子必须在这个 early return **之前**执行。
   *
   * 因为老用户的库里 semester 已经非空、会直接 return，
   * 若把记账种子放在后面，升级后打开记账页会看到"一个分类都没有"，
   * 连记一笔都做不到。seedExpenses 自带"是否已初始化"判断，所以重复调用是安全的。
   */
  seedExpenses(d, ts);
  // 打卡示例习惯同理：放在 early return 之前，老库也能补上
  seedHabits(d, ts);

  const count = d.prepare('SELECT COUNT(*) AS c FROM semester').get() as { c: number };
  if (count.c > 0) return;

  // 2026-2027 学年第 1 学期：第 1 教学周的周一是 2026-09-07
  const semesterId = SEED_SEMESTER.id;
  d.prepare(
    'INSERT INTO semester (id, name, start_date, total_weeks, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(semesterId, SEED_SEMESTER.name, SEED_SEMESTER.startDate, SEED_SEMESTER.totalWeeks, 1, ts, ts);

  /**
   * 作息表（来自用户提供的截图）。两个校区的节次时间不同，所以按校区分别存。
   * 结构：上午 5 节 / 下午 4 节（第六~九节）/ 晚上 3 节（第十~十二节），
   * 每个半天前有一道预备铃（is_prepare_bell=1，不参与排课，只用于提前提醒）。
   * 下沙的第五节在绍兴不排课。
   */
  const slotRows: Array<{
    campus: string;
    index: number;
    period: 'am' | 'pm' | 'eve';
    start: string;
    end: string;
    prepare?: boolean;
  }> = [
    // 下沙校区
    { campus: '下沙', index: 0, period: 'am', start: '08:00', end: '08:00', prepare: true },
    { campus: '下沙', index: 1, period: 'am', start: '08:05', end: '08:50' },
    { campus: '下沙', index: 2, period: 'am', start: '08:55', end: '09:40' },
    { campus: '下沙', index: 3, period: 'am', start: '10:00', end: '10:45' },
    { campus: '下沙', index: 4, period: 'am', start: '10:50', end: '11:35' },
    { campus: '下沙', index: 5, period: 'am', start: '11:40', end: '12:25' },
    { campus: '下沙', index: 6, period: 'pm', start: '13:25', end: '13:25', prepare: true },
    { campus: '下沙', index: 6, period: 'pm', start: '13:30', end: '14:15' },
    { campus: '下沙', index: 7, period: 'pm', start: '14:20', end: '15:05' },
    { campus: '下沙', index: 8, period: 'pm', start: '15:15', end: '16:00' },
    { campus: '下沙', index: 9, period: 'pm', start: '16:05', end: '16:50' },
    { campus: '下沙', index: 10, period: 'eve', start: '18:25', end: '18:25', prepare: true },
    { campus: '下沙', index: 10, period: 'eve', start: '18:30', end: '19:15' },
    { campus: '下沙', index: 11, period: 'eve', start: '19:20', end: '20:05' },
    { campus: '下沙', index: 12, period: 'eve', start: '20:10', end: '20:55' },
    // 绍兴校区
    { campus: '绍兴', index: 0, period: 'am', start: '08:35', end: '08:35', prepare: true },
    { campus: '绍兴', index: 1, period: 'am', start: '08:40', end: '09:25' },
    { campus: '绍兴', index: 2, period: 'am', start: '09:30', end: '10:15' },
    { campus: '绍兴', index: 3, period: 'am', start: '10:25', end: '11:10' },
    { campus: '绍兴', index: 4, period: 'am', start: '11:15', end: '12:00' },
    { campus: '绍兴', index: 6, period: 'pm', start: '13:25', end: '13:25', prepare: true },
    { campus: '绍兴', index: 6, period: 'pm', start: '13:30', end: '14:15' },
    { campus: '绍兴', index: 7, period: 'pm', start: '14:20', end: '15:05' },
    { campus: '绍兴', index: 8, period: 'pm', start: '15:15', end: '16:00' },
    { campus: '绍兴', index: 9, period: 'pm', start: '16:05', end: '16:50' },
    { campus: '绍兴', index: 10, period: 'eve', start: '17:55', end: '17:55', prepare: true },
    { campus: '绍兴', index: 10, period: 'eve', start: '18:00', end: '18:45' },
    { campus: '绍兴', index: 11, period: 'eve', start: '18:50', end: '19:35' },
    { campus: '绍兴', index: 12, period: 'eve', start: '19:40', end: '20:25' }
  ];

  const insertSlot = d.prepare(
    `INSERT INTO time_slot (id, semester_id, slot_index, period, start_time, end_time, campus, is_prepare_bell)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  let slotSeq = 0;
  for (const row of slotRows) {
    slotSeq += 1;
    insertSlot.run(
      `slot_${slotSeq}`,
      semesterId,
      row.index,
      row.period,
      row.start,
      row.end,
      row.campus,
      row.prepare ? 1 : 0
    );
  }

  // 当前学期按绍兴校区作息（用户的课表场地以正心楼 / 创智楼为主）
  d.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES ('campus', '绍兴', ?)
     ON CONFLICT(key) DO UPDATE SET value = '绍兴', updated_at = ?`
  ).run(ts, ts);

  // ---------------------------------------------------------- 真实课表
  // 数据来自用户提供的课表截图，见 seed-data.ts
  const insertCourse = d.prepare(
    `INSERT INTO course (id, semester_id, name, teacher, color, credit, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const insertSession = d.prepare(
    `INSERT INTO course_session (id, course_id, weekday, start_slot, end_slot, room, week_mode, week_list, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  for (const course of SEED_COURSES) {
    const courseId = `c_${course.key}`;
    const noteParts: string[] = [];
    if (course.campus) noteParts.push(`校区：${course.campus}`);
    if (course.classNo) noteParts.push(`教学班：${course.classNo}`);
    for (const session of course.sessions) {
      if (session.weekPattern) noteParts.push(session.weekPattern);
      if (session.uncertain) noteParts.push(`待确认：${session.uncertainReason ?? session.note ?? ''}`);
    }

    insertCourse.run(
      courseId,
      semesterId,
      course.name,
      course.teacher || null,
      course.color,
      course.credit ?? null,
      noteParts.join('；') || null,
      ts,
      ts
    );

    course.sessions.forEach((session, index) => {
      insertSession.run(
        `sess_${course.key}_${index + 1}`,
        courseId,
        session.weekday,
        session.startSlot,
        session.endSlot,
        session.room ?? course.room,
        'custom',
        session.weekList,
        ts,
        ts
      );
    });
  }

  // ---------------------------------------------------------- 示例任务
  const insertTask = d.prepare(`
    INSERT INTO task (id, domain, type, title, detail, source, course_id, urgency, status, due_at,
                      est_minutes, splittable, remind_policy, auto_scheduled, created_at, updated_at)
    VALUES (@id, @domain, @type, @title, @detail, 'manual', @course_id, @urgency, 'open', @due_at,
            @est_minutes, 1, 'default', 1, @ts, @ts)
  `);

  for (const item of SEED_TASKS) {
    insertTask.run({
      id: uid('task'),
      domain: 'study',
      type: item.type,
      title: item.title,
      detail: item.detail ?? null,
      course_id: `c_${item.courseKey}`,
      urgency: item.urgency,
      due_at: `${addDaysStr(today(), item.dueInDays)}T${item.dueTime}`,
      est_minutes: item.estMinutes,
      ts
    });
  }

  // 生活任务单独来一条，验证分区互不挤占
  insertTask.run({
    id: uid('task'),
    domain: 'life',
    type: 'todo',
    title: '去操场跑步 3km',
    detail: '示例数据，可删除',
    course_id: null,
    urgency: 2,
    due_at: `${addDaysStr(today(), 2)}T23:59`,
    est_minutes: 40,
    ts
  });
}

/**
 * 记账的默认分类与示例流水。
 *
 * 自带"是否已初始化"判断，所以可以在每次 seedIfEmpty 时安全调用；
 * 正因如此它被放在 seedIfEmpty 的 early return 之前，
 * 让 semester 已存在的老库也能补上记账分类。
 */
export function initializeUserData(): void {
  const d = getDb();
  if (d.prepare("SELECT value FROM setting WHERE key = 'user_defaults_initialized'").get()) return;
  d.exec('BEGIN');
  try {
    seedExpenses(d, nowLocal(), false);
    d.prepare("INSERT INTO setting (key, value, updated_at) VALUES ('user_defaults_initialized', '1', ?)").run(nowLocal());
    d.exec('COMMIT');
  } catch (error) { d.exec('ROLLBACK'); throw error; }
}

function seedExpenses(d: ReturnType<typeof getDb>, ts: string, sample = true): void {
  const existing = d.prepare('SELECT COUNT(*) AS c FROM expense_category').get() as { c: number };
  if (existing.c > 0) return;

  const insertCategory = d.prepare(
    `INSERT INTO expense_category (id, name, icon, color, daily_target, sort_order, created_at, updated_at)
     VALUES (@id, @name, @icon, @color, @daily_target, @sort_order, @ts, @ts)`
  );
  const categoryIdByKey = new Map<string, string>();

  SEED_EXPENSE_CATEGORIES.forEach((category, index) => {
    const id = `cat_${category.key}`;
    categoryIdByKey.set(category.key, id);
    insertCategory.run({
      id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      daily_target: sample ? category.dailyTarget : 0,
      sort_order: index,
      ts
    });
  });

  if (!sample) return;
  const insertEntry = d.prepare(
    `INSERT INTO expense_entry (id, category_id, amount, note, occurred_on, created_at)
     VALUES (@id, @category_id, @amount, @note, @occurred_on, @ts)`
  );
  for (const entry of SEED_EXPENSE_ENTRIES) {
    const categoryId = categoryIdByKey.get(entry.categoryKey);
    // 分类找不到就跳过，而不是写一条没有归属的流水（外键也会拦，但错误信息不如这里清楚）
    if (!categoryId) continue;
    insertEntry.run({
      id: uid('exp'),
      category_id: categoryId,
      amount: entry.amount,
      note: entry.note,
      occurred_on: addDaysStr(today(), entry.dayOffset),
      ts
    });
  }

  /*
   * 注意：这里**不写"每日总预算"这类设置项**。
   *
   * 踩过的坑：种子若直接用原生 SQL 写 setting 表，而应用读取走的是设置封装层，
   * 在测试环境（COLDESK_DB_FACTORY=fake，设置走内存实现）下就会出现
   * "种子写了、应用读不到"。真实运行时两者恰好是同一个存储，
   * 但这个分叉在测试里被掩盖了——结果就是每日总预算一直是空的，
   * 界面上预算进度与超支判断都不显示。
   *
   * 所以设置项一律交给 store 在启动时用封装层初始化（见 store.ensureDefaults）。
   */
}

/** 打卡示例习惯：只在完全为空时灌入，startDate 固定为今天 */
function seedHabits(d: ReturnType<typeof getDb>, ts: string): void {
  const existing = d.prepare('SELECT COUNT(*) AS c FROM habit').get() as { c: number };
  if (existing.c > 0) return;

  const insert = d.prepare(
    `INSERT INTO habit (id, name, icon, color, active_days, start_date, sort_order, archived, created_at, updated_at)
     VALUES (@id, @name, @icon, @color, @active_days, @start_date, @sort_order, 0, @ts, @ts)`
  );
  SEED_HABITS.forEach((habit, index) => {
    insert.run({
      id: `habit_${habit.key}`,
      name: habit.name,
      icon: habit.icon,
      color: habit.color,
      active_days: habit.activeDays.join(','),
      start_date: today(),
      sort_order: index,
      ts
    });
  });
}

function fmtDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + days);
  return fmtDateStr(d);
}

export type { AppDatabase };
