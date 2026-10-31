import * as React from 'react';
import { navigationOrder, NAV_LABELS, type NavPage } from '@shared/navigation';
import type { TodayView } from '@shared/view';
export function NavigationSettings({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    const order = navigationOrder(state?.settings.navigationOrder);
    const move = (page: NavPage, direction: number) => { const next = [...order], i = next.indexOf(page), j = i + direction; if (j < 0 || j >= next.length)
        return; [next[i], next[j]] = [next[j], next[i]]; update({ navigationOrder: next }); };
    return <section className="panel navigation-settings"><h2>语言与导航</h2><label className="setting-choice"><span>界面语言</span><select className="input" aria-label="界面语言" value={state?.settings.language ?? 'zh-CN'} onChange={e => update({ language: e.target.value })}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option></select></label><label className="setting-choice"><span>启动时打开</span><select className="input" aria-label="启动时打开" value={state?.settings.startPage ?? 'schedule'} onChange={e => update({ startPage: e.target.value })}>{order.map(page => <option value={page} key={page}>{NAV_LABELS[page]}</option>)}</select></label><h3>导航顺序</h3><p className="t-caption">调整左侧导航的顺序，保存后立即生效。</p><ol className="navigation-order">{order.map((page, i) => <li key={page}><span>{NAV_LABELS[page]}</span><button className="ghost-btn" disabled={i === 0} aria-label={`上移 ${NAV_LABELS[page]}`} onClick={() => move(page, -1)}>↑</button><button className="ghost-btn" disabled={i === order.length - 1} aria-label={`下移 ${NAV_LABELS[page]}`} onClick={() => move(page, 1)}>↓</button></li>)}</ol><button className="ghost-btn" onClick={() => update({ navigationOrder: navigationOrder(null), startPage: 'schedule' })}>恢复默认导航</button></section>;
}
