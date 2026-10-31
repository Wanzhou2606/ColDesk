import {TimePicker} from '../components/TimePicker';
import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { URGENCY_TABLE } from '@shared/scoring';
import type { Urgency } from '@shared/types';
import type { TodayView } from '@shared/view';
import { getApi } from '../lib/api';
import { TimeSlotEditor } from '../components/TimeSlotEditor';
import { UsageHelp } from '../components/UsageHelp';
import { ScheduleTimeSettings } from '../components/ScheduleTimeSettings';
import { PersonalizationSettings } from '../components/PersonalizationSettings';
import { FontSettings } from '../components/FontSettings';
import { TimetableImport } from '../components/TimetableImport';
import { TimetableMaintenance } from '../components/TimetableMaintenance';
import { HduCalendarImport } from '../components/HduCalendarImport';
import type { PageKey } from '../app/App';
import { NavigationSettings } from '../components/NavigationSettings';
/**
 * 设置页。
 *
 * 结构：左侧二级菜单 + 右侧内容区。
 * 之前把所有设置堆在一页里（七八个大面板），找一项要滚很久，
 * 所以按"用户想做的事"拆成 7 组：
 *   通用 / 提醒 / 悬浮窗 / 课程时间 / 排程 / 数据 / 关于
 *
 * 每个分组是独立的子组件，避免切换分组时整页重渲染导致输入框失焦。
 */
