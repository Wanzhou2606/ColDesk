import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog, nativeImage, shell, type BrowserWindow } from 'electron';

function directory() { return join(app.getPath('userData'), 'personalization'); }
export function customIconPath(extension = 'png'): string | null {
  try {
    const choice = JSON.parse(readFileSync(join(directory(), 'icon-choice.json'), 'utf8')) as { id?: string };
    if (!choice.id || !/^[a-f0-9]{16}$/.test(choice.id)) return null;
    const file = join(directory(), `icon-${choice.id}.${extension}`);
    return existsSync(file) ? file : null;
  } catch { return null; }
}
export function readIconChoice() {
  const file = customIconPath();
  return { custom: !!file, url: file ? 'data:image/png;base64,' + readFileSync(file).toString('base64') : './app-icon.png' };
}
export async function chooseIcon(owner: BrowserWindow) {
  const result = await dialog.showOpenDialog(owner, { title: '选择软件图标', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'ico'] }] });
  if (result.canceled || !result.filePaths.length) return null;
  const file = result.filePaths[0];
  if (statSync(file).size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的图片');
  const image = nativeImage.createFromPath(file), size = image.getSize();
  if (image.isEmpty() || !size.width || !size.height) throw new Error('这张图片无法读取，请选择 PNG、JPG 或 WebP 图片');
  if (size.width > 8192 || size.height > 8192) throw new Error('图片尺寸过大，请选择边长不超过 8192 像素的图片');
  const edge = Math.min(size.width, size.height);
  const png = image.crop({ x: Math.floor((size.width-edge)/2), y: Math.floor((size.height-edge)/2), width: edge, height: edge }).resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  const id = createHash('sha256').update(png).digest('hex').slice(0,16), header = Buffer.alloc(22);
  header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); header.writeUInt16LE(1,10); header.writeUInt16LE(32,12); header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
  mkdirSync(directory(),{recursive:true});
  writeFileSync(join(directory(),`icon-${id}.png`),png); writeFileSync(join(directory(),`icon-${id}.ico`),Buffer.concat([header,png]));
  writeFileSync(join(directory(),'icon-choice.json'),JSON.stringify({id}));
  return readIconChoice();
}
export function resetIconChoice() { mkdirSync(directory(),{recursive:true});writeFileSync(join(directory(),'icon-choice.json'),'{}');return readIconChoice(); }
/** 仅更新属于已安装 ColDesk 的现有快捷方式，不创建或修改其他软件的入口。 */
export function updateIconShortcuts(icon: string): { updated: number; failed: number } {
  if (!app.isPackaged || process.platform !== 'win32') return { updated: 0, failed: 0 };
  let updated=0, failed=0;
  const candidates=[join(app.getPath('desktop'),'ColDesk.lnk'),join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs/ColDesk.lnk'),join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs/ColDesk/ColDesk.lnk')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try { const link=shell.readShortcutLink(file);if(link.target.toLowerCase()!==app.getPath('exe').toLowerCase())continue;if(shell.writeShortcutLink(file,'update',{...link,icon,iconIndex:0}))updated++;else failed++; }
    catch { failed++; }
  }
  return { updated, failed };
}
