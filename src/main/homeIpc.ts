import { ipcMain, dialog, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { homeVault } from './home';
import { getWindow } from './windows';
import { writeHomeExport, homeExportFormat } from './homeExport';
import { addHomeAttachments, previewHomeAttachment, exportHomeAttachment } from './homeAttachments';
import type { HomeExportOptions } from '@shared/home';

let exporting = false;
async function exportHome(sender: number, payload: unknown) {
  if (exporting) throw new Error('正在导出，请稍候');
  if (homeVault.hasDraft(sender)) throw new Error('请先保存当前日记再导出');
  if (!homeVault.exportEntries(sender, payload).length) throw new Error('所选范围还没有日记可以导出');
  const main = getWindow('main');
  if (!main) throw new Error('请在主窗口中导出日记');
  exporting = true;
  try {
    const result = await dialog.showOpenDialog(main, { title: '选择日记导出文件夹', buttonLabel: '导出到这里', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths.length) return { canceled: true, count: 0 };
    // 系统对话框打开期间可能已锁定或关闭 home，重新验证当前会话。
    if (homeVault.hasDraft(sender)) throw new Error('请先保存当前日记再导出');
    const entries = homeVault.exportEntries(sender, payload);
    const options=payload as HomeExportOptions;
    if(options.mode!==undefined&&!['overview','diary'].includes(options.mode)||options.format!==undefined&&!['txt','word'].includes(options.format))throw new Error('请选择有效的导出方式');
    const folder = await writeHomeExport(result.filePaths[0], entries, options,(date,id)=>homeVault.asset(sender,date,id));
    return { canceled: false, count: entries.length, folder,format:homeExportFormat(entries,options),mode:options.mode??'diary' };
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error;
    throw new Error('无法写入所选文件夹，请检查权限或换一个文件夹后重试');
  } finally { exporting = false; }
}

const pending = new Map<string, { sender: number; finish: (ok: boolean) => void }>();
export function flushHome(contents: WebContents): Promise<boolean> {
  if (!homeVault.hasDraft(contents.id)) return Promise.resolve(true);
  return new Promise(resolve => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); resolve(false); }, 8000);
    pending.set(id, { sender: contents.id, finish: ok => { clearTimeout(timer); pending.delete(id); resolve(ok); } });
    contents.send('home:flush', { id });
  });
}
export function registerHomeIpc(): void {
  const handlers: Record<string, (sender: number, payload: any) => unknown> = {
    'home:status': sender => homeVault.status(sender),
    'home:setup': (sender, payload) => homeVault.setup(sender, payload?.password),
    'home:unlock': (sender, payload) => homeVault.unlock(sender, payload?.password),
    'home:lock': sender => { homeVault.lock(sender); return true; },
    'home:get': (sender, payload) => homeVault.get(sender, payload?.date),
    'home:month': (sender, payload) => homeVault.month(sender, payload?.month),
    'home:save': (sender, payload) => homeVault.save(sender, payload),
    'home:export': exportHome,
    'home:attachmentAdd': addHomeAttachments,
    'home:attachmentRead': previewHomeAttachment,
    'home:attachmentExport': exportHomeAttachment,
    'home:attachmentRemove': (sender,payload)=>{if(homeVault.hasDraft(sender))throw new Error('请先保存日记');return homeVault.removeAsset(sender,payload?.date,payload?.id);},
    'home:protection': (sender, payload) => { homeVault.changeProtection(sender, payload?.password); return homeVault.status(sender); },
    'home:dirty': (sender, payload) => { homeVault.setDirty(sender, payload?.dirty === true); return true; },
    'home:flushResult': (sender, payload) => { const request = pending.get(payload?.id); if (request?.sender === sender) request.finish(payload.ok === true); return true; }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, payload) => {
    if (event.sender !== getWindow('main')?.webContents) throw new Error('请在主窗口中打开 home');
    return handler(event.sender.id, payload);
  });
}
