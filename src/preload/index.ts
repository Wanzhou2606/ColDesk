import { contextBridge, ipcRenderer } from 'electron';

/**
 * 渲染进程唯一入口：只暴露白名单方法，主进程再做一次校验。
 * 不使用 nodeIntegration，渲染层拿不到 Node API。
 */

const INVOKE_CHANNELS = [
  'app:interaction',
  'goals:list','goals:get','goals:save','goals:complete','goals:delete','goals:link','goals:primary','goals:progress','goals:progressMonth','courses:color','courses:colorReset','schedule:view','schedule:notToday','schedule:saveSegments','schedule:saveEvent','schedule:deleteEvent',
  'links:list','links:expenses','links:add','links:remove',
  'window:ready',
  'appearance:iconGet','appearance:iconPick','appearance:iconReset', 'sync:status',
  'home:status', 'home:setup', 'home:unlock', 'home:lock', 'home:get', 'home:month',
  'home:save', 'home:export', 'home:protection', 'home:dirty', 'home:flushResult',
  'home:attachmentAdd','home:attachmentRead','home:attachmentExport','home:attachmentRemove',
  'timetable:current','timetable:delete','timetable:preview','timetable:import','timetable:prompt','habit:quoteRefresh',
  'hdu:open','hdu:clipboard','hdu:preview','hdu:commit','hdu:clear',
  'state:get',
  'state:refresh',
  'jarvis:status', 'jarvis:reconnect',
  'task:quickAdd',
  'task:create',
  'task:update', 'task:pin', 'task:delete', 'task:openEditor',
  'task:complete',
  'task:reopen',
  'task:list',
  'schedule:replan',
  'schedule:placeTask',
  'schedule:removePlacement',
  'settings:update',
  'widget:setSize',
  'widget:dragStart','widget:dragEnd','toast:get',
  'widget:show',
  'widget:hide',
  'widget:openMain',
  'widget:toggle',
  'widget:openSettings',
  'widget:openExpenses',
  'drawer:expand',
  'timeslots:get',
  'timeslots:save',
  'campus:set',
  'prefs:update',
  'window:setLayer',
  'window:setGlass',
  'expense:setView',
  'expense:add',
  'expense:remove',
  'expense:saveCategory',
  'expense:removeCategory',
  'expense:setBudget',
  'expense:setMonthBudget',
  'expense:clearMonthBudget',
  'expense:clearSample',
  'habit:setMonth',
  'habit:add',
  'habit:update',
  'habit:remove',
  'habit:setCheckin',
  'toast:action',
  'toast:clear',
  'app:meta',
  'app:openBackupFolder'
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

const listeners = new Map<string, Set<(payload: unknown) => void>>();

const FORWARD_CHANNELS = ['state:changed', 'goals:changed','toast:update', 'navigate', 'home:flush','island:update','widget:dragEnded','widget:dragStarted','widget:hover','appearance:iconChanged'] as const;

for (const channel of FORWARD_CHANNELS) {
  ipcRenderer.on(channel, (_event, payload) => {
    const set = listeners.get(channel);
    if (!set) return;
    for (const fn of set) fn(payload);
  });
}

const api = {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!(INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      return Promise.reject(new Error(`未授权的主进程通道：${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, handler: (payload: unknown) => void): () => void {
    if (!(FORWARD_CHANNELS as readonly string[]).includes(channel)) return () => undefined;
    const set = listeners.get(channel) ?? new Set();
    set.add(handler);
    listeners.set(channel, set);
    return () => set.delete(handler);
  }
};

contextBridge.exposeInMainWorld('coldesk', api);

export type ColdeskApi = typeof api;
