import {TaskHoverPreview} from '../components/TaskHoverPreview';
import {GoalsPage} from '../pages/GoalsPage';
import * as React from 'react';
import { AppLogo } from '../components/AppLogo';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TodayView } from '@shared/view';
import { getApi } from '../lib/api';
import { AppIcon } from '../components/AppIcon';
import { OnboardingDialog } from '../components/OnboardingDialog';
import { useGlassAppearance } from '../lib/glassAppearance';
import { useAppState } from '../lib/useAppState';
import { ExpensesPage } from '../pages/ExpensesPage';
import { HabitsPage } from '../pages/HabitsPage';
import { LifePage } from '../pages/LifePage';
import { SchedulePage } from '../pages/SchedulePage';
import { SettingsPage } from '../pages/SettingsPage';
import { StudyPage } from '../pages/StudyPage';
import { HomePage, type HomePageHandle } from '../pages/HomePage';
import { TaskEditDialog } from '../components/TaskEditDialog';
import { findViewTask, type TaskEditField } from '@shared/taskActions';
import { navigationOrder, NAV_LABELS } from '@shared/navigation';
import { TasksPage } from '../pages/TasksPage';
type PageKey = 'home' | 'schedule' | 'study' | 'life' | 'expenses' | 'habits' | 'goals' | 'settings';
export type { PageKey };
/** 主导航：设置不在其中，它放在左下角的椭圆按钮里 */
const NAV: Array<{
    key: PageKey;
    label: string;
    hint: string;
}> = [
    { key: 'home', label: 'home', hint: '记录自己心灵的田园' },
    { key: 'schedule', label: '日程', hint: '日视图 / 周视图' },
    { key: 'study', label: '任务', hint: '所有待办 · 截止时间与紧迫程度' },
    { key: 'expenses', label: '记账', hint: '每日记账 · 周月结算 · 目标预算' },
    { key: 'habits', label: '打卡', hint: '每日打卡 · 完成记录' },
    { key: 'goals', label: '长期', hint: '方向手册 · 分支与日记' }
];
/**
 * 主窗口。
 *
 * `view` 是**仅供测试与预览**的注入点：正常运行时省略，组件自己订阅主进程状态。
 * 之所以需要它：`renderToStaticMarkup` 不执行 effect，
 * 而 useAppState 的数据是在 effect 里拿到的，于是纯 Node 渲染时 state 恒为 null，
 * 没办法断言"记账页到底显示了什么"。注入之后就能用 fixture 直接渲染真实内容。
 */
