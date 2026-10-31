/**
 * 用真实数据层构造一份 TodayView，供预览与自检复用。
 * 这样预览里看到的课程、任务、编排块与 `pnpm dev` 启动后完全一致，
 * 而不是手写的假数据。
 */

import { buildAgenda, primaryMoment } from '@shared/agenda';
import { nowLocal } from '@shared/time';
import { planSchedule, selectPlannableTasks, toPlannerTask } from '@shared/planner';
import type { TodayView } from '@shared/view';
import { initDatabase, seedIfEmpty, closeDatabase } from '@main/db/index';
import {
  applyAutoPlan,
  getActiveSemester,
  getBlocks,
  getBusyBlocks,
  getCourses,
  getExams,
  getOverrides,
  getSessions,
  getTasks,
  getTimeSlots
} from '@main/db/repositories';

/** 建一个内存库、灌示例数据、跑一次排程，然后返回视图状态 */
export async function buildFixtureState(): Promise<TodayView> {
  process.env.COLDESK_DB_FACTORY = 'fake';
  initDatabase('.', ':memory:');
  seedIfEmpty();

  const semester = getActiveSemester();
  const now = nowLocal();

  // 跑一次真实的自动排程并落库，让预览里也能看到编排块
  const plan = planSchedule({
    now,
    semester,
    courses: getCourses(),
    sessions: getSessions(),
    overrides: getOverrides(),
    timeSlots: semester ? getTimeSlots(semester.id) : [],
    exams: getExams(),
    busy: getBusyBlocks(),
    lockedBlocks: [],
    tasks: selectPlannableTasks(getTasks()).map((t) => toPlannerTask(t, now))
  });
  applyAutoPlan(plan.blocks);

  const tasks = getTasks();
  const snapshot = {
    semester,
    courses: getCourses(),
    sessions: getSessions(),
    overrides: getOverrides(),
    timeSlots: semester ? getTimeSlots(semester.id) : [],
    tasks,
    exams: getExams(),
    blocks: getBlocks(),
    busy: getBusyBlocks()
  };

  const agenda = buildAgenda(snapshot, now);
  closeDatabase();

  const buckets = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], done: [] } as TodayView['buckets'];
  const todayStr = agenda.date;
  for (const t of tasks) {
    if (t.status === 'done') {
      buckets.done.push(t);
      continue;
    }
    if (t.status === 'canceled') continue;
    const d = t.dueAt?.slice(0, 10);
    if (!d) buckets.later.push(t);
    else if (t.dueAt && t.dueAt < now) buckets.overdue.push(t);
    else if (d === todayStr) buckets.today.push(t);
    else buckets.thisWeek.push(t);
  }

  return {
    now,
    date: agenda.date,
    dateLabel: agenda.dateLabel,
    ui: { glassTintAlpha: 0.55, showWidget: true, showDrawer: false },
    current: agenda.current,
    next: agenda.next,
    primary: primaryMoment(agenda),
    timeline: agenda.timeline,
    week: agenda.week,
    todayTasks: agenda.todayTasks,
    urgentTasks: agenda.urgentTasks,
    overdueTasks: agenda.overdueTasks,
    summary: agenda.summary,
    buckets,
    warnings: plan.warnings,
    unscheduled: plan.unscheduled.map((u) => ({ taskId: u.taskId, title: u.title, reason: u.reason })),
    courses: snapshot.courses.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    settings: {
      dailyDigestAt: '07:30',
      classReminder: true,
      autoSchedule: true,
      autoLaunch: true,
      desktopMode: 'widget',
      glassOpacity: 0.55,
      quietOnFullscreen: true
    }
  };
}
