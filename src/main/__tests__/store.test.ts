/**
 * store 的性能相关行为（回归测试）。
 *
 * 背景：真实使用中"拖透明度滑块卡顿"、"切换置顶反应慢"。
 * 根因是外观类设置走了和排程同一条重路径：写库 → 重排日程 → 重建提醒 → 广播状态。
 * 从 45% 拖到 100% 会连续触发 55 次，主进程每秒要跑几十遍排程，界面自然卡。
 *
 * 修法是在 store 层引入 `silent`：外观类改动只存设置、不重排也不刷新状态，
 * 再由 `broadcastSettings()` 把设置合并进现有状态广播出去。
 *
 * 这里断言的就是这个契约，避免以后有人把 silent 路径改回重路径。
 * 本文件独占数据库单例，因此单独运行（见 package.json 的 test 脚本）。
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deadlineTasksWithPins } from '@shared/taskActions';

process.env.COLDESK_DB_FACTORY = 'fake';

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let store: any;

describe('store：外观类设置必须走轻量路径', () => {
  before(async () => {
    db = await import('../db/index.ts');
    db.initDatabase('.', ':memory:');
    store = (await import('../store.ts')).store;
    store.load();
  });

  after(() => {
    db?.closeDatabase();
  });

  it('silent 更新只落库，不重排也不刷新状态', () => {
    const stateBefore = store.getState();
    const replansBefore = store.replanCount;

    const next = store.updateSettings({ glassOpacity: 0.8 }, { silent: true });

    assert.equal(next.glassOpacity, 0.8, '设置应被记下');
    assert.equal(store.replanCount, replansBefore, 'silent 更新不得触发重排');
    assert.equal(store.getState(), stateBefore, 'silent 更新不应重建状态对象（即没走 refresh）');
  });

  it('模拟拖动滑块 55 次，一次都不许重排', () => {
    // 这正是卡顿的原因：45% → 100% 会连续来 55 个值
    const replansBefore = store.replanCount;
    for (let value = 45; value <= 100; value += 1) {
      store.updateSettings({ glassOpacity: value / 100 }, { silent: true });
      store.broadcastSettings();
    }
    assert.equal(store.replanCount, replansBefore, '拖动滑块 55 次不应产生任何重排');
    assert.equal(store.getState().settings.glassOpacity, 1, '最后一次的值应生效');
  });

  it('广播设置后各窗口能看到新值', () => {
    store.updateSettings({ glassOpacity: 0.7 }, { silent: true });
    store.broadcastSettings();

    const state = store.getState();
    assert.equal(state.settings.glassOpacity, 0.7, '广播后状态里的设置应是新值');
    // plannerPrefs 属于内部设置，不应混进给渲染层的 settings
    assert.equal(state.settings.plannerPrefs, undefined, 'plannerPrefs 不应出现在 settings 里');
    assert.ok(state.plannerPrefs, 'plannerPrefs 应单独暴露给设置页');
  });

  it('广播设置必须同时刷新 ui.glassTintAlpha（否则悬浮窗玻璃不变）', () => {
    // 这是一个真实踩到的 bug：broadcastSettings 只更新了 settings、漏了 ui，
    // 而悬浮窗的玻璃外观读的是 ui.glassTintAlpha，
    // 表现就是"在设置里调整悬浮窗没反应"。
    store.updateSettings({ glassOpacity: 0.9 }, { silent: true });
    store.broadcastSettings();
    assert.equal(
      store.getState().ui.glassTintAlpha,
      0.9,
      'ui.glassTintAlpha 必须跟着设置一起更新，否则悬浮窗读到的还是旧值'
    );

    const payloads: any[] = [];
    const listener = (s: any) => payloads.push(s);
    store.on('change', listener);
    store.updateSettings({ glassOpacity: 0.5 }, { silent: true });
    store.broadcastSettings();
    store.off('change', listener);

    assert.equal(payloads.length, 1, '静默改动后 broadcastSettings 应恰好广播一次');
    assert.equal(payloads[0].ui.glassTintAlpha, 0.5, '广播出去的载荷里 ui 也必须是新值');
  });

  it('切换层级同样会广播，让 📌 按钮与设置页状态同步', () => {
    const payloads: any[] = [];
    const listener = (s: any) => payloads.push(s);
    store.on('change', listener);
    store.updateSettings({ desktopLayer: 'bottom' }, { silent: true });
    store.broadcastSettings();
    store.off('change', listener);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].settings.desktopLayer, 'bottom');
  });

  it('切换层级不重排（置顶反应慢就是因为它以前走了重路径）', () => {
    const replansBefore = store.replanCount;
    // 与 ipc 的 window:setLayer 完全一致的做法：存设置 + 广播，但不重排
    store.updateSettings({ desktopLayer: 'bottom' }, { silent: true });
    store.broadcastSettings();
    store.updateSettings({ desktopLayer: 'top' }, { silent: true });
    store.broadcastSettings();

    assert.equal(store.replanCount, replansBefore, '切换层级不应重排');
    assert.equal(store.getState().settings.desktopLayer, 'top');
  });

  it('透明度滑块下限保存后，重新加载仍保留用户选择', () => {
    store.updateSettings({ glassOpacity: 0.45 }, { silent: true });
    store.reloadSnapshot();
    store.broadcastSettings();
    assert.equal(store.getSettings().glassOpacity, 0.45);
    assert.equal(store.getState().ui.glassTintAlpha, 0.45);
  });

  it('自动排程从关到开必须补排一次（这条重路径要保留）', () => {    // 先确保处于开启状态
    if (!store.getSettings().autoSchedule) store.updateSettings({ autoSchedule: true });

    store.updateSettings({ autoSchedule: false });
    const afterClose = store.replanCount;
    assert.ok(afterClose >= 2, '关闭自动排程应重排一次以清掉自动块');

    store.updateSettings({ autoSchedule: true });
    assert.equal(store.replanCount, afterClose + 1, '从关到开应补排一次，否则日程会一直空着');
  });

  it('非 silent 的普通设置仍会刷新状态并广播', () => {
    const stateBefore = store.getState();
    store.updateSettings({ dailyDigestAt: '08:15' });
    const stateAfter = store.getState();
    assert.notEqual(stateAfter, stateBefore, '普通更新应重建状态对象');
    assert.equal(stateAfter.settings.dailyDigestAt, '08:15');
  });

  /**
   * 老库兼容：删掉"流动光"功能后，早期版本写在数据库里的 glassFlow 键必须被丢掉。
   *
   * 这里不是在测"键还在不在"这种小事——`readSettings` 用展开语法合并设置，
   * 残留的旧键会被读进来、并在下次保存时又写回数据库，
   * 于是一个已经删掉的功能会永远留在用户的设置里。所以必须显式剔除。
   */
  it('读取设置时丢弃已下线的旧键，并把它从数据库里真正清掉', async () => {
    const repos = await import('../db/repositories.ts');
    const db = await import('../db/index.ts');
    repos.setSettingsJson('app', {
      glassOpacity: 0.8,
      dailyDigestAt: '06:45',
      glassFlow: true,
      glassLight: 'strong',
      glassLightStrength: 1.35,
      glassTintHint: 'legacy'
    });

    store.load();
    const settings = store.getSettings() as Record<string, unknown>;

    assert.equal('glassFlow' in settings, false, '已下线的 glassFlow 不应被读入');
    assert.equal('glassTintHint' in settings, false, '从未正式使用的 glassTintHint 不应被读入');
    assert.equal('glassLight' in settings, false, '已下线的三档不应被读入');
    assert.equal('glassLightStrength' in settings, false, '三档派生值不应被读入');
    assert.equal('glassLight' in store.getState().settings, false, '渲染层不应收到已下线的三档');
    // 同时确认"剔除旧键"没有误伤正常设置
    assert.equal(settings.glassOpacity, 0.8, '有效的设置必须原样保留');
    assert.equal(settings.dailyDigestAt, '06:45', '有效的设置必须原样保留');

    // 关键：旧键必须从持久化里也消失，否则会一直躺着。
    // load() 只读不写，所以必须在启动时显式写回一份干净的设置。
    //
    // 注意：测试环境（COLDESK_DB_FACTORY=fake）下设置走内存实现而非 SQLite 表，
    // 所以要透过 getSettingsJson 断言，不能直接查 setting 表。
    const persisted = repos.getSettingsJson<Record<string, unknown>>('app', {});
    assert.ok(Object.keys(persisted).length > 0, '设置应已写回持久化');
    assert.equal('glassFlow' in persisted, false, 'glassFlow 必须从持久化中被清除');
    assert.equal('glassTintHint' in persisted, false, 'glassTintHint 必须从持久化中被清除');
    assert.equal('glassLight' in persisted, false, '三档必须从持久化中被清除');
    assert.equal('glassLightStrength' in persisted, false, '三档派生值必须从持久化中被清除');
    assert.equal(persisted.glassOpacity, 0.8, '清理时不得丢失有效设置');
    assert.equal(persisted.dailyDigestAt, '06:45', '清理时不得丢失有效设置');
  });
  it('完成引导和高对比度可持久化，并保留已有任务', () => {
    const beforeTasks = store.getTasksSnapshot().map((task: any) => task.id);
    const replans = store.replanCount;
    store.updateSettings({ onboardingVersion: 1, highContrast: true });
    store.reloadSnapshot();
    store.broadcastSettings();
    assert.equal(store.getState().settings.onboardingVersion, 1);
    assert.equal(store.getState().settings.highContrast, true);
    assert.deepEqual(store.getTasksSnapshot().map((task: any) => task.id), beforeTasks);
    assert.equal(store.replanCount, replans);
  });
  it('两个字体独立持久化，外观改动不触发重排，非法历史值回退', async () => {
    const count = store.replanCount;
    store.updateSettings({uiFont:'SimSun',homeCoverFont:'LiSu'}); store.reloadSnapshot(); store.refresh();
    assert.equal(store.getState().settings.uiFont,'SimSun'); assert.equal(store.getState().settings.homeCoverFont,'LiSu');
    assert.equal(store.replanCount,count);
    const repos = await import('../db/repositories.ts');
    repos.setSettingsJson('app',{...store.getSettings(),uiFont:"bad';css",homeCoverFont:42});
    store.reloadSnapshot();
    assert.equal(store.getSettings().uiFont,'system'); assert.equal(store.getSettings().homeCoverFont,'STXingkai');
  });});

