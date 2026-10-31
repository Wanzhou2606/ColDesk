import {HabitManagement as ManageSection} from '../components/HabitManagement';
import {weekdayShort} from '@shared/i18n';
import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { userError } from '../lib/userError';
import { useRef, useState, type RefObject } from 'react';
import type { HabitView, TodayView } from '@shared/view';
import type { Habit } from '@shared/habit';
import { GRADE_COLORS, GRADE_LABELS, shiftMonth, type DayGrade } from '@shared/habit';
import { getApi } from '../lib/api';
/**
 * 自律打卡页。
 *
 * 左侧放今日打卡与习惯管理，右侧放紧凑月历与每日名言。
 *
 * 分级标色的阈值与颜色全部来自 shared/habit 的 GRADE_COLORS / GRADE_LABELS，
 * 界面不自己定一套——否则"哪天标蓝"会出现两处口径，改一处漏一处。
 */
const WEEK_HEADER = ['一', '二', '三', '四', '五', '六', '日'];
export function HabitsPage({ state }: {
    state: TodayView | null;
}) {
    const habit = state?.habit;
    const newHabitRef = useRef<HTMLInputElement | null>(null);
    if (!habit) {
        return (<div className="page"><header className="page-head"><h1 className="page-title">{"\u81EA\u5F8B\u6253\u5361"}</h1></header><div className="t-caption">{"\u6B63\u5728\u8BFB\u53D6\u2026"}</div></div>);
    }
    return (<div className="page habits-page"><header className="page-head"><div><h1 className="page-title">{"\u81EA\u5F8B\u6253\u5361"}</h1><div className="t-caption">{"\u8FDE\u7EED "}<b>{habit.streak}</b>{" \u5929 \u00B7 \u672C\u6708\u5B8C\u6210\u7387"}{" "}<b>{Math.round(habit.board.monthRatio * 100)}{"%"}</b></div></div><button className="primary-btn lg" onClick={() => { newHabitRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); newHabitRef.current?.focus({ preventScroll: true }); }}>{"\uFF0B \u65B0\u5EFA\u4E60\u60EF"}</button></header><div className="habits-layout"><div className="habits-main"><TodaySection habit={habit}></TodaySection><ManageSection habit={habit} inputRef={newHabitRef}></ManageSection></div><aside className="habits-aside" aria-label="月度打卡记录"><MonthlySection habit={habit}></MonthlySection><QuoteSection habit={habit}></QuoteSection></aside></div></div>);
}
/* ------------------------------------------------------------ 今日打卡 */
function TodaySection({ habit }: {
    habit: HabitView;
}) {
    const cells = habit.today.cells;
    const done = cells.filter((c) => c.done).length;
    const total = cells.length;
    const ratio = total > 0 ? done / total : 0;
    return (<section className="panel habit-today-panel"><div className="panel-head"><span className="t-title">{"\u4ECA\u65E5\u6253\u5361"}</span><span className="t-caption">{total === 0 ? "\u4ECA\u5929\u6CA1\u6709\u9700\u8981\u505A\u7684\u4E60\u60EF" : `${done} / ${total} \u5DF2\u5B8C\u6210`}</span></div>{total > 0 && <><div className="meter thin"><div className="meter-fill" style={{ width: `${Math.round(ratio * 100)}%` } as (RecoveredStyle | undefined)}></div></div><ul className="habit-today-list">{cells.map(({ habit: h, done: isDone }) => <li key={h.id}><button className={`habit-check${isDone ? " done" : ""}`} aria-pressed={isDone} onClick={() => void getApi().invoke("habit:setCheckin", { habitId: h.id, done: !isDone })}><span className="habit-check-box">{isDone ? "\u2713" : ""}</span><span className="habit-check-icon" aria-hidden="true">{h.icon}</span><span className="t-body grow">{h.name}</span><span className="t-caption">{isDone ? "\u5DF2\u5B8C\u6210" : "\u70B9\u51FB\u5B8C\u6210"}</span></button></li>)}</ul></>}{total === 0 && habit.habits.length > 0 && <div className="t-caption">{"\u4ECA\u5929\u6CA1\u6709\u5F85\u6253\u5361\u7684\u4E60\u60EF\uFF0C\u53EF\u4EE5\u5728\u6708\u5386\u4E2D\u56DE\u987E\u5DF2\u6709\u8BB0\u5F55\u3002"}</div>}{habit.habits.length === 0 && <div className="t-caption">{"\u70B9\u51FB\u201C\u65B0\u5EFA\u4E60\u60EF\u201D\uFF0C\u6DFB\u52A0\u7B2C\u4E00\u9879\u6BCF\u5929\u60F3\u575A\u6301\u7684\u4E8B\u3002"}</div>}</section>);
}
/* ------------------------------------------------------------ 月视图 */
function MonthlySection({ habit }: {
    habit: HabitView;
}) {
    const board = habit.board;
    return (<section className="panel habit-calendar-panel"><div className="panel-head"><span className="t-title">{board.label}</span><div className="row"><button className="ghost-btn" title="上个月" onClick={() => void getApi().invoke("habit:setMonth", { month: shiftMonth(habit.month, -1) })}>{"\u2039"}</button><button className="ghost-btn" title="回到本月" onClick={() => void getApi().invoke("habit:setMonth", { month: todayMonth() })}>{"\u672C\u6708"}</button><button className="ghost-btn" title="下个月" onClick={() => void getApi().invoke("habit:setMonth", { month: shiftMonth(habit.month, 1) })}>{"\u203A"}</button></div></div><div className="month-summary"><span>{"\u672C\u6708 "}{board.trackedDays}{" \u5929\u6709\u5B89\u6392 \u00B7 \u5B8C\u6210 "}{board.totals.done}{" / "}{board.totals.expected}{" \u9879"}</span></div><div className="habit-calendar"><div className="habit-week-row">{WEEK_HEADER.map(d => <span className="habit-week-head" key={d}>{weekdayShort(d)}</span>)}</div>{board.weeks.map((week, wi) => <div className="habit-week-row" key={wi}>{week.map(cell => <DayCellView cell={cell} key={cell.date}></DayCellView>)}</div>)}</div><div className="grade-legend">{Object.keys(GRADE_LABELS).map(grade => <span className="grade-legend-item" key={grade}><i className="grade-dot" style={{ background: GRADE_COLORS[grade as DayGrade] } as (RecoveredStyle | undefined)}></i>{GRADE_LABELS[grade as DayGrade]}<b>{board.gradeCounts[grade as DayGrade]}</b></span>)}</div></section>);
}
function DayCellView({ cell }: {
    cell: HabitView['board']['weeks'][number][number];
}) {
    // 分级填充：百分比写在 CSS 变量里，用一个渐变色块表示"完成度"，
    // 颜色由 GRADE_COLORS 决定，高度由 ratio 决定——两者分开，逻辑清晰。
    const fill = Math.round(cell.ratio * 100);
    const color = cell.grade === 'none' ? 'transparent' : GRADE_COLORS[cell.grade];
    const className = [
        'habit-day',
        cell.inMonth ? '' : ' out-month',
        cell.isToday ? ' today' : '',
        cell.isFuture ? ' future' : ''
    ]
        .join(' ')
        .trim();
    return (<span className={className} title={`${cell.date} \xB7 ${cell.done}/${cell.total}`}><i className="habit-day-fill" style={{ height: `${fill}%`, background: color } as (RecoveredStyle | undefined)}></i><em className="habit-day-num">{Number(cell.date.slice(8, 10))}</em></span>);
}
/* ------------------------------------------------------------ 每日名言 */
function QuoteSection({ habit }: {
    habit: HabitView;
}) {
    const quote = habit.quote;
    const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const change = async () => {
        if (busy)
            return;
        setBusy(true);
        setMessage('');
        try {
            await getApi().invoke('habit:quoteRefresh');
        }
        catch (e) {
            setMessage(userError(e, '暂时无法更换名言'));
        }
        finally {
            setBusy(false);
        }
    };
    return (<section className="panel quote-panel"><div className="quote-heading"><span>{"\u7ED9\u4ECA\u5929\u7684\u4E00\u53E5\u8BDD"}</span><span aria-hidden="true">{"\u2767"}</span></div>{quote ? <><blockquote className="quote-text" key={quote.text}>{quote.text}</blockquote><div className="quote-attribution">{"\u2014\u2014 "}{quote.author ? `${quote.author} \xB7 ` : ""}{quote.from || "\u4F5A\u540D"}</div></> : <div className="t-caption">{"\u6B63\u5728\u53D6\u4E00\u53E5\u540D\u8A00\u2026"}</div>}<div className="quote-actions"><button className="ghost-btn" disabled={busy} onClick={() => void change()}>{busy ? "\u6B63\u5728\u66F4\u6362\u2026" : "\u21BB \u6362\u4E00\u53E5"}</button><button className="ghost-btn" disabled={!quote} onClick={() => {
            if (quote)
                void navigator.clipboard.writeText(quote.text + "\n\u2014\u2014 " + [quote.author, quote.from].filter(Boolean).join(" \u00B7 ")).then(() => setMessage("\u5DF2\u590D\u5236")).catch(() => setMessage("\u6682\u65F6\u65E0\u6CD5\u590D\u5236\uFF0C\u8BF7\u91CD\u8BD5"));
        }}>{"\u590D\u5236"}</button></div>{message && <p className="t-caption" role="status">{message}</p>}</section>);
}
/* ------------------------------------------------------------ 习惯管理 */
function todayMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
