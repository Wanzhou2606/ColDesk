/**
 * 数据层集成测试：真实建库（内存）、灌入示例数据、读回任务。
 * 通过 COLDESK_DB_FACTORY=fake 让设置项走内存，从而不必把 electron 拉进来。
 * 必须在 import 之前设置环境变量，因此这里用动态 import。
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

process.env.COLDESK_DB_FACTORY = 'fake';

/* eslint-disable @typescript-eslint/no-explicit-any */
let mod: any;
let repos: any;
let reminders: any;
let scoring: any;
let seedData: any;

describe('data layer: 建库 / 示例数据 / 任务状态', () => {
  before(async () => {
    mod = await import('../db/index.ts');
    repos = await import('../db/repositories.ts');
    reminders = await import('../../shared/reminders.ts');
    scoring = await import('../../shared/scoring.ts');
    seedData = await import('../db/seed-data.ts');
    mod.initDatabase('.', ':memory:');
  });

  after(() => {
    mod?.closeDatabase();
  });

  it('能打开数据库并建好全部表', () => {
    const driver = mod.detectDriverName();
    assert.ok(driver === 'better-sqlite3' || driver === 'node:sqlite', `驱动异常：${driver}`);

    const db = mod.getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    for (const expected of ['semester', 'course', 'course_session', 'task', 'schedule_block', 'reminder', 'note']) {
      assert.ok(tables.includes(expected), `缺少表 ${expected}`);
    }
  });

  it('首次运行写入示例数据，重复调用不会产生副本', () => {
    mod.seedIfEmpty();
    const first = repos.getTasks();
    assert.ok(first.length >= 3, `示例任务应有 3 条以上，实际 ${first.length}`);
    assert.ok(first.some((t: { domain: string }) => t.domain === 'life'), '示例数据应包含生活任务');

    mod.seedIfEmpty();
    assert.equal(repos.getTasks().length, first.length, '重复 seed 不应产生副本');
  });

  it('学期带两校区作息表，可按校区取节次时间', () => {
    const semester = repos.getActiveSemester();
    assert.ok(semester, '应有当前学期');
    assert.equal(semester.startDate, '2026-09-07', '第 1 教学周周一');
    assert.equal(semester.totalWeeks, 20);

    // 两个校区各自一整套节次（含预备铃）
    const all = repos.getTimeSlots(semester.id);
    const campuses = [...new Set(all.map((s) => s.campus))].sort();
    assert.deepEqual(campuses, ['下沙', '绍兴'], `校区应为下沙/绍兴，实际 ${campuses.join(',')}`);

    // 绍兴：上午 4 节（第五节不排课）、下午 4 节、晚上 3 节 = 11 节 + 3 道预备铃
    const shaoxing = repos.getTimeSlots(semester.id, '绍兴');
    assert.equal(shaoxing.filter((s) => !s.isPrepareBell).length, 11);
    assert.equal(shaoxing.filter((s) => s.isPrepareBell).length, 3, '上午/下午/晚上各一道预备铃');
    assert.equal(shaoxing.find((s) => s.slotIndex === 1 && !s.isPrepareBell)?.startTime, '08:40');
    assert.equal(shaoxing.find((s) => s.slotIndex === 12 && !s.isPrepareBell)?.endTime, '20:25');

    // 下沙：上午 5 节（含第五节）、下午 4 节、晚上 3 节 = 12 节
    const xiasha = repos.getTimeSlots(semester.id, '下沙');
    assert.equal(xiasha.filter((s) => !s.isPrepareBell).length, 12);
    assert.equal(xiasha.find((s) => s.slotIndex === 1 && !s.isPrepareBell)?.startTime, '08:05');
    assert.equal(xiasha.find((s) => s.slotIndex === 5 && !s.isPrepareBell)?.startTime, '11:40');

    const courses = repos.getCourses();
    const sessions = repos.getSessions();
    assert.equal(courses.length, 10, `真实课表应有 10 门课，实际 ${courses.length}`);
    assert.equal(sessions.length, 15, `截图共 15 条上课安排，实际 ${sessions.length}`);

    // 抽查一门跨两天的课，确认周次表达式与节次都按截图录入
    const calculus = courses.find((c) => c.name === '高等数学A1');
    assert.ok(calculus, '应有高等数学A1');
    assert.equal(calculus?.credit, 5.0);
    const calculusSessions = sessions.filter((s) => s.courseId === calculus?.id);
    assert.equal(calculusSessions.length, 2);
    assert.deepEqual(
      calculusSessions.map((s) => `${s.weekday}:${s.startSlot}-${s.endSlot}`).sort(),
      ['2:1-2', '4:10-12'],
      '高等数学A1 应在周二 1-2 节与周四 10-12 节'
    );
    assert.ok(
      calculusSessions.every((s) => s.weekMode === 'custom' && s.weekList === '2-17'),
      '周次应按截图存为自定义 2-17 周'
    );

    // 周一中国近现代史纲要按截图分成两段互不重叠的周次
    const history = courses.find((c) => c.name === '中国近现代史纲要');
    const historyWeeks = sessions
      .filter((s) => s.courseId === history?.id)
      .map((s) => s.weekList)
      .sort();
    assert.deepEqual(historyWeeks, ['2-6,9-17', '7-8']);
  });

  it('任务的紧迫度与预估时长能正确往返读写', () => {
    const created = repos.saveTask({
      title: '集成测试任务',
      domain: 'study',
      type: 'assignment',
      urgency: 5,
      dueAt: '2030-01-01T18:00',
      estMinutes: 120,
      splittable: false
    });
    assert.equal(created.urgency, 5);
    assert.equal(created.estMinutes, 120);
    assert.equal(created.splittable, false);
    assert.equal(created.status, 'open');

    const reloaded = repos.getTask(created.id);
    assert.equal(reloaded?.title, '集成测试任务');
    assert.equal(reloaded?.urgency, 5);
  });

  it('标记完成与恢复都能落库', () => {
    const target = repos.getTasks()[0];
    const done = repos.setTaskStatus(target.id, 'done');
    assert.equal(done?.status, 'done');
    assert.ok(done?.doneAt, '完成时应记录时间');

    const reopened = repos.setTaskStatus(target.id, 'open');
    assert.equal(reopened?.status, 'open');
    assert.equal(reopened?.doneAt, undefined);
  });

  it('自动排程结果可以落库，并能被锁定', () => {
    repos.applyAutoPlan([
      {
        taskId: repos.getTasks()[0].id,
        date: '2030-01-01',
        startAt: '2030-01-01T09:00',
        endAt: '2030-01-01T10:00',
        plannedMinutes: 60,
        origin: 'auto',
        reason: '测试用'
      }
    ]);
    const blocks = repos.getBlocks();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].locked, false);

    repos.lockBlock(blocks[0].id, '2030-01-01T14:00', '2030-01-01T15:00');
    const locked = repos.getBlocks()[0];
    assert.equal(locked.locked, true);
    assert.equal(locked.startAt, '2030-01-01T14:00');
    assert.equal(locked.plannedMinutes, 60);
  });

  it('通知去重键只记录一次', () => {
    const key = 'test:dedupe';
    assert.equal(repos.hasNotified(key), false);
    repos.recordNotification({ id: '', kind: 'reminder', dedupeKey: key, firedAt: '2030-01-01T09:00' });
    assert.equal(repos.hasNotified(key), true);
    repos.recordNotification({ id: '', kind: 'reminder', dedupeKey: key, firedAt: '2030-01-01T09:05' });
    assert.equal(repos.getRecentNotifications().filter((n: { dedupeKey: string }) => n.dedupeKey === key).length, 1);
  });

  /* -------------------------------------------------- 启动必须重建提醒 */

  /**
   * 回归测试：真实运行中踩到过 store.load() 漏掉 refreshReminders() 的 bug，
   * 后果是首次运行与每次重启后 reminder 表都是空的，多级提醒完全不触发。
   * 这里驱动数据层复现"启动时该做的那一步"，并断言结果。
   */
  it('启动重建提醒后，reminder 表按紧迫度生成正确条数', () => {
    const tasks = repos.getTasks().filter((t: any) => t.status === 'open' && t.dueAt);
    assert.ok(tasks.length > 0, '示例数据里应有带截止时间的未完成任务');

    let expected = 0;
    for (const task of tasks) {
      const drafts = reminders.reminderDraftsForTask(task);
      expected += drafts.length;
      repos.replaceRemindersForTask(
        task.id,
        drafts.map((d: any) => ({ fireAt: d.fireAt, level: d.level, reason: d.reason })),
        { title: task.title, urgency: task.urgency }
      );
    }

    const actual = (mod.getDb().prepare('SELECT COUNT(*) AS c FROM reminder').get() as { c: number }).c;
    assert.ok(expected > 0, '紧迫度较高的任务应产生多条提醒，否则这个测试没有意义');
    assert.equal(actual, expected, `提醒条数应为 ${expected}，实际 ${actual}`);

    // 逐个任务核对：条数应等于该紧迫度对应的提前量个数
    for (const task of tasks) {
      const stored = mod
        .getDb()
        .prepare("SELECT COUNT(*) AS c FROM reminder WHERE task_id = ? AND state = 'pending'")
        .get(task.id) as { c: number };
      const expectedForTask = scoring.urgencyMeta(task.urgency).offsets.length;
      assert.equal(
        stored.c,
        expectedForTask,
        `「${task.title}」紧迫度 ${task.urgency} 应有 ${expectedForTask} 条，实际 ${stored.c}`
      );
    }
  });

  it('重复重建提醒不会累加，完成任务后不再保留待触发提醒', () => {
    const before = (mod.getDb().prepare('SELECT COUNT(*) AS c FROM reminder').get() as { c: number }).c;
    const task = repos.getTasks().find((t: any) => t.status === 'open' && t.dueAt);
    const drafts = reminders.reminderDraftsForTask(task);
    repos.replaceRemindersForTask(
      task.id,
      drafts.map((d: any) => ({ fireAt: d.fireAt, level: d.level, reason: d.reason })),
      { title: task.title, urgency: task.urgency }
    );
    const after = (mod.getDb().prepare('SELECT COUNT(*) AS c FROM reminder').get() as { c: number }).c;
    assert.equal(after, before, '同一任务重复重建不应增加总条数');

    repos.setTaskStatus(task.id, 'done');
    repos.replaceRemindersForTask(task.id, [], { title: task.title, urgency: task.urgency });
    const pending = mod
      .getDb()
      .prepare("SELECT COUNT(*) AS c FROM reminder WHERE task_id = ? AND state = 'pending'")
      .get(task.id) as { c: number };
    assert.equal(pending.c, 0, '完成任务后不应再有待触发提醒');
  });

  /* -------------------------------------------------- 记账：示例数据指纹 */

  /**
   * 这两条是"清空示例数据"按钮能否正确出现/消失的基础。
   *
   * 踩过的坑：SQL 的 ORDER BY amount 按数值排（4 在 16 前），
   * 而 JS 的 Array.sort() 按字符串排（"16" 在 "4" 前），
   * 两边排序规则不同导致指纹永远对不上——按钮压根不会出现。
   * 修法是让排序统一在 JS 里做，所以这里必须验证两者确实吻合。
   */
  it('种子指纹与库里实际流水完全一致（按钮据此判断是否显示）', () => {
    const actual = repos.expenseEntriesFingerprint();
    assert.ok(actual.length > 0, '示例流水应已灌入');
    assert.equal(actual.split('\n').length, seedData.SEED_EXPENSE_ENTRIES.length, '笔数应一致');
    assert.equal(
      actual,
      seedData.SEED_EXPENSE_FINGERPRINT,
      '指纹必须逐字符一致，否则"清空示例数据"按钮不会出现'
    );
  });

  it('用户改动任何一笔后指纹立刻失配（按钮随之消失）', () => {
    repos.addExpenseEntry({ categoryId: 'cat_meal', amount: 1, note: '自己加的一笔' });
    assert.notEqual(
      repos.expenseEntriesFingerprint(),
      seedData.SEED_EXPENSE_FINGERPRINT,
      '加一笔后必须失配，否则按钮会变成"点一下删光真实记录"的危险入口'
    );
  });

  it('清空示例只删流水，分类与预算设置都保留', () => {
    const categoriesBefore = repos.getExpenseCategories().length;
    const budgetBefore = repos.getExpenseDailyBudget();

    const removed = repos.deleteAllExpenseEntries();
    assert.ok(removed > 0, '应确实删掉了记录');
    assert.equal(repos.getRecentExpenseEntries(30).length, 0, '流水应被清空');
    assert.equal(repos.getExpenseCategories().length, categoriesBefore, '分类不能被连带删除');
    assert.equal(repos.getExpenseDailyBudget(), budgetBefore, '预算设置不能被连带删除');
  });

  /* -------------------------------------------------- 记账：每月期初余额 */

  it('设置与读取每月期初余额', () => {
    assert.equal(repos.getOpeningBalanceFor('2026-10-08'), undefined, '没填过时应为 undefined');

    repos.setMonthBudget('2026-10', 2000, '十月生活费');
    assert.equal(repos.getOpeningBalanceFor('2026-10-08'), 2000);
    assert.equal(repos.getOpeningBalanceFor('2026-10-31'), 2000, '同月任意一天都取同一个值');
    assert.equal(repos.getOpeningBalanceFor('2026-11-01'), undefined, '不同月不串用');

    // 覆盖写
    repos.setMonthBudget('2026-10', 1800);
    assert.equal(repos.getOpeningBalanceFor('2026-10-08'), 1800);

    repos.clearMonthBudget('2026-10');
    assert.equal(repos.getOpeningBalanceFor('2026-10-08'), undefined, '清除后应退回按天折算');
  });

  it('期初余额不接受负数', () => {
    repos.setMonthBudget('2026-12', -500);
    assert.equal(repos.getOpeningBalanceFor('2026-12-01'), 0, '负数应被夹到 0');
  });

  /* -------------------------------------------------- 自律打卡 */

  it('习惯的增改查与归档', () => {
    const before = repos.getHabits(false).length;
    const created = repos.createHabit({ name: '早起', icon: '🌅', activeDays: [1, 2, 3, 4, 5] });
    assert.equal(created.name, '早起');
    assert.deepEqual(created.activeDays, [1, 2, 3, 4, 5], '星期应按序存储');

    repos.updateHabit(created.id, { name: '每天早起', archived: true });
    // 库里还有种子灌入的示例习惯，所以不能断言"归零"，只能断言"减少了刚建的这一条"
    assert.equal(repos.getHabits(false).length, before, '归档后默认列表应回到建之前的数量');
    assert.equal(repos.getHabits(true).find((h: any) => h.id === created.id)?.name, '每天早起');

    repos.updateHabit(created.id, { archived: false });
    assert.equal(repos.getHabits(false).length, before + 1, '取消归档后回到默认列表');
    repos.deleteHabit(created.id);
  });

  it('打卡是幂等的：重复打卡不会产生重复记录', () => {
    const h = repos.createHabit({ name: '背单词' });
    repos.setCheckin(h.id, '2026-10-08', true);
    repos.setCheckin(h.id, '2026-10-08', true);
    repos.setCheckin(h.id, '2026-10-08', true);
    assert.equal(repos.isCheckedOn(h.id, '2026-10-08'), true);
    const rows = mod.getDb().prepare('SELECT COUNT(*) AS c FROM habit_checkin WHERE habit_id = ?').get(h.id) as { c: number };
    assert.equal(rows.c, 1, '重复打卡只应有一条记录');

    repos.setCheckin(h.id, '2026-10-08', false);
    assert.equal(repos.isCheckedOn(h.id, '2026-10-08'), false, '取消打卡后应查不到');
    repos.deleteHabit(h.id);
  });

  it('删除习惯会级联删除其签到', () => {
    const h = repos.createHabit({ name: '跑步' });
    repos.setCheckin(h.id, '2026-10-01', true);
    repos.setCheckin(h.id, '2026-10-02', true);
    repos.deleteHabit(h.id);
    const rows = mod.getDb().prepare('SELECT COUNT(*) AS c FROM habit_checkin WHERE habit_id = ?').get(h.id) as { c: number };
    assert.equal(rows.c, 0, '签到应随习惯删除而级联清空');
  });
});

describe('正式用户初始化', () => {
  before(async () => {
    mod = await import('../db/index.ts');
    repos = await import('../db/repositories.ts');
    mod.initDatabase('.', ':memory:');
    mod.initializeUserData();
  });
  after(() => mod.closeDatabase());
  it('只提供分类，不写入其他人的课程、任务、花销或习惯', () => {
    for (const table of ['semester', 'course', 'task', 'expense_entry', 'habit']) {
      assert.equal(mod.getDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c, 0, table);
    }
    assert.equal(repos.getExpenseCategories().length, 8);
    assert.ok(repos.getExpenseCategories().every((c: any) => c.dailyTarget === 0));
  });
  it('重复初始化保留用户记录，也不会补回示例数据', () => {
    const task = repos.saveTask({ title: '用户自己的任务', domain: 'study', type: 'assignment', urgency: 3 });
    const habit = repos.createHabit({ name: '用户自己的习惯' });
    mod.initializeUserData();
    assert.equal(repos.getTasks().length, 1);
    assert.equal(repos.getTasks()[0].id, task.id);
    assert.equal(repos.getHabits()[0].id, habit.id);
    assert.equal(mod.getDb().prepare('SELECT COUNT(*) AS c FROM expense_entry').get().c, 0);
  });
});