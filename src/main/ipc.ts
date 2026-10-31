import {normalizeHabitIcon} from '@shared/habitIcons';
import {mouseHoverTime} from './interaction';
/**
 * IPC 入口：所有渲染层请求都从这里进来。虽然 preload 已做白名单，
 * 这里仍然对参数做一次校验，避免渲染层被注入后越权。
 */

import { chooseIcon, readIconChoice, resetIconChoice } from './personalization';
import { desktopSyncStatus } from './sync';
import {saveCalendarEvent,deleteCalendarEvent} from './calendarEvents';
import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import {assistantService} from './assistant';

import type { Domain, Task, Urgency } from '@shared/types';
import {
  applyPersonalizedIcon,
  applyAutoLaunch,
  applyDesktopMode,
  applyWidgetLayer,
  createMainWindow,
  markMainRendererReady,
  navigateMainWindow,
  getWindow,
  setDrawerExpanded,
  showWidget,
  snapWidget,
  toggleWidget, resizeWidget, beginWidgetDrag, endWidgetDrag
} from './windows';
import { clearToasts, clearClassToasts, clearTaskToasts, clearEventToasts, dismissToast, getIslandToasts, getVisible, getQueued, syncReminderPresentation } from './toastManager';
import { catchUpAfterResume, setFullscreenActive, tick } from './scheduler';
import { store, type AppSettings } from './store';
import { registerHomeIpc } from './homeIpc';
import { previewTimetable, importTimetable, TIMETABLE_PROMPT } from './timetableImport';
import { currentTimetable, deleteCurrentTimetable } from './timetableMaintenance';
import { isThemeId, validateScheduleWindow } from '@shared/personalization';
import { validFontName } from '@shared/fonts';
import { editRecordLink, linkExpenseChoices, recordLinks } from './recordLinks';
import {listGoals,readGoal,saveGoal,completeGoal,deleteGoal,linkGoalDiary,setPrimaryGoal,recordGoalProgress,readGoalProgress} from './goals';
import { navigationOrder, validLanguage, validNavPage, NAV_PAGES } from '@shared/navigation';
import { previewHduCalendar,commitHduCalendar,hduSubscriptionFromClipboard,openHduSchedule,clearHduPreview } from './hduCalendar';
import {
  addExpenseEntry,
  clearMonthBudget,
  createExpenseCategory,
  deleteAllExpenseEntries,
  deleteExpenseCategory,
  deleteExpenseEntry,
  getActiveCampus,
  getActiveSemester,
  getCampuses,
  getExpenseCategories,
  getTasks,
  getTask,
  getTimeSlots,
  setCourseColor,resetCourseColors,
  saveTimeSlots,
  createSnoozedReminder,
  setActiveCampus,
  setExpenseDailyBudget,
  setMonthBudget,
  updateExpenseCategory,
  createHabit,
  updateHabit,
  deleteHabit,
  setCheckin,
  type HabitInput
} from './db/repositories';
import { addMinutes, nowLocal, today } from '@shared/time';
import { sanitizePrefsView } from '@shared/plannerPrefs';
import { validateTaskPatch, type TaskEditField } from '@shared/taskActions';
import { shiftDate } from '@shared/expense';

