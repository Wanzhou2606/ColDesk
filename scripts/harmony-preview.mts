import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WidgetView } from '../src/renderer/src/windows/WidgetView';
import { fakeTask, fakeView } from '../src/renderer/__tests__/fixtures';

// 单独的展示场景，不写入用户数据；样式直接复用生产文件。
const state = fakeView({
  now: '2026-10-09T10:10', date: '2026-10-09', dateLabel: '10月09日 周五',
  primary: { id: 'preview-class', kind: 'lesson', title: '大学板块体育', startAt: '2026-10-09T10:25', endAt: '2026-10-09T12:00', status: 'soon', untilStartMinutes: 15, untilEndMinutes: 110, timeLabel: '10:25–12:00', countdownLabel: '15 分钟后开始', location: '体育馆', color: '#46968e' },
  next: [{ id: 'preview-next', kind: 'lesson', title: '工程制图', startAt: '2026-10-09T15:15', endAt: '2026-10-09T16:50', status: 'upcoming', untilStartMinutes: 305, untilEndMinutes: 400, timeLabel: '15:15–16:50', countdownLabel: '5 小时 5 分钟后开始', location: '正心楼 206', color: '#5980be' }],
  todayTasks: [{ task: fakeTask('preview-task', '工程制图 · 三视图练习', { urgency: 5, dueAt: '2026-10-09T20:00' }), overdue: false, dueLabel: '今天 20:00', untilDueMinutes: 590 }],
  urgentTasks: [{ task: fakeTask('preview-report', 'C 语言实验报告', { urgency: 3, dueAt: '2026-10-10T18:00' }), overdue: false, dueLabel: '明天 18:00', untilDueMinutes: 1910 }],
  summary: { lessonCount: 2, dueTodayCount: 1, overdueCount: 0, doneTodayCount: 2, plannedMinutes: 90 }
});
const noop = () => undefined;
const props = { state, quickTitle: '', urgency: 3 as const, domain: 'study' as const, collapsed: false, rippleKey: null, onQuickTitleChange: noop, onUrgencyChange: noop, onDomainChange: noop, onToggleCollapsed: noop, actions: { onQuickAdd: noop, onComplete: noop, onHide: noop, onCycleLayer: noop, onOpenMain: noop, onOpenSettings: noop, onOpenExpenses: noop } };
const markup = renderToStaticMarkup(createElement(WidgetView, props));
const css = ['glass.css', 'widget.css', 'widget-glass.css'].map(f => readFileSync(join(process.cwd(), 'src/renderer/src/styles', f), 'utf8')).join('\n');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const preview = (dark: boolean) => `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}"><style>${css.replaceAll('@media (prefers-color-scheme: dark)', dark ? '@media all' : '@media not all')}
body{height:680px;overflow:hidden;background:${dark ? 'radial-gradient(ellipse at 0% 100%,#626083,transparent 65%),radial-gradient(ellipse at 100% 0%,#22516c,transparent 60%),#152539' : 'radial-gradient(ellipse at 20% 25%,#dfebdc,transparent 55%),radial-gradient(ellipse at 85% 70%,#77aed0,transparent 55%),#adc9d7'};color-scheme:${dark ? 'dark' : 'light'}}
.widget-root{width:340px;margin:22px auto} .widget-shell--harmony{max-height:628px}
</style></head><body>${markup}</body></html>`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>ColDesk · 沉浸光感试作</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:#203149;font-family:'Microsoft YaHei UI',sans-serif}main{max-width:1040px;margin:auto;padding:38px 44px}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}h1{font-size:27px;letter-spacing:-.7px;margin:0 0 9px}p{font-size:13px;color:#5a6d84;margin:0;line-height:1.8}.badge{border:1px solid #c9d6e4;padding:8px 14px;border-radius:22px;font-size:12px}.samples{display:grid;grid-template-columns:1fr 1fr;gap:24px}iframe{border:0;width:100%;height:680px;display:block;border-radius:28px}.caption{display:flex;justify-content:space-between;padding:0 4px 12px;font-size:12px;color:#5a6d84}.caption strong{color:#203149;font-size:14px}footer{padding-top:18px;font-size:12px;color:#66788d;line-height:1.8}@media(max-width:760px){main{padding:24px}.samples{grid-template-columns:1fr}}
</style></head><body><main><header><div><h1>ColDesk · 沉浸光感</h1><p>圆润亮边 / 冷暖折光 / 胶囊工具栏</p></div><div class="badge">浮窗试作 · 2026.10</div></header><div class="samples"><section><div class="caption"><strong>浅色背景</strong><span>静态光感</span></div><iframe title="浅色背景光感预览" srcdoc="${escape(preview(false))}"></iframe></section><section><div class="caption"><strong>深色背景</strong><span>文字优先</span></div><iframe title="深色背景光感预览" srcdoc="${escape(preview(true))}"></iframe></section></div><footer>这里是同页背景下的样式预览，课表与任务为展示场景。实际桌面浮窗不采集背景画面；亮边为固定静态光效，设置中可调透明度。</footer></main></body></html>`;
mkdirSync(join(process.cwd(), 'preview'), { recursive: true });
copyFileSync(join(process.cwd(), 'src/renderer/public/app-icon.png'), join(process.cwd(), 'preview/app-icon.png'));
writeFileSync(join(process.cwd(), 'preview/harmony-glass.html'), html);
console.log('已生成 preview/harmony-glass.html');
