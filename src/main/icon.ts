/** 原生窗口与托盘共用用户选择的透明底ColDesk 图标。资源随构建产物发布。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeImage } from 'electron';
import { customIconPath } from './personalization';

export const APP_USER_MODEL_ID = 'com.coldesk.app';
const cache = new Map<number, Buffer>();

export function appIconPath(): string {
  const custom = customIconPath('ico');
  if (custom) return custom;
  if (app.isPackaged) return join(process.resourcesPath, 'app-icon.ico');
  return join(__dirname, 'icons/app-icon.ico');
}

export function coldeskIcon(size = 32): Buffer {
  const custom = customIconPath();
  if (custom) {
    try { const image=nativeImage.createFromPath(custom);if(!image.isEmpty())return image.resize({width:size,height:size}).toPNG(); } catch { /* 图片损坏时使用默认图标，保持应用可启动。 */ }
  }
  const sourceSize = size <= 16 ? 16 : size <= 32 ? 32 : size <= 64 ? 64 : 256;
  let image = cache.get(sourceSize);
  if (!image) {
    image = readFileSync(join(__dirname, `icons/app-icon-${sourceSize}.png`));
    cache.set(sourceSize, image);
  }
  return image;
}
