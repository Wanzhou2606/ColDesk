import type {ExpenseEntry} from '@shared/expense';
import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { userError } from '../lib/userError';
import { useEffect, useState } from 'react';
import { JournalLinks } from '../components/JournalLinks';
import type { CategoryBreakdown, DailyPoint } from '@shared/expense';
import { fmtAmount } from '@shared/expense';
import type { ExpenseView, TodayView } from '@shared/view';
import { getApi } from '../lib/api';
/**
 * 记账页。
 *
 * 结构上刻意分成三块，对应三种不同的看账需求：
 *   ① 顶部结算卡 —— "这个区间我到底超没超？"（一眼回答）
 *   ② 柱状图 + 分类明细 —— "钱花到哪去了？"
 *   ③ 快速记账 + 流水列表 —— "刚花了一笔 / 记错了要改"
 *
 * 所有金额计算都在主进程侧的 shared/expense.ts 完成，这里只负责展示，
 * 避免"界面上再算一遍"导致两处口径不一致。
 */
export function ExpensesPage({ state, initialRecord, onOpenDiary }: {
    state: TodayView | null;
    initialRecord?: {
        id: string;
        date: string;
    };
    onOpenDiary?: (date: string) => void;
}) {
    const [focusedEntry,setFocusedEntry]=useState<ExpenseEntry|null>(null);
    useEffect(()=>{let active=true;if(initialRecord)void getApi().invoke('links:expenses',{expenseId:initialRecord.id}).then(rows=>{if(active)setFocusedEntry((rows as ExpenseEntry[])[0]??null)}).catch(()=>{if(active)setFocusedEntry(null)});else setFocusedEntry(null);return()=>{active=false}},[initialRecord,state?.expense.entries]);
    const [linkedEntry, setLinkedEntry] = useState<{
        id: string;
        date: string;
    } | null>(null);
    useEffect(() => {
        if (initialRecord)
            void getApi().invoke('expense:setView', { mode: 'day', anchorDate: initialRecord.date });
    }, [initialRecord]);
    useEffect(() => {
        if (initialRecord) {
            const row = document.querySelector(`[data-expense-id="${CSS.escape(initialRecord.id)}"]`);
            row?.scrollIntoView({ block: 'center' });
        }
    }, [initialRecord, state?.expense.entries,focusedEntry]);
    const expense = state?.expense;
    const [draft, setDraft] = useState<{
        categoryId: string;
        amount: string;
        note: string;
    }>({
        categoryId: '',
        amount: '',
        note: ''
    });
    const [message, setMessage] = useState<{
        kind: 'ok' | 'error';
        text: string;
    } | null>(null);
    if (!expense) {
        return (<div className="page"><header className="page-head"><h1 className="page-title">{"\u8BB0\u8D26"}</h1></header><div className="t-caption">{"\u6B63\u5728\u8BFB\u53D6\u2026"}</div></div>);
    }
    const { summary } = expense;
    const activeCategoryId = draft.categoryId || expense.categories[0]?.id || '';
    const submit = async () => {
        const amount = Number(draft.amount);
        if (!activeCategoryId) {
            setMessage({ kind: 'error', text: '请先添加一个分类' });
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            setMessage({ kind: 'error', text: '金额要大于 0' });
            return;
        }
        try {
            await getApi().invoke('expense:add', {
                categoryId: activeCategoryId,
                amount,
                note: draft.note
            });
            setDraft({ categoryId: activeCategoryId, amount: '', note: '' });
            setMessage({ kind: 'ok', text: `已记一笔 ${fmtAmount(amount)} 元` });
        }
        catch (error) {
            setMessage({ kind: 'error', text: userError(error, '记账失败') });
        }
    };
    return (<div className="page"><header className="page-head"><div><h1 className="page-title">{"\u8BB0\u8D26"}</h1><div className="t-caption">{"\u53EA\u8BB0\u652F\u51FA \u00B7 \u6570\u636E\u4FDD\u5B58\u5728\u672C\u673A"}</div></div><div className="row"><div className="segmented">{([{ key: "day", label: "\u65E5" }, { key: "week", label: "\u5468" }, { key: "month", label: "\u6708" }] as const).map(item => <button className={`segmented-item${expense.mode === item.key ? " active" : ""}`} onClick={() => void getApi().invoke("expense:setView", { mode: item.key })} key={item.key}>{item.label}</button>)}</div></div></header><section className={`panel settlement${summary.over ? " over" : ""}`}><div className="row-between"><button className="ghost-btn" title="上一个区间" onClick={() => void getApi().invoke("expense:setView", { shift: -1 })}>{"\u2039"}</button><div className="settlement-title"><div className="t-title">{summary.label}</div><div className="t-caption">{"\u5171 "}{summary.days}{" \u5929 \u00B7 \u65E5\u5747 "}{fmtAmount(summary.dailyAverage)}{" \u5143"}</div></div><button className="ghost-btn" title="下一个区间" onClick={() => void getApi().invoke("expense:setView", { shift: 1 })}>{"\u203A"}</button></div><div className="settlement-main"><div className="settlement-figure"><div className="t-caption">{"\u672C\u671F\u82B1\u9500"}</div><div className="settlement-amount">{"\u00A5"}{fmtAmount(summary.spent)}</div></div><div className="settlement-figure"><div className="t-caption">{summary.budget > 0 ? summary.remaining >= 0 ? "\u7ED3\u4F59" : "\u8D85\u652F" : "\u4F59\u989D"}</div><div className={`settlement-amount${summary.budget > 0 ? summary.remaining < 0 ? " danger" : " good" : " muted"}`}>{summary.budget > 0 ? `\xA5${fmtAmount(Math.abs(summary.remaining))}` : "\u672A\u8BBE\u7F6E\u9884\u7B97"}</div></div><div className="settlement-figure"><div className="t-caption">{"\u9884\u7B97"}</div><div className="settlement-amount muted">{summary.budget > 0 ? `\xA5${fmtAmount(summary.budget)}` : "\u2014"}</div></div></div><div className="t-caption">{"\u9884\u7B97\u53E3\u5F84\uFF1A"}{summary.budgetSourceLabel}{summary.daysLeftEstimate !== null && summary.remaining > 0 && <>{" \u00B7 \u6309\u5F53\u524D\u65E5\u5747\uFF0C\u4F59\u989D\u5927\u7EA6\u8FD8\u80FD\u6491 "}{summary.daysLeftEstimate}{" \u5929"}</>}</div>{summary.budget > 0 && <><div className="meter"><div className={`meter-fill${summary.over ? " over" : ""}`} style={{ width: `${Math.min(100, Math.round(summary.ratio * 100))}%` } as (RecoveredStyle | undefined)}></div></div><div className="t-caption">{"\u5DF2\u7528\u6389\u9884\u7B97\u7684 "}{Math.round(summary.ratio * 100)}{"%"}{summary.over ? " \u00B7 \u5DF2\u8D85\u51FA\uFF0C\u63A5\u4E0B\u6765\u6536\u7D27\u4E00\u70B9" : " \u00B7 \u8FD8\u5728\u9884\u7B97\u5185"}</div></>}<div className="settlement-today">{"\u4ECA\u5929\u82B1\u4E86 "}<b>{"\u00A5"}{fmtAmount(summary.todaySpent)}</b>{summary.todayBudget > 0 && <>{" "}{"/ \u9884\u7B97 \u00A5"}{fmtAmount(summary.todayBudget)}{summary.todayOver ? <span className="pill pill-danger">{"\u4ECA\u65E5\u8D85\u652F"}</span> : <span className="pill pill-accent">{"\u4ECA\u65E5\u7ED3\u4F59 \u00A5"}{fmtAmount(summary.todayBudget - summary.todaySpent)}</span>}</>}</div></section><section className="panel"><div className="panel-head"><span className="t-title">{expense.mode === "day" ? "\u4ECA\u65E5\u5404\u5206\u7C7B" : "\u6BCF\u65E5\u82B1\u9500"}</span><span className="t-caption">{expense.mode === "day" ? "\u53C2\u8003\u7EBF\u4E3A\u8BE5\u5206\u7C7B\u6BCF\u65E5\u76EE\u6807" : "\u53C2\u8003\u7EBF\u4E3A\u6BCF\u65E5\u603B\u9884\u7B97"}</span></div><BarChart points={summary.series} mode={expense.mode}></BarChart></section><section className="panel"><div className="panel-head"><span className="t-title">{"\u5206\u7C7B\u660E\u7EC6"}</span><span className="t-caption">{summary.overCategories.length > 0 ? `${summary.overCategories.length} \u9879\u8D85\u51FA\u76EE\u6807` : "\u5404\u9879\u76EE\u6807\u90FD\u5728\u8303\u56F4\u5185"}</span></div><ul className="category-list">{summary.byCategory.map(item => <CategoryRow item={item} key={item.categoryId}></CategoryRow>)}</ul></section><section className="panel"><div className="panel-head"><span className="t-title">{"\u8BB0\u4E00\u7B14"}</span><span className="t-caption">{"\u6309\u56DE\u8F66\u5373\u53EF\u63D0\u4EA4"}</span></div>{message && <div className={`editor-message ${message.kind}`}>{message.text}</div>}<div className="entry-form"><div className="entry-categories">{expense.categories.map(category => <button className={`category-chip${activeCategoryId === category.id ? " active" : ""}`} style={activeCategoryId === category.id ? { background: category.color } : void 0 as (RecoveredStyle | undefined)} onClick={() => setDraft(d => ({ ...d, categoryId: category.id }))} key={category.id}><span aria-hidden="true">{category.icon}</span><span>{category.name}</span></button>)}</div><div className="row entry-input-row"><input className="input" style={{ maxWidth: 140 } as (RecoveredStyle | undefined)} inputMode="decimal" placeholder="金额" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} onKeyDown={e => {
            if (e.key === "Enter")
                void submit();
        }}></input><input className="input grow" placeholder="备注（可选）" value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} onKeyDown={e => {
            if (e.key === "Enter")
                void submit();
        }}></input><button className="primary-btn" onClick={() => void submit()}>{"\u8BB0\u4E0B"}</button></div></div></section><section className="panel"><div className="panel-head"><span className="t-title">{"\u6700\u8FD1\u6D41\u6C34"}</span><div className="row"><span className="t-caption">{"\u5171 "}{expense.entries.length}{" \u7B14"}</span>{expense.isSampleData && <button className="ghost-btn danger-text" title="删掉这 15 笔示例记录（不会删除分类与预算设置）" onClick={() => { void getApi().invoke("expense:clearSample").then(() => setMessage({ kind: "ok", text: "\u793A\u4F8B\u8BB0\u5F55\u5DF2\u6E05\u7A7A\uFF0C\u5206\u7C7B\u4E0E\u9884\u7B97\u90FD\u4FDD\u7559\u7740" })).catch(e => setMessage({ kind: "error", text: userError(e, "\u6E05\u7A7A\u5931\u8D25") })); }}>{"\u6E05\u7A7A\u793A\u4F8B\u6570\u636E"}</button>}</div></div>{expense.entries.length === 0 ? <div className="t-caption">{"\u8FD8\u6CA1\u6709\u8BB0\u5F55\uFF0C\u4E0A\u9762\u8BB0\u4E00\u7B14\u8BD5\u8BD5\u3002"}</div> : <ul className="entry-list">{[...(focusedEntry?[focusedEntry]:[]),...expense.entries.filter(item=>item.id!==focusedEntry?.id)].slice(0,40).map(item => { const category = expense.categories.find(c => c.id === item.categoryId); return <li className={`entry-row${initialRecord?.id===item.id?" linked-record-focus":""}`} data-expense-id={item.id} key={item.id}><span className="entry-date">{item.date.slice(5)}</span><span className="entry-cat" style={{ color: category?.color } as (RecoveredStyle | undefined)}>{category?.icon ?? "\uD83D\uDCE6"}{" "}{category?.name ?? "\u672A\u77E5\u5206\u7C7B"}</span><span className="t-caption grow truncate">{item.note}</span><button className="ghost-btn" onClick={()=>setLinkedEntry(linkedEntry?.id===item.id?null:{id:item.id,date:item.date})}>关联日记</button><span className="entry-amount">{"-\u00A5"}{fmtAmount(item.amount)}</span><button className="icon-btn" title="删除这一笔" onClick={() => void getApi().invoke("expense:remove", { id: item.id })}>{"\u2715"}</button></li>; })}</ul>}</section>{linkedEntry&&<section className="panel"><button className="ghost-btn" onClick={()=>setLinkedEntry(null)}>收起</button><JournalLinks key={linkedEntry.id} expenseId={linkedEntry.id} expenseDate={linkedEntry.date} onOpenDiary={onOpenDiary}/></section>}<OpeningBalanceEditor expense={expense}></OpeningBalanceEditor><BudgetEditor expense={expense}></BudgetEditor></div>);
}
/* ------------------------------------------------------------ 期初余额 */
/**
 * 每月期初余额：用户月初填一次"这个月总共能花多少"。
 *
 * 为什么单独做一个区块、并且放在分类预算上面：
 * 它才是"月预算"的真正来源。用户填了之后，结算卡的预算就直接用这个数，
 * 而不是"每天 70 × 30 天"——后者只是没填时的兜底。
 *
 * 交互上给了"填 / 改 / 清除"三种状态：
 * 清除之后退回按天折算，不是变成没有预算（否则用户会以为坏了）。
 */