type SectionKey = 'personalization' | 'general' | 'appearance' | 'reminder' | 'widget' | 'timetable' | 'planner' | 'data' | 'jarvis' | 'help' | 'about';
const SECTIONS: Array<{
    key: SectionKey;
    label: string;
    icon: string;
    hint: string;
}> = [
    { key: 'general', label: '通用', icon: '⚙', hint: '开机自启与使用习惯' },
    { key: 'appearance', label: '外观与桌面', icon: 'Aa', hint: '字体、月历、对比度与悬浮窗' },
    { key: 'personalization', label: '个性化', icon: '◌', hint: '图标与主页面、home 的主题颜色' },
    { key: 'reminder', label: '提醒', icon: '🔔', hint: '汇总时间、上课提醒、免打扰' },
    { key: 'timetable', label: '课程与排程', icon: '🕐', hint: '日程时间、导入课表与手动安排' },
    { key: 'data', label: '数据', icon: '💾', hint: '本地保存与备份' },
    { key: 'jarvis', label: 'AI 助手', icon: '🤖', hint: '贾维斯连接状态与一键重连' },
    { key: 'help', label: '使用帮助', icon: '?', hint: '入门引导、操作说明与关于' }
];
export function SettingsPage({ state, initialSection = 'general', onReplayIntro = () => { }, onNavigate = () => { } }: {
    state: TodayView | null;
    initialSection?: SectionKey;
    onReplayIntro?: () => void;
    onNavigate?: (page: PageKey) => void;
}) {
    const [section, setSection] = useState<SectionKey>(initialSection);
    const [saveMessage, setSaveMessage] = useState('');
    const update = (patch: Record<string, unknown>) => {
        setSaveMessage('');
        void getApi().invoke('settings:update', patch).then(() => setSaveMessage('设置已保存。')).catch(() => setSaveMessage('暂时未能保存，请重试。'));
    };
    return (<div className="page settings-page"><header className="page-head"><div><h1 className="page-title">{"\u8BBE\u7F6E"}</h1><div className="t-caption">{"\u6309\u4F60\u7684\u4E60\u60EF\uFF0C\u8C03\u6574\u63D0\u9192\u548C\u684C\u9762\u663E\u793A"}</div></div></header>{saveMessage && <div className="t-caption" role="status">{saveMessage}</div>}<div className="settings-layout"><nav className="settings-nav">{SECTIONS.map(item => <button className={`settings-nav-item${section === item.key ? " active" : ""}`} onClick={() => setSection(item.key)} title={item.hint} aria-current={section === item.key ? "page" : void 0} key={item.key}><span className="settings-nav-icon" aria-hidden="true">{item.icon}</span><span className="settings-nav-label">{item.label}</span></button>)}</nav><div className="settings-body"><div className="settings-section-heading"><h2>{SECTIONS.find(item => item.key === section)?.label}</h2><p>{SECTIONS.find(item => item.key === section)?.hint}</p></div>{section === "general" && <><NavigationSettings state={state} update={update}/><GeneralSection state={state} update={update}/></>}{section === "appearance" && <><section className="panel"><Field label="提高对比度" hint="减少半透明效果，让文字和边界更清楚" control={<Switch checked={state?.settings.highContrast ?? false} onChange={v => update({ highContrast: v })}></Switch>}></Field></section><FontSettings state={state} update={update}></FontSettings><WidgetSection state={state} update={update}></WidgetSection></>}{section === "personalization" && <PersonalizationSettings state={state} update={update}></PersonalizationSettings>}{section === "reminder" && <ReminderSection state={state} update={update}></ReminderSection>}{section === "widget" && <WidgetSection state={state} update={update}></WidgetSection>}{section === "timetable" && <><ScheduleTimeSettings state={state}></ScheduleTimeSettings><TimetableMaintenance courses={state?.courses ?? []}/><HduCalendarImport onViewSchedule={() => onNavigate("schedule")}></HduCalendarImport><TimetableImport></TimetableImport>{!!state?.courses.length && <TimeSlotEditor></TimeSlotEditor>}<PlannerSection state={state} update={update}></PlannerSection></>}{section === "planner" && <PlannerSection state={state} update={update}></PlannerSection>}{section === "data" && <DataSection></DataSection>}{section === "jarvis" && <JarvisSection></JarvisSection>}{section === "help" && <><UsageHelp onReplay={onReplayIntro} onNavigate={onNavigate}></UsageHelp><AboutSection state={state}></AboutSection></>}{section === "about" && <AboutSection state={state}></AboutSection>}</div></div></div>);
}
/* ------------------------------------------------------------ 通用 */
function GeneralSection({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u901A\u7528"}</span></div><Field label="开机自启" hint="登录 Windows 后自动启动 ColDesk" control={<Switch checked={state?.settings.autoLaunch ?? false} onChange={v => update({ autoLaunch: v })}></Switch>}></Field></section>);
}
/* ------------------------------------------------------------ 提醒 */
function ReminderSection({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u63D0\u9192"}</span></div><Field label="每日汇总时间" hint="汇总当天安排、到期任务和超期事项" control={<TimePicker className="input narrow" value={state?.settings.dailyDigestAt ?? "07:30"} onChange={e => update({ dailyDigestAt: e })}/>}></Field>{(state?.courses.length ?? 0) > 0 && <Field label="上课前 15 分钟提醒" hint="包含课程名与教室" control={<Switch checked={state?.settings.classReminder ?? true} onChange={v => update({ classReminder: v })}></Switch>}></Field>}<Field label="全屏时免打扰" hint="全屏应用运行时静默排队，退出后合并补弹" control={<Switch checked={state?.settings.quietOnFullscreen ?? true} onChange={v => update({ quietOnFullscreen: v })}></Switch>}></Field></section>);
}
/* ------------------------------------------------------------ 悬浮窗 */
/**
 * 悬浮窗外观。
 *
 * 这里的滑块做过一次性能修复：
 * 原来 onInput 直接调 settings:update，从 45% 拖到 100% 会触发 55 次
 * "写库 + 重排日程 + 重建提醒 + 广播状态"，所以拖动明显卡顿。
 * 现在改成：
 *   1. 本地 state 立即回显（视觉上跟手）
 *   2. 120ms 防抖后才提交
 *   3. 提交走 window:setGlass，只改设置、不碰排程
 */
function WidgetSection({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    const savedOpacity = state?.settings.glassOpacity ?? 0.62;
    const [draftOpacity, setDraftOpacity] = useState(Math.round(savedOpacity * 100));
    const timer = useRef<number | null>(null);
    // 主进程回传后同步一次（例如在别处改过）
    useEffect(() => {
        setDraftOpacity(Math.round(savedOpacity * 100));
    }, [savedOpacity]);
    useEffect(() => () => {
        if (timer.current !== null)
            window.clearTimeout(timer.current);
    }, []);
    const commitOpacity = (value: number) => {
        setDraftOpacity(value);
        if (timer.current !== null)
            window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            timer.current = null;
            void getApi().invoke('window:setGlass', { glassOpacity: value / 100 });
        }, 120);
    };
    const layer = state?.settings.desktopLayer ?? 'top';
    return (<><section className="panel"><div className="panel-head"><span className="t-title">{"\u60AC\u6D6E\u7A97\u5916\u89C2"}</span><span className="t-caption">{"\u5F53\u524D "}{draftOpacity}{"%"}</span></div><div className="slider-row"><span className="t-caption">{"\u66F4\u900F"}</span><input type="range" aria-label="玻璃不透明度" className="slider" min={45} max={100} step={1} value={draftOpacity} onChange={e => commitOpacity(Number(e.target.value))}></input><span className="t-caption">{"\u66F4\u5B9E"}</span></div><div className="t-caption">{"\u6570\u503C\u8D8A\u5927\uFF0C\u5E95\u8272\u8D8A\u5B9E\u3001\u6587\u5B57\u8D8A\u6E05\u695A\uFF1B\u8D8A\u5C0F\uFF0C\u684C\u9762\u900F\u51FA\u8D8A\u591A\u3002\u53EF\u8C03\u8303\u56F4\u4E3A 45%\u2013100%\u3002"}</div><Field label="悬浮窗层级" hint="置底后会被浏览器等窗口盖住，可从托盘菜单改回来" control={<select className="input narrow" value={layer} onChange={e => void getApi().invoke("window:setLayer", { layer: e.target.value })}><option value="top">{"\u56FA\u5B9A\u6700\u524D"}</option><option value="normal">{"\u666E\u901A\uFF08\u4F1A\u88AB\u76D6\u4F4F\uFF09"}</option><option value="bottom">{"\u7F6E\u5E95"}</option></select>}></Field></section><section className="panel"><div className="panel-head"><span className="t-title">{"\u684C\u9762\u5F62\u6001"}</span></div><Field label="显示方式" hint="灵动岛悬停展开日程，移开收起，提醒时动态弹开；拖动顶部可移动" control={<select className="input narrow" value={state?.settings.desktopMode ?? "widget"} onChange={e => update({ desktopMode: e.target.value })}><option value="widget">{"\u53EA\u8981\u60AC\u6D6E\u7A97"}</option><option value="drawer">{"\u53EA\u8981\u8D34\u8FB9\u62BD\u5C49"}</option><option value="both">{"\u4E24\u8005\u90FD\u8981"}</option><option value="island">{"\u7075\u52A8\u5C9B"}</option></select>}></Field></section></>);
}
/* ------------------------------------------------------------ 排程 */
function PlannerSection({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    return <section className="panel"><h2>手动安排日程</h2><p className="t-caption">任务保存后留在任务栏，不会自动占用时间。可在日程页选择日期并拖动任务安排，也可在任务详情里自由设置一个或多个时间段。「不在今日」会收回当天的安排，保留任务内容与截止时间。</p></section>;
}
/* ------------------------------------------------------------ 数据 */
function DataSection() {
    const [message, setMessage] = useState('');
    return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u6570\u636E\u4E0E\u5907\u4EFD"}</span></div><div className="t-caption">{"\u4EFB\u52A1\u3001\u8BB0\u8D26\u548C\u6253\u5361\u8BB0\u5F55\u4FDD\u5B58\u5728\u8FD9\u53F0\u7535\u8111\u4E0A\u3002\u6BCF\u6B21\u542F\u52A8\u4F1A\u81EA\u52A8\u5907\u4EFD\uFF0C\u4FDD\u7559\u6700\u8FD1 14 \u4EFD\u3002"}</div><button className="ghost-btn lg" onClick={() => void getApi().invoke("app:openBackupFolder").catch(() => setMessage("\u65E0\u6CD5\u6253\u5F00\u5907\u4EFD\u6587\u4EF6\u5939\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"))}>{"\u6253\u5F00\u5907\u4EFD\u6587\u4EF6\u5939"}</button><button className="ghost-btn lg" onClick={() => void getApi().invoke("state:refresh").then(() => setMessage("\u6570\u636E\u5DF2\u91CD\u65B0\u52A0\u8F7D\u3002")).catch(() => setMessage("\u6682\u65F6\u65E0\u6CD5\u91CD\u65B0\u52A0\u8F7D\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"))}>{"\u91CD\u65B0\u52A0\u8F7D\u6570\u636E"}</button>{message && <p className="t-caption" role="status">{message}</p>}</section>);
}
/* ------------------------------------------------------------ 关于 */
function AboutSection({ state }: {
    state: TodayView | null;
}) {
    const [meta, setMeta] = useState<{
        version?: string;
    } | null>(null);
    useEffect(() => {
        void getApi()
            .invoke('app:meta')
            .then((value) => setMeta(value as {
            version?: string;
        }));
    }, []);
    return (<><section className="panel"><div className="panel-head"><span className="t-title">{"\u5173\u4E8E ColDesk"}</span><span className="t-caption">{"v"}{meta?.version ?? "0.1.0"}</span></div><div className="t-caption">把任务、日程、记账与习惯放在一处，让每天要做的事更清楚。</div><div className="t-caption">{"\u4E2A\u4EBA\u8BB0\u5F55\u4FDD\u5B58\u5728\u672C\u673A\u3002\u6BCF\u65E5\u540D\u8A00\u4F1A\u8054\u7F51\u83B7\u53D6\uFF0C\u65E0\u6CD5\u8FDE\u63A5\u65F6\u4F7F\u7528\u5185\u7F6E\u5185\u5BB9\u3002"}</div></section><section className="panel"><div className="panel-head"><span className="t-title">{"\u7D27\u8FEB\u5EA6\u4E0E\u63D0\u9192"}</span></div><ul className="urgency-legend">{([5, 4, 3, 2, 1] as const).map(u => { const m = URGENCY_TABLE[u]; return <li className="row gap-6" key={u}><span className="urgency-dot" style={{ background: m.color } as (RecoveredStyle | undefined)}></span><span className="t-body">{u}{" \u00B7 "}{m.label}</span><span className="t-caption grow truncate">{m.meaning}</span><span className="t-caption nowrap">{m.offsets.length === 0 ? "\u4EC5\u6BCF\u65E5\u6C47\u603B" : m.offsets.map(offsetLabel).join(" / ")}</span></li>; })}</ul></section><section className="panel"><div className="panel-head"><span className="t-title">{"\u5FEB\u6377\u952E"}</span></div><ul className="shortcut-list"><li><kbd>{"Ctrl"}</kbd>{" "}<kbd>{"Alt"}</kbd>{" "}<kbd>{"T"}</kbd>{" "}<span className="t-caption">{"\u5FEB\u901F\u6DFB\u52A0\u4EFB\u52A1"}</span></li><li><kbd>{"Ctrl"}</kbd>{" "}<kbd>{"Alt"}</kbd>{" "}<kbd>{"D"}</kbd>{" "}<span className="t-caption">{"\u663E\u793A / \u9690\u85CF\u60AC\u6D6E\u7A97"}</span></li><li><kbd>{"1"}</kbd>{" "}<kbd>{"2"}</kbd>{" "}<kbd>{"3"}</kbd>{" "}<span className="t-caption">{"\u65E5\u7A0B\u9875\u5207\u6362\u65E5\u7A0B\u8868 / \u5468\u89C6\u56FE / \u6E05\u5355"}</span></li><li><span className="t-caption">{"\u62D6\u52A8\u60AC\u6D6E\u7A97\u9876\u90E8\u6A2A\u6761\u53EF\u79FB\u52A8\uFF0C\u677E\u624B\u540E\u81EA\u52A8\u5438\u9644\u5C4F\u5E55\u8FB9\u7F18"}</span></li></ul></section></>);
}
/* ------------------------------------------------------------ 小控件 */
function Field({ label, hint, control }: {
    label: string;
    hint?: string;
    control: ReactNode;
}) {
    return (<div className="field"><div className="grow"><div className="t-body">{label}</div>{hint && <div className="t-caption">{hint}</div>}</div>{control}</div>);
}
function Switch({ checked, onChange }: {
    checked: boolean;
    onChange: (next: boolean) => void;
}) {
    return (<button className={`switch${checked ? " on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span className="knob"></span></button>);
}
function offsetLabel(minutes: number): string {
    if (minutes >= 1440)
        return `${Math.round(minutes / 1440)} 天前`;
    if (minutes >= 60)
        return `${Math.round(minutes / 60)} 小时前`;
    return `${minutes} 分钟前`;
}

/* ------------------------------------------------------------ AI 助手 */
function JarvisSection() {
    const [status, setStatus] = useState<{ configured: boolean; online: boolean; nickname: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const load = () => {
        void getApi().invoke('jarvis:status').then(value => {
            const next = value as { configured?: boolean; online?: boolean; nickname?: string } | null;
            setStatus({ configured: !!next?.configured, online: !!next?.online, nickname: next?.nickname ?? '' });
        }).catch(() => setStatus({ configured: false, online: false, nickname: '' }));
    };
    useEffect(() => {
        load();
        const timer = window.setInterval(load, 10000);
        return () => window.clearInterval(timer);
    }, []);
    const reconnect = async () => {
        if (busy) return;
        setBusy(true);
        setMessage('');
        try {
            const result = await getApi().invoke('jarvis:reconnect') as { ok?: boolean; nickname?: string; reason?: string } | null;
            if (result?.ok) setMessage(`已重连${result.nickname ? `：${result.nickname}` : ''}`);
            else setMessage(result?.reason==='start_failed'?'本机助手未能启动，请检查是否已安装并完成连接配置。':result?.reason==='not_configured'?'尚未配置本机助手。':'重连失败，请确认本机助手已登录后重试。');
        } catch {
            setMessage('重连失败，请稍后重试。');
        } finally {
            setBusy(false);
            load();
        }
    };
    const online = status?.online ?? false;
    return (<section className="panel">
        <div className="panel-head"><span className="t-title">贾维斯 · QQ 机器人</span><span className="t-caption">{status === null ? '检测中…' : !status.configured ? '未配置本机助手' : online ? `在线${status.nickname ? ` · ${status.nickname}` : ''}` : '离线'}</span></div>
        <div className="t-caption">查看本机助手的连接状态。连接中断时可以尝试重连，最多等待一分钟；重连期间仍可使用其他页面。</div>
        <div className="row gap-8" style={{ marginTop: 12 }}>
            <button className="primary-btn" onClick={() => void reconnect()} disabled={busy||!status?.configured}>{busy ? '正在重连…' : '一键重连'}</button>
            <button className="ghost-btn" onClick={load} disabled={busy}>刷新状态</button>
        </div>
        {message && <p className="t-caption" role="status">{message}</p>}
        {(!online && message) && <p className="t-caption">如果仍未连接，请在本机助手的登录窗口确认登录，然后刷新状态。</p>}
    </section>);
}