describe('日程表手动安排', () => {
  let repos: any;
  let taskId: string;
  let manualId: string;
  before(async () => {
    db = await import('../db/index.ts'); db.initDatabase('.',':memory:');
    repos = await import('../db/repositories.ts'); store=(await import('../store.ts')).store;
    db.getDb().prepare('INSERT INTO semester (id,name,start_date,total_weeks,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('manual-sem','测试学期','2026-10-05',20,1,'2026-10-05T00:00','2026-10-05T00:00');
    const c=repos.upsertCourse({semesterId:'manual-sem',name:'测试课程'});
    db.getDb().prepare('INSERT INTO course_session (id,course_id,weekday,start_slot,end_slot,week_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('manual-session',c.id,3,1,2,'all','2026-10-05T00:00','2026-10-05T00:00');
    repos.saveTimeSlots('manual-sem','默认',[{slotIndex:1,period:'am',startTime:'10:00',endTime:'10:45'},{slotIndex:2,period:'am',startTime:'10:50',endTime:'11:35'}]);
    repos.setActiveCampus('默认'); store.load();
    taskId=repos.saveTask({title:'手动安排测试',domain:'study',type:'assignment',urgency:3,estMinutes:75,dueAt:'2030-01-01T18:00'}).id;
  });
  after(()=>db.closeDatabase());
  it('放到空闲时间后形成指定时长的固定安排，重排后仍保留', () => {
    store.placeTask({taskId,startAt:'2026-10-07T12:00',durationMinutes:75});
    const block=repos.getBlocksForTask(taskId).find((b:any)=>b.origin==='manual'); manualId=block.id;
    assert.equal(block.endAt,'2026-10-07T13:15'); assert.equal(block.plannedMinutes,75); assert.equal(block.locked,true);
    store.replan(); assert.equal(repos.getBlocksForTask(taskId).length,1); assert.equal(repos.getBlocksForTask(taskId)[0].id,manualId);
  });
  it('检查整段课程占用，拒绝部分重叠且不写入任何安排', () => {
    const before=JSON.stringify(repos.getBlocksForTask(taskId));
    assert.throws(()=>store.placeTask({taskId,startAt:'2026-10-07T09:45',durationMinutes:30}),/课程/);
    assert.equal(JSON.stringify(repos.getBlocksForTask(taskId)),before);
  });
  it('移动手动安排更新原记录，不能覆盖课程或其他手动安排', () => {
    store.placeTask({taskId,blockId:manualId,startAt:'2026-10-07T14:00',durationMinutes:50});
    const manual=repos.getBlocksForTask(taskId).filter((b:any)=>b.origin==='manual');
    assert.equal(manual.length,1); assert.equal(manual[0].id,manualId); assert.equal(manual[0].endAt,'2026-10-07T14:50');
    const other=repos.saveTask({title:'另一项任务',domain:'study',urgency:3}).id;
    assert.throws(()=>store.placeTask({taskId:other,startAt:'2026-10-07T14:15',durationMinutes:20}),/手动安排/);
    assert.throws(()=>store.placeTask({taskId,blockId:manualId,startAt:'2026-10-07T10:15',durationMinutes:20}),/课程/);
  });
  it('允许紧接下课时间，支持结束于 24:00，拒绝越过当日和已完成任务', () => {
    const another=repos.saveTask({title:'边界任务',domain:'study',urgency:3,estMinutes:30}).id;
    store.placeTask({taskId:another,startAt:'2026-10-07T11:35',durationMinutes:25});
    store.placeTask({taskId:another,startAt:'2026-10-07T23:30',durationMinutes:30});
    assert.ok(repos.getBlocksForTask(another).some((b:any)=>b.endAt==='2026-10-07T24:00'));
    assert.throws(()=>store.placeTask({taskId:another,startAt:'2026-10-07T23:45',durationMinutes:30}),/24:00/);
    store.completeTask(another);
    assert.throws(()=>store.placeTask({taskId:another,startAt:'2026-10-07T16:00',durationMinutes:30}),/已经完成/);
  });
  it('移除手动安排保留任务，不允许移除自动安排或移动其他任务的记录', () => {
    assert.throws(()=>store.placeTask({taskId:'wrong-task',blockId:manualId,startAt:'2026-10-07T16:00',durationMinutes:10}),/任务不存在/);
    store.removeTaskPlacement(manualId);
    assert.ok(repos.getTasks().some((task:any)=>task.id===taskId));
    assert.ok(!repos.getBlocksForTask(taskId).some((b:any)=>b.id===manualId));
  });
  it('从任务栏新增分段，拖动选中的自动块只转为该段手动安排',()=>{
    const t=repos.saveTask({title:'唯一安排',urgency:3,estMinutes:90,dueAt:'2030-01-01T18:00'});
    repos.applyAutoPlan([{taskId:t.id,date:'2026-10-07',startAt:'2026-10-07T16:00',endAt:'2026-10-07T16:45',plannedMinutes:45,origin:'auto'},{taskId:t.id,date:'2026-10-08',startAt:'2026-10-08T16:00',endAt:'2026-10-08T16:45',plannedMinutes:45,origin:'auto'}]);
    const automatic=repos.getBlocksForTask(t.id)[0];store.placeTask({taskId:t.id,blockId:automatic.id,startAt:'2026-10-07T18:00',durationMinutes:45});
    assert.equal(repos.getBlocksForTask(t.id).length,2);assert.ok(repos.getBlocksForTask(t.id).some((b:any)=>b.id===automatic.id&&b.origin==='manual'));
    store.placeTask({taskId:t.id,startAt:'2026-10-08T18:30',durationMinutes:60});
    const moved=repos.getBlocksForTask(t.id);assert.equal(moved.length,3);assert.ok(moved.some((b:any)=>b.endAt==='2026-10-08T19:30'));
    store.replan();assert.equal(repos.getBlocksForTask(t.id).length,2);
  });
  it('不同时间的历史手动安排保留为分段，读取状态时钟刷新且不重排', t=>{
    const task=repos.saveTask({title:'历史重复',urgency:3});
    const sql="INSERT INTO schedule_block (id,task_id,date,start_at,end_at,planned_minutes,locked,origin,created_at,updated_at) VALUES (?,?,?,?,?,30,1,'manual',?,?)";
    db.getDb().prepare(sql).run('old-dup',task.id,'2026-10-09','2026-10-09T12:00','2026-10-09T12:30','2026-10-09T00:00','2026-10-09T00:00');
    db.getDb().prepare(sql).run('new-dup',task.id,'2026-10-09','2026-10-09T13:00','2026-10-09T13:30','2026-10-09T00:00','2026-10-10T00:00');
    store.reloadSnapshot();store.replan();assert.equal(repos.getBlocksForTask(task.id).length,2);assert.ok(repos.getBlocksForTask(task.id).some((b:any)=>b.id==='new-dup'));
    t.mock.timers.enable({apis:['Date'],now:Date.now()});store.refresh();const before=store.getState().now,count=store.replanCount;
    t.mock.timers.tick(65_000);assert.notEqual(store.getState().now,before);assert.equal(store.replanCount,count);
  });
});

describe('任务操作：保留信息、置顶与删除', () => {
  let repos:any;
  before(async()=>{db=await import('../db/index.ts');repos=await import('../db/repositories.ts');store=(await import('../store.ts')).store;});
  after(()=>db.closeDatabase());
  const fresh=()=>{db.closeDatabase();db.initDatabase('.',':memory:');store.load();store.updateSettings({autoSchedule:false});};
  it('旧数据库自动补充置顶列，原任务保留且重启后置顶仍在', async()=>{
    db.closeDatabase();const folder=mkdtempSync(join(tmpdir(),'coldesk-task-migration-'));
    try{
      const {openDatabase}=await import('../db/driver.ts');const {SCHEMA_SQL}=await import('../db/schema.ts');
      const legacy=openDatabase(join(folder,'coldesk.db'));
      legacy.exec(SCHEMA_SQL.replace('  is_pinned INTEGER NOT NULL DEFAULT 0,\n',''));
      legacy.prepare('INSERT INTO task (id,type,title,urgency,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('old-task','todo','旧任务',3,'2026-10-10T00:00','2026-10-10T00:00');legacy.close();
      db.initDatabase(folder);assert.equal(repos.getTask('old-task').pinned,false);repos.setTaskPinned('old-task',true);
      db.closeDatabase();db.initDatabase(folder);assert.equal(repos.getTask('old-task').pinned,true);assert.equal(repos.getTask('old-task').title,'旧任务');
    }finally{db.closeDatabase();rmSync(folder,{recursive:true,force:true});}
  });
  it('修改单个字段保留其余任务信息，清空截止后清掉待触发提醒',()=>{
    fresh();const t=repos.saveTask({title:'任务原名称',domain:'life',type:'event',urgency:3,dueAt:'2030-10-10T18:00',detail:'原备注',estMinutes:75,splittable:false});
    store.editTask(t.id,{title:'新名称'});const renamed=repos.getTask(t.id);
    assert.equal(renamed.domain,'life');assert.equal(renamed.type,'event');assert.equal(renamed.detail,'原备注');assert.equal(renamed.estMinutes,75);assert.equal(renamed.splittable,false);assert.equal(renamed.createdAt,t.createdAt);
    store.editTask(t.id,{urgency:5,dueAt:'2030-10-11T20:00'});
    assert.equal(repos.getTask(t.id).urgency,5);assert.ok(db.getDb().prepare('SELECT count(*) AS n FROM reminder WHERE task_id=?').get(t.id).n>0);
    store.editTask(t.id,{dueAt:null});assert.equal(repos.getTask(t.id).dueAt,undefined);
    assert.equal(db.getDb().prepare("SELECT count(*) AS n FROM reminder WHERE task_id=? AND state='pending'").get(t.id).n,0);
  });
  it('置顶可取消，保留手动安排位置且不触发重排',()=>{
    fresh();const t=repos.saveTask({title:'置顶任务',urgency:3,estMinutes:30});
    store.placeTask({taskId:t.id,startAt:'2026-10-10T14:00',durationMinutes:30});const count=store.replanCount;
    store.pinTask(t.id,true);assert.equal(repos.getTask(t.id).pinned,true);assert.equal(store.replanCount,count);assert.equal(repos.getBlocksForTask(t.id)[0].startAt,'2026-10-10T14:00');
    assert.equal(deadlineTasksWithPins(store.getState())[0].task.id,t.id,'没有截止时间的置顶任务也应进入浮窗与右栏');
    store.pinTask(t.id,false);assert.equal(repos.getTask(t.id).pinned,false);
  });
  it('编辑已完成任务不恢复状态、不改变完成时间且不会生成新提醒',()=>{
    fresh();const t=repos.saveTask({title:'已完成测试',urgency:3,dueAt:'2030-10-10T18:00'});store.completeTask(t.id);const doneAt=repos.getTask(t.id).doneAt;
    store.editTask(t.id,{title:'完成后改名',urgency:5});const saved=repos.getTask(t.id);
    assert.equal(saved.status,'done');assert.equal(saved.doneAt,doneAt);assert.equal(db.getDb().prepare("SELECT count(*) AS n FROM reminder WHERE task_id=? AND state='pending'").get(t.id).n,0);
  });
  it('删除同时清理相关日程与提醒，不影响别的任务；非法修改不写入',()=>{
    fresh();const first=repos.saveTask({title:'删除任务',urgency:5,dueAt:'2030-10-10T18:00'}),other=repos.saveTask({title:'保留任务',urgency:3});
    store.editTask(first.id,{title:'删除任务'});store.placeTask({taskId:first.id,startAt:'2026-10-10T15:00',durationMinutes:45});
    const prior=JSON.stringify(repos.getTask(first.id));
    assert.throws(()=>store.editTask(first.id,{title:'   '}),/名称/);assert.throws(()=>store.editTask(first.id,{dueAt:'2026-02-30T12:00'}),/有效/);assert.throws(()=>store.editTask(first.id,{urgency:7} as any),/1–5/);assert.equal(JSON.stringify(repos.getTask(first.id)),prior);
    store.removeTask(first.id);assert.equal(repos.getTask(first.id),undefined);assert.equal(repos.getBlocksForTask(first.id).length,0);assert.equal(db.getDb().prepare('SELECT count(*) AS n FROM reminder WHERE task_id=?').get(first.id).n,0);assert.ok(repos.getTask(other.id));
    assert.throws(()=>store.editTask(first.id,{title:'不应恢复'}),/不存在/);
  });
});