function OpeningBalanceEditor({ expense }: {
    expense: ExpenseView;
}) {
    const month = expense.anchorDate.slice(0, 7);
    const saved = expense.monthBudget?.openingBalance;
    const [draft, setDraft] = useState(saved === undefined ? '' : String(saved));
    const [note, setNote] = useState(expense.monthBudget?.note ?? '');
    const [message, setMessage] = useState<string | null>(null);
    const invoke = (channel: string, payload: unknown, okText: string) => {
        setMessage(null);
        void getApi()
            .invoke(channel, payload)
            .then(() => setMessage(okText))
            .catch((e: unknown) => setMessage(userError(e, '操作失败')));
    };
    const monthLabel = `${Number(month.slice(5, 7))} 月`;
    return (<section className="panel"><div className="panel-head"><span className="t-title">{monthLabel}{"\u671F\u521D\u4F59\u989D"}</span><span className="t-caption">{saved === void 0 ? "\u8FD8\u6CA1\u586B\uFF0C\u5F53\u524D\u6309\u6708\u6298\u7B97" : `\u5DF2\u586B \xA5${fmtAmount(saved)}`}</span></div><div className="t-caption">{"\u6BCF\u6708\u521D\u586B\u4E00\u6B21\u8FD9\u4E2A\u6708\u53EF\u52A8\u7528\u7684\u94B1\uFF08\u6BD4\u5982\u751F\u6D3B\u8D39\uFF09\u3002\u586B\u4E86\u4E4B\u540E\uFF0C\u672C\u6708\u7684\"\u9884\u7B97\"\u5C31\u7528\u8FD9\u4E2A\u6570\uFF0C \u6BD4\"\u6BCF\u5929\u591A\u5C11\u94B1\"\u66F4\u8D34\u8FD1\u5B9E\u9645\uFF1B\u6CA1\u586B\u65F6\u9000\u56DE\u6309\u6BCF\u65E5\u603B\u9884\u7B97\u6298\u7B97\u3002"}</div>{message && <div className="editor-message ok">{message}</div>}<div className="row budget-total-row"><span className="t-body">{"\u672C\u6708\u53EF\u7528"}</span><input className="input narrow" inputMode="decimal" placeholder="例如 2000" value={draft} onChange={e => setDraft(e.target.value)}></input><span className="t-caption">{"\u5143"}</span><input className="input narrow" placeholder="备注（可选）" value={note} onChange={e => setNote(e.target.value)}></input><button className="primary-btn" onClick={() => {
            const amount = Number(draft);
            if (!Number.isFinite(amount) || amount < 0) {
                setMessage("\u8BF7\u586B\u4E00\u4E2A\u4E0D\u5C0F\u4E8E 0 \u7684\u91D1\u989D");
                return;
            }
            invoke("expense:setMonthBudget", { month, amount, note }, `\u5DF2\u8BBE\u7F6E ${monthLabel}\u671F\u521D\u4F59\u989D`);
        }}>{"\u4FDD\u5B58"}</button>{saved !== void 0 && <button className="ghost-btn" title="清除后本月退回按每日总预算折算" onClick={() => { setDraft(""); setNote(""); invoke("expense:clearMonthBudget", { month }, "\u5DF2\u6E05\u9664\uFF0C\u672C\u6708\u6539\u4E3A\u6309\u6BCF\u65E5\u603B\u9884\u7B97\u6298\u7B97"); }}>{"\u6E05\u9664"}</button>}</div></section>);
}
/* ------------------------------------------------------------ 柱状图 */
/**
 * 纯 CSS 柱状图。
 *
 * 不引入图表库的理由：这里只需要"一排柱子 + 一条参考线"，
 * 库的体积（几百 KB）和它带来的升级负担远超收益。
 * 柱子高度用百分比，参考线用绝对定位的一条横线，
 * 于是"哪根柱超过了线"是一眼可读的，不需要额外图例。
 */