/** 把用户输入的时间收敛成 HH:mm；非法值返回空串，由调用方过滤掉 */
function normalizeHhmm(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 仅接受白名单通道，其余直接拒绝 */
const HANDLERS: Record<string, (payload: unknown, event?:IpcMainInvokeEvent) => unknown> = {
  'app:interaction': async () => ({hoverTime: await mouseHoverTime()}),
  'goals:list':(_payload,event)=>{assertGoalSender(event);return listGoals();},
  'goals:primary':(payload,event)=>{assertGoalSender(event);const result=setPrimaryGoal((payload as {id?:unknown})?.id);notifyGoals();return result;},
  'goals:progress':(payload,event)=>{assertGoalSender(event);const result=recordGoalProgress((payload??{}) as Parameters<typeof recordGoalProgress>[0]);notifyGoals();return result;},
  'goals:progressMonth':(payload,event)=>{assertGoalSender(event);const input=payload as {id?:unknown;month?:unknown};return readGoalProgress(input?.id,input?.month);},
  'goals:get':(payload,event)=>{assertGoalSender(event);return readGoal((payload as {id?:unknown})?.id);},
  'goals:save':(payload,event)=>{assertGoalSender(event);const result=saveGoal((payload??{}) as Parameters<typeof saveGoal>[0]);notifyGoals();return result;},
  'goals:complete':(payload,event)=>{assertGoalSender(event);const input=payload as {id?:unknown;done?:unknown};const result=completeGoal(input?.id,input?.done);notifyGoals();return result;},
  'goals:delete':(payload,event)=>{assertGoalSender(event);const result=deleteGoal((payload as {id?:unknown})?.id);notifyGoals();return result;},
  'goals:link':(payload,event)=>{assertGoalSender(event);const input=payload as {id?:unknown;date?:unknown;remove?:unknown};if(input?.remove!==undefined&&typeof input.remove!=='boolean')throw Error('请选择有效的操作');const result=linkGoalDiary(input?.id,input?.date,input?.remove===true);notifyGoals();return result;},
  'links:list':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中查看关联');return recordLinks((payload??{}) as Parameters<typeof recordLinks>[0]);},
  'links:expenses':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中查看关联');const input=payload as {date?:unknown;expenseId?:unknown};return linkExpenseChoices(input?.date,input?.expenseId);},
  'links:add':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中修改关联');return editRecordLink((payload??{}) as Parameters<typeof editRecordLink>[0]);},
  'links:remove':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中修改关联');return editRecordLink((payload??{}) as Parameters<typeof editRecordLink>[0],true);},
  'appearance:iconGet':()=>readIconChoice(),
  'courses:color':(payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中设置课程颜色');const input=payload as {id?:unknown;color?:unknown};const result=setCourseColor(input?.id,input?.color);store.reloadSnapshot();store.refresh();return result;},
  'courses:colorReset':(_payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中设置课程颜色');resetCourseColors();store.reloadSnapshot();store.refresh();return true;},
  'appearance:iconPick':async(_payload,event)=>{const main=getWindow('main');if(!event||!main||event.sender!==main.webContents)throw new Error('请在主窗口中设置图标');const result=await chooseIcon(main);return result?{...result,shortcuts:applyPersonalizedIcon()}:null;},
  'appearance:iconReset':(_payload,event)=>{const main=getWindow('main');if(!event||!main||event.sender!==main.webContents)throw new Error('请在主窗口中设置图标');const result=resetIconChoice();return {...result,shortcuts:applyPersonalizedIcon()};},
  'sync:status':()=>desktopSyncStatus(),
  'hdu:open':(_payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中导入课表');return openHduSchedule();},
  'hdu:clipboard':(_payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中导入课表');return hduSubscriptionFromClipboard();},
  'hdu:preview':(payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中导入课表');return previewHduCalendar(event.sender.id,(payload as {url?:unknown})?.url);},
  'hdu:commit':(payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中导入课表');const result=commitHduCalendar(event.sender.id,payload as {id?:unknown});tick();return result;},
  'hdu:clear':(_payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中导入课表');clearHduPreview(event.sender.id);return true;},
  'timetable:prompt':()=>TIMETABLE_PROMPT,
  'timetable:current':()=>currentTimetable(),
  'timetable:delete':(payload,event)=>{if(!event||event.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中删除课表');const result=deleteCurrentTimetable((payload as {semesterId?:unknown})?.semesterId);clearClassToasts();store.refreshExternalData();tick();return result;},
  'timetable:preview':payload=>previewTimetable((payload as {text?:unknown})?.text),
  'timetable:import':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw new Error('请在主窗口中导入课表');const result=importTimetable(payload as {text?:unknown;mode?:unknown});tick();return result;},
  'habit:quoteRefresh':()=>store.refreshHabitQuote(),
  'state:get': () => store.getState(),
  'schedule:view':payload=>store.scheduleView((payload as {date:string})?.date),
  'schedule:notToday':payload=>{const input=payload as {taskId?:unknown;date?:unknown};const result=store.returnTaskToBar(input?.taskId,input?.date);tick();return result;},
  'schedule:saveEvent':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中设置日程');const id=saveCalendarEvent((payload??{}) as Record<string,unknown>);clearEventToasts(id);store.reloadSnapshot();store.refresh();tick();return id;},
  'schedule:deleteEvent':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中设置日程');const id=(payload as {id?:unknown})?.id;const result=deleteCalendarEvent(id);clearEventToasts(id as string);store.reloadSnapshot();store.refresh();tick();return result;},

  'state:refresh': () => {
    store.refreshExternalData();
    tick();
    return store.getState();
  },

  /*
   * 贾维斯（QQ 机器人）连接状态与一键重连。
   *
   * 机器人跑在 NapCat 上，NapCat 依附 QQ 进程。QQ 的快速登录票据会过期，
   * 过期后 NapCat 停在扫码界面、OneBot 端口不再监听。
   * 重连要杀 QQ 进程，需要管理员权限；这里不自己提权，而是触发一个
   * 已经注册好的「提权计划任务」（NapCat-Relogin），点按钮不会弹 UAC。
   */
  'jarvis:status': async (_payload,event) => {
    if(!event||event.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中查看助手状态');
    return assistantService.status();
  },
  'jarvis:reconnect': async (_payload,event) => {
    if(!event||event.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中重新连接助手');
    return assistantService.reconnect();
  },

  'task:quickAdd': (payload) => {
    const input = (payload ?? {}) as { title?: string; domain?: Domain; urgency?: Urgency; dueAt?: string };
    const title = typeof input.title === 'string' ? input.title.slice(0, 200).trim() : '';
    if (!title) return store.getState();
    return store.quickAdd(title, {
      domain: 'study',
      urgency: normalizeUrgency(input.urgency),
      dueAt: typeof input.dueAt === 'string' ? input.dueAt : undefined
    });
  },

  'task:create': (payload) => {
    const input = (payload ?? {}) as Record<string, unknown>;
    const title = typeof input.title === 'string' ? input.title.slice(0, 200).trim() : '';
    if (!title) throw new Error('任务标题不能为空');
    return store.updateTask({
      title,
      domain: 'study',
      type: typeof input.type === 'string' ? (input.type as Task['type']) : 'todo',
      urgency: normalizeUrgency(input.urgency as Urgency),
      dueAt: typeof input.dueAt === 'string' && input.dueAt ? input.dueAt : undefined,
      estMinutes: typeof input.estMinutes === 'number' ? clamp(input.estMinutes, 5, 1440) : 45,
      splittable: input.splittable !== false,
      courseId: typeof input.courseId === 'string' && input.courseId ? input.courseId : undefined,
      detail: typeof input.detail === 'string' ? input.detail.slice(0, 2000) : undefined
    }, input.segments);
  },

  'task:complete': (payload) => {
    const id = (payload as { id?: string })?.id;
    if (typeof id !== 'string') throw new Error('缺少任务 id');
    const result=store.completeTask(id);clearTaskToasts(id);return result;
  },

  'task:reopen': (payload) => {
    const id = (payload as { id?: string })?.id;
    if (typeof id !== 'string') throw new Error('缺少任务 id');
    return store.reopenTask(id);
  },
  'task:update': payload => {
    const input = (payload ?? {}) as {id?: unknown; patch?: unknown;segments?:unknown};
    if (typeof input.id !== 'string' || !input.id || input.id.length > 200) throw new Error('请选择有效的任务');
    const result = store.editTask(input.id, validateTaskPatch(input.patch),input.segments);
    clearTaskToasts(input.id); tick(); return result;
  },
  'task:pin': payload => {
    const input = (payload ?? {}) as {id?: unknown; pinned?: unknown};
    if (typeof input.id !== 'string' || !input.id || input.id.length > 200 || typeof input.pinned !== 'boolean') throw new Error('请选择有效的任务和置顶状态');
    return store.pinTask(input.id, input.pinned);
  },
  'task:delete': payload => {
    const id = (payload as {id?: unknown})?.id;
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('请选择要删除的任务');
    const result = store.removeTask(id); clearTaskToasts(id); tick(); return result;
  },
  'task:openEditor': payload => {
    const input = (payload ?? {}) as {id?: unknown; field?: unknown;date?:unknown};
    if (typeof input.id !== 'string' || !['name','urgency','due','all','schedule'].includes(String(input.field))) throw new Error('请选择有效的任务编辑项');
    const task = getTask(input.id);
    if (!task) throw new Error('任务已不存在，请刷新后重试');
    navigateMainWindow({ page:'',action:'edit-task',taskId:task.id,field:input.field as TaskEditField,domain:task.domain,date:typeof input.date==='string'?input.date:undefined });
    return true;
  },

  'task:list': (payload) => {
    return getTasks();
  },

  'schedule:replan': () => {
    store.replan();
    store.refresh();
    tick();
    return store.getState();
  },
  'schedule:placeTask': (payload) => {
    const input = (payload ?? {}) as { taskId?: unknown; startAt?: unknown; durationMinutes?: unknown; blockId?: unknown;studyPeriods?:unknown };
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200) throw new Error('请先选择要安排的任务');
    if (typeof input.startAt !== 'string' || typeof input.durationMinutes !== 'number') throw new Error('请填写安排时间和时长');
    if (input.blockId !== undefined && typeof input.blockId !== 'string') throw new Error('请选择有效的手动安排');
    const state = store.placeTask({ taskId:input.taskId,startAt:input.startAt,durationMinutes:input.durationMinutes,blockId:input.blockId as string|undefined });
    tick(); return state;
  },
  'schedule:saveSegments':(payload,event)=>{if(event?.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中设置日程');const input=(payload??{}) as {taskId?:unknown;segments?:unknown};const result=store.saveTaskSegments(input.taskId,input.segments);tick();return result;},
  'schedule:removePlacement': (payload) => {
    const id = (payload as { blockId?: unknown })?.blockId;
    if (typeof id !== 'string' || !id) throw new Error('请选择要移除的手动安排');
    const state = store.removeTaskPlacement(id); tick(); return state;
  },

  /**
   * 轻量设置更新：只改外观/行为类设置，**不重排日程**。
   *
   * 这里的关键是"按需重排"：
   *  - 拖透明度滑块会连续触发几十次调用，如果每次都重排日程，
   *    主进程每秒要跑几十遍排程 + 重建提醒，界面就会明显卡顿（用户反馈过）。
   *  - 只有"自动排程开关"从关到开时才需要补排一次，其余设置与日程无关。
   */
  'settings:update': (payload) => {
    const patch = (payload ?? {}) as Partial<AppSettings>;
    const safe: Partial<AppSettings> = {};
    if(patch.language!==undefined){if(!validLanguage(patch.language))throw new Error('请选择支持的语言');safe.language=patch.language;}
    if(patch.startPage!==undefined){if(!validNavPage(patch.startPage))throw new Error('请选择已有的页面');safe.startPage=patch.startPage;}
    if(patch.navigationOrder!==undefined){if(!Array.isArray(patch.navigationOrder)||patch.navigationOrder.length!==NAV_PAGES.length||new Set(patch.navigationOrder).size!==NAV_PAGES.length||!patch.navigationOrder.every(validNavPage))throw new Error('导航顺序需要包含每个栏目且不能重复');safe.navigationOrder=navigationOrder(patch.navigationOrder);}
    if (typeof patch.dailyDigestAt === 'string') safe.dailyDigestAt = patch.dailyDigestAt.slice(0, 5);
    if (typeof patch.classReminder === 'boolean') safe.classReminder = patch.classReminder;
    if (typeof patch.autoSchedule === 'boolean') safe.autoSchedule = false;
    if (typeof patch.autoLaunch === 'boolean') safe.autoLaunch = patch.autoLaunch;
    if (patch.onboardingVersion === 1) safe.onboardingVersion = 1;
    if (typeof patch.highContrast === 'boolean') safe.highContrast = patch.highContrast;
    if (patch.scheduleStart !== undefined || patch.scheduleEnd !== undefined) {
      const range = validateScheduleWindow(patch.scheduleStart ?? store.getSettings().scheduleStart, patch.scheduleEnd ?? store.getSettings().scheduleEnd);
      safe.scheduleStart = range.startLabel; safe.scheduleEnd = range.endLabel;
    }
    for (const key of ['mainTheme', 'homeTheme'] as const) {
      if (patch[key] !== undefined) { if (!isThemeId(patch[key])) throw new Error('请选择已有的主题颜色'); safe[key] = patch[key]; }
    }
    for (const key of ['uiFont', 'homeCoverFont'] as const) {
      if (patch[key] !== undefined) {
        if (!validFontName(patch[key])) throw new Error('请填写有效的字体名称（最多 80 个字符）');
        safe[key] = patch[key]!.trim();
      }
    }
    if (patch.desktopMode === 'widget' || patch.desktopMode === 'drawer' || patch.desktopMode === 'both' || patch.desktopMode==='island') {
      safe.desktopMode = patch.desktopMode;
    }
    // 下限抬到 0.45：更透的话背后的文字会透过来，看不清自己的内容
    if (typeof patch.glassOpacity === 'number') safe.glassOpacity = clamp(patch.glassOpacity, 0.45, 1);
    if (typeof patch.quietOnFullscreen === 'boolean') safe.quietOnFullscreen = patch.quietOnFullscreen;
    if (patch.desktopLayer === 'top' || patch.desktopLayer === 'normal' || patch.desktopLayer === 'bottom') {
      safe.desktopLayer = patch.desktopLayer;
    }

    const wasAuto = store.getSettings().autoSchedule;
    const next = store.updateSettings(safe);

    // 需要立刻作用到系统的部分
    if (safe.desktopMode) {applyDesktopMode(next.desktopMode);syncReminderPresentation();}
    if (safe.desktopLayer) applyWidgetLayer(next.desktopLayer);
    if (typeof safe.autoLaunch === 'boolean') applyAutoLaunch(safe.autoLaunch);

    // 只有"关 → 开"这一种情况需要补排一次，其余一律不碰排程
    if (safe.autoSchedule === true && !wasAuto) {
      store.replan();
      store.refresh();
      tick();
    }
    return next;
  },

  /** 只切悬浮窗层级：比走 settings:update 更快，且完全不碰排程 */
  'window:setLayer': (payload) => {
    const layer = (payload as { layer?: string })?.layer;
    if (layer !== 'top' && layer !== 'normal' && layer !== 'bottom') {
      throw new Error('层级只能是 top / normal / bottom');
    }
    // bringToFront：从设置页改层级时让悬浮窗现身一下，
    // 否则选"置底"后它立刻被设置窗口盖住，用户会以为没生效
    applyWidgetLayer(layer, { bringToFront: true });
    const next = store.updateSettings({ desktopLayer: layer }, { silent: true });
    // 广播出去，让悬浮窗上那个 📌 按钮和设置页同步显示当前层级
    store.broadcastSettings();
    return next;
  },

  /** 只改透明度：不重排日程，只把设置同步给各窗口 */
  'window:setGlass': (payload) => {
    const input = (payload ?? {}) as { glassOpacity?: unknown };
    const patch: Partial<AppSettings> = {};
    if (typeof input.glassOpacity === 'number') patch.glassOpacity = clamp(input.glassOpacity, 0.45, 1);
    if (Object.keys(patch).length === 0) return store.getSettings();

    const next = store.updateSettings(patch, { silent: true });
    // 只合并设置并广播，跳过重建快照与重排——这是拖滑块不卡的关键
    store.broadcastSettings();
    return next;
  },

  'widget:setSize': (payload,event) => {
    const win = getWindow('widget');
    if(event?.sender && event.sender!==win?.webContents)return null;
    const height = (payload as { height?: number })?.height;
    if (!win || typeof height !== 'number' || !Number.isFinite(height)) return null;
    const width=(payload as {width?:unknown})?.width;
    return resizeWidget(typeof width==='number'&&Number.isFinite(width)?width:undefined,height);
  },
  'widget:dragStart': (_payload,event)=>{if(event?.sender!==getWindow('widget')?.webContents)throw new Error('请在桌面组件上拖动');beginWidgetDrag();return true;},
  'widget:dragEnd': (_payload,event)=>{if(event?.sender!==getWindow('widget')?.webContents)throw new Error('请在桌面组件上拖动');endWidgetDrag();return true;},
  'toast:get': (_payload,event)=>event?.sender===getWindow('widget')?.webContents?getIslandToasts():{items:getVisible(),queued:getQueued()},

  'widget:show': () => {
    showWidget(true);
    return true;
  },

  'widget:hide': () => {
    showWidget(false);
    return true;
  },

  'widget:toggle': () => {
    toggleWidget();
    return true;
  },

  'widget:openMain': () => {
    createMainWindow();
    return true;
  },

  /** 打开主窗口并停在设置页（悬浮窗左下角那个椭圆按钮用） */
  'widget:openSettings': () => {
    navigateMainWindow({ page: 'settings' });
    return true;
  },

  /** 打开主窗口并停在记账页（悬浮窗上的"记一笔"用） */
  'widget:openExpenses': () => {
    navigateMainWindow({ page: 'expenses' });
    return true;
  },

  'drawer:expand': (payload) => {
    setDrawerExpanded(Boolean((payload as { expanded?: boolean })?.expanded));
    return true;
  },

  /** 读取某个校区的作息时间，供"课程时间"设置页编辑 */
  'timeslots:get': (payload) => {
    const semester = getActiveSemester();
    if (!semester) return { campus: '', campuses: [], slots: [] };
    const campuses = getCampuses();
    const campus = typeof (payload as { campus?: string })?.campus === 'string'
      ? String((payload as { campus?: string }).campus)
      : getActiveCampus();
    return { campus, campuses, slots: getTimeSlots(semester.id, campus) };
  },

  /** 保存用户自定义的作息时间；保存后立刻重排日程 */
  'timeslots:save': (payload) => {
    const semester = getActiveSemester();
    if (!semester) throw new Error('还没有学期，无法保存作息时间');
    const input = (payload ?? {}) as {
      campus?: string;
      slots?: Array<{
        slotIndex?: number;
        period?: string;
        startTime?: string;
        endTime?: string;
        isPrepareBell?: boolean;
      }>;
    };
    const campus = typeof input.campus === 'string' && input.campus ? input.campus : getActiveCampus();
    const raw = Array.isArray(input.slots) ? input.slots : [];

    const slots = raw
      .map((s) => ({
        slotIndex: Math.round(Number(s.slotIndex)),
        period: s.period === 'pm' ? ('pm' as const) : s.period === 'eve' ? ('eve' as const) : ('am' as const),
        startTime: normalizeHhmm(s.startTime),
        endTime: normalizeHhmm(s.endTime),
        isPrepareBell: Boolean(s.isPrepareBell)
      }))
      // 时间必须合法；预备铃允许起止相同，其余节次必须有长度
      .filter((s) => s.startTime && s.endTime && (s.isPrepareBell || s.startTime < s.endTime))
      .filter((s) => Number.isFinite(s.slotIndex) && s.slotIndex >= 0 && s.slotIndex <= 30);

    if (slots.length === 0) throw new Error('至少要保留一个有效的节次时间');

    saveTimeSlots(semester.id, campus, slots);
    setActiveCampus(campus);

    store.reloadSnapshot();
    store.replan();
    store.refresh();
    tick();
    return { campus, slots: getTimeSlots(semester.id, campus) };
  },

  /** 切换当前使用哪套作息（校区） */
  /** 只更新排程偏好，接受任意输入并收敛到安全范围 */
  'prefs:update': (payload) => {
    const prefs = sanitizePrefsView((payload as { prefs?: unknown })?.prefs ?? payload);
    store.updateSettings({ plannerPrefs: prefs });
    store.replan();
    store.refresh();
    tick();
    return store.getState();
  },

  /** 切换记账视图或翻页；只重算记账那部分，不碰日程 */
  'expense:setView': (payload) => {
    const input = (payload ?? {}) as { mode?: string; anchorDate?: string; shift?: number };
    const mode =
      input.mode === 'day' || input.mode === 'week' || input.mode === 'month' ? input.mode : undefined;

    // shift 与 anchorDate 二选一：shift 表示"相对当前区间前后翻页"，
    // 让渲染层不必知道"一周是 7 天"这类规则（规则只在 shared/expense 里有一份）
    const current = store.getExpenseView();
    const baseDate = input.anchorDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? input.anchorDate : current.anchorDate;
    const anchorDate =
      typeof input.shift === 'number'
        ? shiftDate(mode ?? current.mode, baseDate, Math.round(input.shift))
        : baseDate;

    store.setExpenseView({ mode, anchorDate });
    return store.getState();
  },

  /** 记一笔支出 */
  'expense:add': (payload) => {
    const input = (payload ?? {}) as {
      categoryId?: string;
      amount?: unknown;
      date?: string;
      note?: string;
    };
    const categoryId = typeof input.categoryId === 'string' ? input.categoryId : '';
    if (!categoryId) throw new Error('请选择分类');
    if (!getExpenseCategories().some((c) => c.id === categoryId)) throw new Error('分类不存在');

    const amount = Number(input.amount);
    // 金额必须为正：这个模块只记支出，方向和正负号无关，混进负数会让所有汇总失去意义
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额要大于 0');
    if (amount > 1_000_000) throw new Error('金额过大，请检查是否输错');

    addExpenseEntry({
      categoryId,
      amount: Math.round(amount * 100) / 100,
      date: input.date?.match(/^\d{4}-\d{2}-\d{2}$/) ? input.date : today(),
      note: typeof input.note === 'string' ? input.note.slice(0, 120) : ''
    });

    store.refresh();
    tick();
    return store.getState();
  },

  'expense:remove': (payload) => {
    const id = (payload as { id?: string })?.id;
    if (typeof id !== 'string' || !id) throw new Error('缺少记录 id');
    deleteExpenseEntry(id);
    store.refresh();
    return store.getState();
  },

  /** 新增或修改分类（含每日目标） */
  'expense:saveCategory': (payload) => {
    const input = (payload ?? {}) as {
      id?: string;
      name?: string;
      icon?: string;
      color?: string;
      dailyTarget?: unknown;
    };
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 12) : '';
    if (!name) throw new Error('分类名不能为空');

    // 每日目标收敛：负数没有意义，上限防手滑写成一亿
    const rawTarget = Number(input.dailyTarget);
    const dailyTarget = Number.isFinite(rawTarget) ? Math.min(Math.max(rawTarget, 0), 100000) : 0;

    if (input.id) {
      updateExpenseCategory(input.id, {
        name,
        icon: input.icon,
        color: input.color,
        dailyTarget: Math.round(dailyTarget * 100) / 100
      });
    } else {
      createExpenseCategory({
        name,
        icon: input.icon,
        color: input.color,
        dailyTarget: Math.round(dailyTarget * 100) / 100
      });
    }

    store.refresh();
    return store.getState();
  },

  'expense:removeCategory': (payload) => {
    const id = (payload as { id?: string })?.id;
    if (typeof id !== 'string' || !id) throw new Error('缺少分类 id');
    // 有流水时会抛错，消息由数据层给出（说明还有多少笔）
    deleteExpenseCategory(id);
    store.refresh();
    return store.getState();
  },

  /** 每日总预算（期初余额未填时的兜底口径） */
  'expense:setBudget': (payload) => {
    const raw = Number((payload as { amount?: unknown })?.amount);
    if (!Number.isFinite(raw) || raw < 0) throw new Error('预算不能为负数');
    setExpenseDailyBudget(Math.min(Math.round(raw * 100) / 100, 100000));
    store.refresh();
    return store.getState();
  },

  /** 设置某个月的期初余额（用户月初自己填的生活费） */
  'expense:setMonthBudget': (payload) => {
    const input = (payload ?? {}) as { month?: string; amount?: unknown; note?: string };
    const month = typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month) ? input.month : undefined;
    if (!month) throw new Error('月份格式应为 YYYY-MM');

    const raw = Number(input.amount);
    if (!Number.isFinite(raw) || raw < 0) throw new Error('金额不能为负数');

    setMonthBudget(month, Math.min(Math.round(raw * 100) / 100, 10_000_000), typeof input.note === 'string' ? input.note.slice(0, 60) : '');
    store.refresh();
    return store.getState();
  },

  /** 清掉某月的期初余额，退回"每日总预算 × 天数" */
  'expense:clearMonthBudget': (payload) => {
    const month = (payload as { month?: string })?.month;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式应为 YYYY-MM');
    clearMonthBudget(month);
    store.refresh();
    return store.getState();
  },

  /**
   * 清空示例数据。
   *
   * **只清流水，不删分类**：分类是用户要长期使用的结构（还可能已经改过目标），
   * 连带删掉会把他的设置一起抹掉。所以这里只清空 expense_entry。
   *
   * 另外做了一次「仍是示例数据」的校验：万一界面状态过期
   * （比如另一个窗口已经加过真实记录），也不会误删用户自己记的账。
   */
  'expense:clearSample': () => {
    const state = store.getState();
    if (!state.expense.isSampleData) {
      throw new Error('当前流水已不是示例数据，为避免误删已取消操作');
    }
    const removed = deleteAllExpenseEntries();
    store.refresh();
    tick();
    return { removed, state: store.getState() };
  },

  /* ------------------------------------------------------------ 打卡 */

  /** 切换打卡停留的月份（月视图翻页） */
  'habit:setMonth': (payload) => {
    const month = (payload as { month?: string })?.month;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('月份格式应为 YYYY-MM');
    }
    store.setHabitMonth(month);
    return store.getState();
  },

  /** 新建习惯 */
  'habit:add': (payload) => {
    const input = (payload ?? {}) as {
      name?: string;
      icon?: string;
      color?: string;
      activeDays?: unknown;
    };
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 20) : '';
    if (!name) throw new Error('习惯名不能为空');

    const activeDays = Array.isArray(input.activeDays)
      ? input.activeDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
      : [];
    const icon = normalizeHabitIcon(input.icon);
    const color = typeof input.color === 'string' ? input.color : undefined;

    createHabit({ name, icon, color, activeDays, startDate: today() });
    store.refresh();
    return store.getState();
  },

  /** 改习惯（含归档/取消归档） */
  'habit:update': (payload) => {
    const input = (payload ?? {}) as {
      id?: string;
      name?: string;
      icon?: string;
      color?: string;
      activeDays?: unknown;
      archived?: boolean;
    };
    if (typeof input.id !== 'string' || !input.id) throw new Error('缺少习惯 id');

    const patch: Partial<HabitInput> & { archived?: boolean } = {};
    if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim().slice(0, 20);
    if (input.icon !== undefined) {const icon=normalizeHabitIcon(input.icon);if(icon)patch.icon=icon;}
    if (typeof input.color === 'string') patch.color = input.color;
    if (Array.isArray(input.activeDays)) {
      patch.activeDays = input.activeDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    }
    if (typeof input.archived === 'boolean') patch.archived = input.archived;

    updateHabit(input.id, patch);
    store.refresh();
    return store.getState();
  },

  /** 删除习惯（签到随外键级联删除） */
  'habit:remove': (payload) => {
    const id = (payload as { id?: string })?.id;
    if (typeof id !== 'string' || !id) throw new Error('缺少习惯 id');
    deleteHabit(id);
    store.refresh();
    return store.getState();
  },

  /** 打卡 / 取消打卡（用户自己勾选完成） */
  'habit:setCheckin': (payload) => {
    const input = (payload ?? {}) as { habitId?: string; date?: string; done?: boolean };
    if (typeof input.habitId !== 'string' || !input.habitId) throw new Error('缺少习惯 id');
    const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today();
    setCheckin(input.habitId, date, input.done !== false);
    store.refresh();
    return store.getState();
  },

  'campus:set': (payload) => {
    const campus = (payload as { campus?: string })?.campus;
    if (typeof campus !== 'string' || !campus) throw new Error('缺少校区名');
    setActiveCampus(campus);
    store.reloadSnapshot();
    store.replan();
    store.refresh();
    tick();
    return store.getState();
  },

  'toast:action': (payload) => {
    const input = (payload ?? {}) as {
      action?: string;
      id?: string;
      minutes?: number;
      reminderId?: string;
      taskId?: string;
    };
    const id = input.id ?? '';
    const item=getIslandToasts().items.find(item=>item.id===id);
    if (input.action === 'done' && input.taskId) {
      store.completeTask(input.taskId);
      clearTaskToasts(input.taskId);
      return store.getState();
    }
    if (input.action === 'snooze') {
      const minutes = clamp(Number(input.minutes ?? 15), 1, 1440);
      const item=getIslandToasts().items.find(item=>item.id===id);
      if(!item)throw new Error('这条提醒已处理');
      if(item.kind==='event')return false;
      createSnoozedReminder(item,addMinutes(nowLocal(),minutes));dismissToast(id);
      return true;
    }
    if (input.action === 'open') {
      if(item?.kind==='event'||item?.kind==='startup')navigateMainWindow({page:'schedule'});else createMainWindow();
      dismissToast(id);
      return true;
    }
    dismissToast(id);
    return true;
  },

  'toast:clear': () => {
    clearToasts();
    return true;
  },

  'app:openBackupFolder': async () => {
    const error = await shell.openPath(join(app.getPath('userData'), 'backup'));
    if (error) throw new Error('无法打开备份文件夹，请稍后重试');
    return true;
  },

  'app:meta': () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath('userData'),
    now: nowLocal(),
    nextSnooze: addMinutes(nowLocal(), 15)
  })
};

function assertGoalSender(event?:IpcMainInvokeEvent){if(!event||event.sender!==getWindow('main')?.webContents)throw Error('请在主窗口中打开长期任务');}
function notifyGoals(){getWindow('main')?.webContents.send('goals:changed');}
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeUrgency(value: unknown): Urgency {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 3;
  if (n > 5) return 5;
  return n as Urgency;
}

export function registerIpc(): void {
  registerHomeIpc();
  ipcMain.handle('window:ready', (event) => markMainRendererReady(event.sender));
  for (const [channel, handler] of Object.entries(HANDLERS)) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      try {
        return await handler(payload,event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 主进程留痕，渲染层只拿到简短信息。
        // 测试环境下写 stdout，避免测试框架把预期内的拒绝当成进程级错误。
        if (process.env.COLDESK_LOG_STDOUT === '1') {
          console.log(`[ipc] ${channel} 处理失败：${message}`);
        } else {
          console.error(`[ipc] ${channel} 处理失败：${message}`);
        }
        throw new Error(message);
      }
    });
  }

  // 悬浮窗拖拽结束后请求吸附
  ipcMain.handle('widget:snap', async () => snapWidget());

  // 渲染层上报全屏状态（用于免打扰）
  ipcMain.on('fullscreen:report', (_event, payload: { active?: boolean }) => {
    setFullscreenActive(Boolean(payload?.active));
  });

  // 唤醒后补弹
  ipcMain.on('power:resume', () => catchUpAfterResume());
}
