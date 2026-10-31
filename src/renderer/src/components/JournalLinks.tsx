import * as React from 'react';
import { useEffect, useState } from 'react';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
interface Link {
    diaryDate: string;
    expenseId: string;
    date: string;
    amount: number;
    note: string;
}
export function JournalLinks({ diaryDate, expenseId, expenseDate, onOpenDiary, onOpenExpense }: {
    diaryDate?: string;
    expenseId?: string;
    expenseDate?: string;
    onOpenDiary?: (date: string) => void;
    onOpenExpense?: (id: string, date: string) => void;
}) {
    const [links, setLinks] = useState<Link[]>([]), [choices, setChoices] = useState<Link[]>([]), [date, setDate] = useState(diaryDate ?? expenseDate ?? ''), [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const load = async () => { setLinks(await getApi().invoke('links:list', diaryDate ? { date: diaryDate } : { expenseId }) as Link[]); };
    useEffect(() => { let alive = true; setError(''); void Promise.all([getApi().invoke('links:list', diaryDate ? { date: diaryDate } : { expenseId }), diaryDate ? getApi().invoke('links:expenses', { date: diaryDate }) : Promise.resolve([])]).then(([a, b]) => { if (alive) {
        setLinks(a as Link[]);
        setChoices(b as Link[]);
    } }).catch(e => { if (alive)
        setError(userError(e, '关联暂时无法读取')); }); return () => { alive = false; }; }, [diaryDate, expenseId]);
    const edit = async (remove = false, target?: Link) => { setBusy(true); setError(''); try {
        await getApi().invoke(remove ? 'links:remove' : 'links:add', { date: target?.diaryDate ?? diaryDate ?? date, expenseId: target?.expenseId ?? expenseId ?? selected });
        await load();
    }
    catch (e) {
        setError(userError(e, '关联未保存，请重试'));
    }
    finally {
        setBusy(false);
    } };
    return <section className="journal-links"><h3>{diaryDate ? '关联记账' : '关联日记'}</h3><p className="t-caption">关联会在两边显示；加密日记需解锁后查看。</p>{links.map(link => <div className="row-between" key={link.expenseId + link.diaryDate}><button className="ghost-btn" onClick={() => diaryDate ? onOpenExpense?.(link.expenseId, link.date) : onOpenDiary?.(link.diaryDate)}>{diaryDate ? `${link.date} · ¥${link.amount.toFixed(2)} · ${link.note}` : link.diaryDate}</button><button className="ghost-btn" disabled={busy} onClick={() => void edit(true, link)}>解除关联</button></div>)}<div className="record-link-controls">{diaryDate ? <><select className="input" aria-label="选择记账记录" value={selected} onChange={e => setSelected(e.target.value)}><option value="">选择记账记录</option>{choices.map(item => <option key={item.expenseId} value={item.expenseId}>{item.date} · ¥{item.amount.toFixed(2)} · {item.note}</option>)}</select><button className="ghost-btn" disabled={busy} onClick={() => void getApi().invoke('links:expenses', {}).then(v => setChoices(v as Link[])).catch(e => setError(userError(e, '关联暂时无法读取')))}>其他日期</button></> : <input className="input" type="date" aria-label="关联日记日期" value={date} onChange={e => setDate(e.target.value)}/>}<button className="primary-btn" disabled={busy || (!expenseId && !selected) || (!diaryDate && !date)} onClick={() => void edit()}>添加关联</button></div>{error && <p role="alert" className="t-caption">{error}</p>}</section>;
}