export function BarChart({ points, mode }: {
    points: DailyPoint[];
    mode: 'day' | 'week' | 'month';
}) {
    if (points.length === 0)
        return <div className="t-caption">{"\u8FD9\u4E2A\u533A\u95F4\u8FD8\u6CA1\u6709\u8BB0\u5F55\u3002"}</div>;
    // 纵轴上限：取"最高柱"与"参考线"的较大者，再留 15% 余量，
    // 否则超标那根柱会顶到边框、看不出超了多少
    const maxValue = Math.max(...points.map((p) => Math.max(p.total, p.budget)), 1 // 全为 0 时避免除以 0
    );
    const ceiling = maxValue * 1.15;
    return (<div className={`bar-chart mode-${mode}`}><div className="bar-track">{points.map(point => { const height = Math.min(100, point.total / ceiling * 100); const budgetLine = point.budget > 0 ? point.budget / ceiling * 100 : 0; return <div className={`bar-slot${point.future ? " future" : ""}`} title={`${point.weekday}\uFF1A\xA5${fmtAmount(point.total)}${point.budget > 0 ? ` / \u76EE\u6807 \xA5${fmtAmount(point.budget)}` : ""}`} key={`${point.date}-${point.weekday}`}>{budgetLine > 0 && <div className="bar-goal" style={{ bottom: `${budgetLine}%` } as (RecoveredStyle | undefined)}></div>}<div className={`bar-fill${point.over ? " over" : ""}${point.total === 0 ? " empty" : ""}`} style={{ height: `${Math.max(height, point.total > 0 ? 2 : 0)}%` } as (RecoveredStyle | undefined)}></div>{point.total > 0 && <div className="bar-value">{fmtAmount(point.total)}</div>}</div>; })}</div><div className="bar-labels">{points.map(point => <div className="bar-label" key={`${point.date}-${point.weekday}-label`}>{mode === "day" ? point.weekday : point.date.slice(8)}</div>)}</div></div>);
}
/* ------------------------------------------------------------ 分类行 */
function CategoryRow({ item }: {
    item: CategoryBreakdown;
}) {
    const width = item.budget > 0 ? Math.min(100, Math.round(item.ratio * 100)) : item.total > 0 ? 100 : 0;
    return (<li className="category-row"><span className="category-icon" aria-hidden="true">{item.icon}</span><div className="category-main"><div className="row-between"><span className="t-body">{item.name}</span><span className="t-caption">{"\u00A5"}{fmtAmount(item.total)}{item.budget > 0 && ` / \xA5${fmtAmount(item.budget)}`}</span></div><div className="meter thin"><div className={`meter-fill${item.over ? " over" : ""}`} style={{ width: `${width}%`, background: item.over ? void 0 : item.color } as (RecoveredStyle | undefined)}></div></div></div><span className={`category-remain${item.over ? " danger" : ""}`}>{item.budget > 0 ? item.over ? `\u8D85 \xA5${fmtAmount(-item.remaining)}` : `\u4F59 \xA5${fmtAmount(item.remaining)}` : "\u2014"}</span></li>);
}
/* ------------------------------------------------------------ 预算编辑 */
/**
 * 预算设置。
 *
 * 分类名 / 图标 / 每日目标、以及每日总预算都放在这里，
 * 而不是塞进"设置"页——记账的参数和记账的操作放在一起，
 * 用户调完能立刻看到本页的结算结果变化，形成闭环。
 */
