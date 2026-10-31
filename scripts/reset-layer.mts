/**
 * 把 desktopLayer 恢复成 'top'（置顶）。
 *
 * 为什么需要这个脚本：用户点层级按钮时切到了"普通"，
 * 此时悬浮窗不再置顶、会被所有窗口盖住，于是"在设置里调整看不到反应"。
 * 置顶/置底本就是他可选的行为，这里只是把状态恢复到默认的置顶。
 *
 * 用法：node --import tsx scripts/reset-layer.mts [top|normal|bottom]
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const target = (process.argv[2] ?? 'top') as 'top' | 'normal' | 'bottom';
if (!['top', 'normal', 'bottom'].includes(target)) {
  console.error('层级只能是 top / normal / bottom');
  process.exit(1);
}

const dbPath = join(process.env.APPDATA ?? '.', 'coldesk', 'coldesk.db');
const db = new DatabaseSync(dbPath);

const row = db.prepare("SELECT value FROM setting WHERE key = 'app'").get() as { value: string } | undefined;
if (!row) {
  console.log('设置还没写过（仍是默认值），无需修改。');
} else {
  const settings = JSON.parse(row.value) as Record<string, unknown>;
  console.log(`改前：desktopLayer=${String(settings.desktopLayer)} glassOpacity=${String(settings.glassOpacity)}`);
  settings.desktopLayer = target;
  db.prepare("UPDATE setting SET value = ? WHERE key = 'app'").run(JSON.stringify(settings));
  console.log(`改后：desktopLayer=${target}`);
}

db.close();
