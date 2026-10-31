/**
 * 提醒调度（设计文档 10）：
 *  - 任务多级提醒：由 reminder 表驱动，到点弹窗，notify_log 保证只弹一次
 *  - 上课提醒：开始前 15 分钟
 *  - 每日汇总：默认 07:30
 *  - 休眠唤醒后 24 小时内的错过提醒补弹一次
 */

import type { Task } from '@shared/types';
import { upcomingLessons } from '@shared/timetable';
import { dateOf, minutesBetween, nowLocal } from '@shared/time';

import {
  classDedupeKey,
  dailyDigestDedupeKey,
  getPendingReminders,
  hasNotified,
  recordNotification,
  setReminderState,
  taskReminderDedupeKey
} from './db/repositories';
import { store } from './store';
import { pushMissedDigest, pushToast } from './toastManager';
import {t} from '@shared/i18n';
import {takeDueCalendarReminders} from './calendarEvents';

const TICK_MS = 20_000;
const CATCH_UP_MINUTES = 1440;

let tickTimer: NodeJS.Timeout | null = null;
let lastDigestDate = '';

/** 全屏状态由渲染层上报（见 ipc fullscreen:report） */
let fullscreenActive = false;
let missedDuringQuiet = 0;

export function setFullscreenActive(active: boolean): void {
  if (fullscreenActive === active) return;
  fullscreenActive = active;
  if (!active && missedDuringQuiet > 0) {
    pushMissedDigest(missedDuringQuiet);
    missedDuringQuiet = 0;
  }
}

function notify(input: Parameters<typeof pushToast>[0]): void {
  if (fullscreenActive && store.getSettings().quietOnFullscreen) {
    missedDuringQuiet += 1;
    return;
  }
  pushToast(input);
}

export function tick(): void {
  store.getState();
  const now = nowLocal();
  const tasks = store.getTasksSnapshot();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Point events are claimed only when they can be shown; quiet mode defers them.
  if(!(fullscreenActive&&store.getSettings().quietOnFullscreen)){
    for(const event of takeDueCalendarReminders(now))pushToast({
      kind:'event',eventId:event.id,title:event.title,
      body:[t('提醒时间：{0}',[event.startAt.replace('T',' ')]),event.detail].filter(Boolean).join('\n'),strong:false
    });
  }

  // 1) 到期提醒
  for (const reminder of getPendingReminders()) {
    if (reminder.fireAt > now) continue;
    const lag = minutesBetween(reminder.fireAt, now);
    if (lag > CATCH_UP_MINUTES) {
      setReminderState(reminder.id, 'dismissed');
      continue;
    }

    const task = reminder.taskId ? taskMap.get(reminder.taskId) : undefined;
    if (reminder.taskId && (!task || task.status === 'done' || task.status === 'canceled')) {
      setReminderState(reminder.id, 'dismissed');
      continue;
    }

    const key = taskReminderDedupeKey(reminder.taskId ?? reminder.examId ?? reminder.id, reminder.level, reminder.fireAt);
    if (hasNotified(key)) {
      setReminderState(reminder.id, 'fired');
      continue;
    }

    const overdue = task?.dueAt ? task.dueAt <= now : false;
    notify({
      kind: overdue ? 'overdue' : 'reminder',
      title: task ? task.title : (reminder.title ?? '任务提醒'),
      body: overdue
        ? `已超过截止时间 ${reminder.body ?? ''}`.trim()
        : (reminder.body ?? undefined),
      urgency: (reminder.urgency as Task['urgency']) ?? 3,
      strong: reminder.strong || overdue || task?.urgency===5,
      taskId: reminder.taskId,
      reminderId: reminder.id
    });

    recordNotification({
      id: '',
      taskId: reminder.taskId,
      examId: reminder.examId,
      reminderId: reminder.id,
      kind: overdue ? 'overdue' : 'reminder',
      dedupeKey: key,
      firedAt: now
    });
    setReminderState(reminder.id, 'fired');
  }

  // 2) 上课提醒
  if (store.getSettings().classReminder) {
    const snapshot = store.getAgendaSnapshot();
    if (snapshot.semester) {
      const { next } = upcomingLessons({
        now,
        semester: snapshot.semester,
        courses: snapshot.courses,
        sessions: snapshot.sessions,
        overrides: snapshot.overrides,
        timeSlots: snapshot.timeSlots,
        limit: 4
      });
      for (const lesson of next) {
        if (lesson.untilStartMinutes < 0 || lesson.untilStartMinutes > 15) continue;
        const key = classDedupeKey(lesson.course.id, lesson.startAt);
        if (hasNotified(key)) continue;
        notify({
          kind: 'class',
          title: t('15 分钟后上 {0}',[lesson.course.name]),
          body: t('{0} 开始',[lesson.startAt.slice(11,16)])+(lesson.room?` · ${lesson.room}`:''),
          urgency: 4,
          strong: false
        });
        recordNotification({
          id: '',
          kind: 'class',
          dedupeKey: key,
          firedAt: now
        });
      }
    }
  }

  // 3) 每日汇总
  const digestAt = store.getSettings().dailyDigestAt;
  if (digestAt && now.slice(11, 16) >= digestAt && lastDigestDate !== dateOf(now)) {
    const key = dailyDigestDedupeKey(dateOf(now));
    if (!hasNotified(key)) {
      lastDigestDate = dateOf(now);
      const state = store.getState();
      const parts = [
        t('今天 {0} 节课',[state.summary.lessonCount]),
        t('{0} 个 DDL',[state.summary.dueTodayCount]),
        state.summary.overdueCount > 0 ? t('{0} 项已超期',[state.summary.overdueCount]) : t('暂无超期')
      ];
      notify({
        kind: 'daily_digest',
        title: t('今日清单'),
        body: parts.join(' · '),
        urgency: 3,
        strong: false
      });
      recordNotification({
        id: '',
        kind: 'daily_digest',
        dedupeKey: key,
        firedAt: now
      });
    }
  }
}

/** 休眠唤醒后立即补一次（设计文档 10.5） */
export function catchUpAfterResume(): void {
  fullscreenActive = false;
  tick();
}

export function startScheduler(): void {
  if (tickTimer) return;
  tick();
  // 测试环境下不要挂常驻定时器，否则测试进程无法退出
  if (process.env.COLDESK_DISABLE_SCHEDULER === '1') return;
  tickTimer = setInterval(tick, TICK_MS);
}

export function stopScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