function BudgetEditor({ expense }: {
    expense: ExpenseView;
}) {
    const [total, setTotal] = useState(String(expense.totalDailyBudget));
    const [editing, setEditing] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');
    const [draftTarget, setDraftTarget] = useState('');
    const [newName, setNewName] = useState('');
    const [newTarget, setNewTarget] = useState('');
    const [error, setError] = useState<string | null>(null);
    const invoke = (channel: string, payload: unknown) => {
        setError(null);
        void getApi()
            .invoke(channel, payload)
            .catch((e: unknown) => setError(userError(e, '操作失败')));
    };
    return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u76EE\u6807\u9884\u7B97"}</span><span className="t-caption">{"\u6BCF\u65E5\u76EE\u6807 \u00B7 \u5468\u6708\u9884\u7B97\u662F\u6309\u5929\u6570\u81EA\u52A8\u6298\u7B97\u7684"}</span></div>{error && <div className="editor-message error">{error}</div>}<div className="row budget-total-row"><span className="t-body grow">{"\u6BCF\u65E5\u603B\u9884\u7B97"}</span><input className="input narrow" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)}></input><span className="t-caption">{"\u5143"}</span><button className="ghost-btn" onClick={() => invoke("expense:setBudget", { amount: Number(total) })}>{"\u4FDD\u5B58"}</button></div><ul className="budget-list">{expense.categories.map(category => <li className="budget-row" key={category.id}>{editing === category.id ? <><input className="input narrow" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="分类名"></input><input className="input narrow" inputMode="decimal" value={draftTarget} onChange={e => setDraftTarget(e.target.value)} placeholder="每日目标"></input><button className="primary-btn" onClick={() => { invoke("expense:saveCategory", { id: category.id, name: draftName, dailyTarget: Number(draftTarget) }); setEditing(null); }}>{"\u4FDD\u5B58"}</button><button className="ghost-btn" onClick={() => setEditing(null)}>{"\u53D6\u6D88"}</button></> : <><span aria-hidden="true">{category.icon}</span><span className="grow t-body">{category.name}</span><span className="t-caption">{"\u00A5"}{fmtAmount(category.dailyTarget)}{" / \u5929"}</span><button className="ghost-btn" onClick={() => { setEditing(category.id); setDraftName(category.name); setDraftTarget(String(category.dailyTarget)); }}>{"\u6539"}</button><button className="icon-btn" title="删除分类（下面还有记录时不允许删）" onClick={() => invoke("expense:removeCategory", { id: category.id })}>{"\u2715"}</button></>}</li>)}</ul><div className="row budget-total-row"><input className="input narrow" placeholder="新分类名" value={newName} onChange={e => setNewName(e.target.value)}></input><input className="input narrow" inputMode="decimal" placeholder="每日目标" value={newTarget} onChange={e => setNewTarget(e.target.value)}></input><button className="ghost-btn" onClick={() => {
            if (!newName.trim()) {
                setError("\u5206\u7C7B\u540D\u4E0D\u80FD\u4E3A\u7A7A");
                return;
            }
            invoke("expense:saveCategory", { name: newName, dailyTarget: Number(newTarget) || 0 });
            setNewName("");
            setNewTarget("");
        }}>{"\uFF0B \u52A0\u5206\u7C7B"}</button></div><div className="t-caption">{"\u5404\u7C7B\u76EE\u6807\u4E4B\u548C\u4E3A "}{fmtAmount(expense.categories.reduce((s, c) => s + c.dailyTarget, 0))}{" \u5143/\u5929\u3002 \u603B\u9884\u7B97\u5EFA\u8BAE\u7565\u9AD8\u4E8E\u5404\u9879\u4E4B\u548C\uFF0C\u8FD9\u6837\"\u603B\u9884\u7B97\"\u624D\u80FD\u8D77\u5230\u6574\u4F53\u9884\u8B66\u4F5C\u7528\u3002"}</div></section>);
}