export function App({ initialPage, view }: {
    initialPage?: PageKey;
    view?: TodayView | null;
} = {}) {
    const liveState = useAppState();
    const state = view !== undefined ? view : liveState;
    const [page, setPage] = useState<PageKey>(initialPage ?? state?.settings.startPage ?? 'schedule');
    const choseInitial = useRef(!!initialPage || !!state);
    useEffect(() => {
        if (state && !choseInitial.current) {
            choseInitial.current = true;
            setPage(state.settings.startPage ?? 'schedule');
        }
    }, [state]);
    const visibleNav = navigationOrder(state?.settings.navigationOrder).map(key => ({ ...NAV.find(item => item.key === key)!, key, label: NAV_LABELS[key] }));
    const [homeDate, setHomeDate] = useState<string>();
    const [expenseRecord, setExpenseRecord] = useState<{
        id: string;
        date: string;
    }>();
    const [settingsSection, setSettingsSection] = useState<'general' | 'timetable'>('general');
    const [quickAddSignal, setQuickAddSignal] = useState(0);
    const [replayIntro, setReplayIntro] = useState(false);
    const [introDismissed, setIntroDismissed] = useState(false);
    const showIntro = !!state && !introDismissed && (replayIntro || state.settings.onboardingVersion < 1);
    const sidebarRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLElement | null>(null);
    const homeRef = useRef<HomePageHandle | null>(null);
    const [homeMenuOpen, setHomeMenuOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<{
        id: string;
        field: TaskEditField;
        date?:string;
    } | null>(null);
    const closeTaskEditor = useCallback(() => setEditingTask(null), []);
    const homeMode = page === 'home';
    const homeToggleRef = useRef<HTMLButtonElement | null>(null);
    const navigateTo = async (next: PageKey): Promise<boolean> => {
        if (next === page) {
            setHomeMenuOpen(false);
            return true;
        }
        if (page === 'home' && homeRef.current && !await homeRef.current.beforeLeave())
            return false;
        setHomeMenuOpen(false);
        setPage(next);
        return true;
    };
    const navigateRef = useRef(navigateTo);
    navigateRef.current = navigateTo;
    useEffect(() => {
        if (sidebarRef.current)
            sidebarRef.current.inert = showIntro || !!editingTask || (homeMode && !homeMenuOpen);
        if (contentRef.current)
            contentRef.current.inert = showIntro || !!editingTask || (homeMode && homeMenuOpen);
    }, [showIntro, homeMode, homeMenuOpen, editingTask]);
    const openTaskEditorRef = useRef((target: {
        taskId?: string;
        field?: TaskEditField;
        date?:string;
        domain?: string;
    }) => { });
    openTaskEditorRef.current = target => {
        if (!target.taskId || !target.field)
            return;
        const next = homeMode ? 'study' : page;
        void navigateRef.current(next).then(ok => {
            if (ok)
                setEditingTask({ id: target.taskId!, field: target.field!,date:target.date });
        });
    };
    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && homeMenuOpen) {
                setHomeMenuOpen(false);
                homeToggleRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [homeMenuOpen]);
    // 主窗口的卡片也是玻璃，必须和悬浮窗用同一套外观变量，
    // 否则在设置里拖透明度只会改变悬浮窗，界面内部却不一致。
    useGlassAppearance(state);
    // 托盘/快捷键要求跳到快速添加
    useEffect(() => {
        const api = getApi();
        const off = api.on('navigate', (payload) => {
            const target = (payload as {
                page?: PageKey;
                action?: string;
                taskId?: string;
                field?: TaskEditField;
                date?:string;
                domain?: string;
            }) ?? {};
            if (target.action === 'edit-task') {
                openTaskEditorRef.current(target);
                return;
            }
            if (target.page && [...NAV.map(item => item.key), 'settings'].includes(target.page)) {
                void navigateRef.current(target.page).then(ok => {
                    if (ok && target.action === 'quick-add')
                        setQuickAddSignal(n => n + 1);
                });
            }
        });
        const offFlush = api.on('home:flush', payload => {
            const request = payload as {
                id: string;
            };
            void (homeRef.current?.beforeLeave() ?? Promise.resolve(true)).then(ok => api.invoke('home:flushResult', { id: request.id, ok }));
        });
        void api.invoke('window:ready').catch((error) => console.error('主窗口准备状态上报失败', error));
        return () => { off(); offFlush(); };
    }, []);
    return (<div className={`app${homeMode ? " is-home" : ""}${homeMenuOpen ? " home-menu-open" : ""}`} data-main-theme={state?.settings.mainTheme ?? "default"} data-home-theme={state?.settings.homeTheme ?? "default"}><aside className="sidebar" id="app-sidebar" ref={sidebarRef} aria-hidden={showIntro || homeMode && !homeMenuOpen || void 0}><div className="brand"><AppLogo className="brand-logo" alt="ColDesk 图标" draggable={false}></AppLogo><div><div className="brand-name">{"ColDesk"}</div><div className="brand-sub">{state?.dateLabel ?? "\u2014"}</div></div></div><nav className="nav">{visibleNav.map(item => <button className={`nav-item${page === item.key || page === "life" && item.key === "study" ? " active" : ""}`} onClick={() => void navigateTo(item.key)} title={item.hint} aria-current={page === item.key ? "page" : void 0} key={item.key}><AppIcon name={item.key}></AppIcon><span className="nav-label">{item.label}</span>{item.key === "study" && (state?.summary.dueTodayCount ?? 0) > 0 && <span className="nav-badge">{state?.summary.dueTodayCount}</span>}</button>)}</nav><div className="sidebar-foot">{!homeMode && <><span className="sidebar-progress-label">{"\u4ECA\u65E5\u8FDB\u5EA6"}</span><ProgressRing state={state}></ProgressRing><div className="t-caption">{state ? `\u5DF2\u7F16\u6392 ${Math.round(state.summary.plannedMinutes / 60)}h` : "\u52A0\u8F7D\u4E2D\u2026"}</div></>}<button className={`settings-pill${page === "settings" ? " active" : ""}`} onClick={() => void navigateTo("settings")} title="提醒 · 课程时间 · 排程偏好 · 数据"><AppIcon name="settings"></AppIcon><span>{"\u8BBE\u7F6E"}</span></button></div></aside><main className="content" ref={contentRef} aria-hidden={showIntro || homeMode && homeMenuOpen || void 0}>{page === "home" && <HomePage ref={homeRef} initialDate={homeDate} onOpenExpense={(id,date)=>{void navigateTo("expenses").then(ok=>{if(ok)setExpenseRecord({id,date});});}}/>}{page === "schedule" && <SchedulePage state={state}></SchedulePage>}{page === "study" && <TasksPage state={state} quickAddSignal={quickAddSignal}/>}{page === "life" && <TasksPage state={state} quickAddSignal={quickAddSignal} initialDomain="life"/>}{page === "expenses" && <ExpensesPage state={state} initialRecord={expenseRecord} onOpenDiary={date=>{setHomeDate(date);void navigateTo("home");}}/>}{page === "goals" && <GoalsPage onOpenDiary={date=>{setHomeDate(date);void navigateTo("home");}}/>}{page === "habits" && <HabitsPage state={state}></HabitsPage>}{page === "settings" && <SettingsPage state={state} initialSection={settingsSection} onReplayIntro={() => { setIntroDismissed(false); setReplayIntro(true); }} onNavigate={next => void navigateTo(next)}></SettingsPage>}</main>{homeMode && <>{homeMenuOpen && <button className="home-nav-scrim" aria-label="关闭导航" onClick={() => setHomeMenuOpen(false)}></button>}<button className={`home-nav-toggle${homeMenuOpen ? " open" : ""}`} ref={homeToggleRef} disabled={showIntro} aria-label={homeMenuOpen ? "\u6536\u8D77\u5BFC\u822A" : "\u6253\u5F00\u5BFC\u822A"} aria-expanded={homeMenuOpen} aria-controls="app-sidebar" onClick={( /* 设置入口：椭圆按钮放在左下角 */) => setHomeMenuOpen(value => !value)}><span></span><span></span><span></span></button></>}{showIntro && state && <OnboardingDialog state={state} replay={replayIntro} onDone={() => { setIntroDismissed(true); setReplayIntro(false); }}></OnboardingDialog>}{!showIntro && state && editingTask && <TaskEditDialog placements={state.taskSegments} defaultDate={editingTask.date??state.date} task={findViewTask(state, editingTask.id)} field={editingTask.field} onClose={closeTaskEditor} key={editingTask.id + editingTask.field}></TaskEditDialog>}<TaskHoverPreview state={state} enabled={!showIntro&&!editingTask}/></div>);
}
function ProgressRing({ state }: {
    state: TodayView | null;
}) {
    const done = state?.summary.doneTodayCount ?? 0;
    const total = done + (state?.summary.dueTodayCount ?? 0);
    if (total === 0)
        return <div className="progress-empty">{"\u4ECA\u5929\u6CA1\u6709\u5230\u671F\u4EFB\u52A1"}</div>;
    const ratio = total === 0 ? 0 : done / total;
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    return (<svg className="ring" viewBox="0 0 56 56" role="img" aria-label={`\u4ECA\u65E5\u5B8C\u6210 ${done}/${total}`}><circle cx="28" cy="28" r={radius} fill="none" stroke="var(--glass-stroke)" strokeWidth="5"></circle><circle cx="28" cy="28" r={radius} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} transform="rotate(-90 28 28)"></circle><text x="28" y="32" textAnchor="middle" className="ring-text">{done}{"/"}{total}</text></svg>);
}
