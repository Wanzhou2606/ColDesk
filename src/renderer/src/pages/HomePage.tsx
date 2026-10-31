import {t,weekdayShort} from '@shared/i18n';
import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { HomeEntry, HomeMonth, HomeStatus, HomeExportScope, HomeExportResult } from '@shared/home';
import { HomePhotos, HomeFiles } from '../components/HomeAttachments';
import { homeMonthDays, shiftHomeMonth, validHomeDate } from '@shared/home';
import { today, weekdayCn } from '@shared/time';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
import {DiaryExpenseButton} from '../components/DiaryExpenseButton';
export interface HomePageHandle {
    beforeLeave: () => Promise<boolean>;
}
const invoke = <T,>(channel: string, payload?: unknown) => getApi().invoke(channel, payload) as Promise<T>;
const entryText = (entry: HomeEntry) => JSON.stringify([entry.date, entry.title, entry.cover, entry.body, entry.weather, entry.mood, entry.attachments]);
const WEATHER = ['☀️ 晴天', '🌤 多云', '☁️ 阴天', '🌧 雨天', '❄️ 雪天', '🍃 有风'];
const MOODS = ['😊 开心', '🌿 平静', '✨ 满足', '😴 疲惫', '🌧 低落', '💭 焦虑'];
export const HomePage = forwardRef<HomePageHandle, {
    mobile?: boolean;
    initialDate?: string;
    onOpenExpense?: (id: string, date: string) => void;
}>(function HomePage({ mobile = false, initialDate, onOpenExpense }, ref) {
    const [status, setStatus] = useState<HomeStatus | null>(null);
    const [month, setMonth] = useState(validHomeDate(initialDate) ? initialDate.slice(0, 7) : today().slice(0, 7));
    const [monthData, setMonthData] = useState<HomeMonth>({ month: '', entries: [] });
    const openedInitialDate = useRef('');
    const [monthLoading, setMonthLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [draft, setDraft] = useState<HomeEntry | null>(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [saveState, setSaveState] = useState('');
    const [error, setError] = useState('');
    const [leaving, setLeaving] = useState(false);
    const [protectionOpen, setProtectionOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [exportScope, setExportScope] = useState<'all' | 'month' | 'day' | 'range'>('month');
    const [rangeStart, setRangeStart] = useState(today().slice(0, 7) + '-01'), [rangeEnd, setRangeEnd] = useState(today());
    const [exportMode, setExportMode] = useState<'diary' | 'overview'>('diary'), [exportFormat, setExportFormat] = useState<'txt' | 'word'>('word');
    const [album, setAlbum] = useState(false), [attachmentBusy, setAttachmentBusy] = useState(false);
    const attachmentBusyRef = useRef(false);
    const [exporting, setExporting] = useState(false);
    const [exportMessage, setExportMessage] = useState('');
    const [exportFolder, setExportFolder] = useState('');
    const [exportError, setExportError] = useState('');
    const exportingRef = useRef(false);
    const draftRef = useRef<HomeEntry | null>(null);
    const persisted = useRef('');
    const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
    const loadingId = useRef(0);
    const mounted = useRef(true);
    const leavingRef = useRef(false);
    const exitPromise = useRef<Promise<boolean> | null>(null);
    const homeContentRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (homeContentRef.current)
            homeContentRef.current.inert = protectionOpen;
    }, [protectionOpen]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadingId.current++; }; }, []);
    const loadStatus = useCallback(async () => {
        setError('');
        try {
            const next = await invoke<HomeStatus>('home:status');
            if (mounted.current)
                setStatus(next);
        }
        catch (err) {
            if (mounted.current)
                setError(userError(err, 'home 暂时无法打开，请重试。'));
        }
    }, []);
    useEffect(() => { void loadStatus(); }, [loadStatus]);
    const loadMonth = useCallback(async () => {
        if (!status?.unlocked)
            return;
        setMonthLoading(true);
        setError('');
        const id = ++loadingId.current;
        try {
            const result = await invoke<HomeMonth>('home:month', { month });
            if (mounted.current && id === loadingId.current)
                setMonthData(result);
        }
        catch (err) {
            if (mounted.current && id === loadingId.current)
                setError(userError(err, '月历暂时无法读取，请重试。'));
        }
        finally {
            if (mounted.current && id === loadingId.current)
                setMonthLoading(false);
        }
    }, [month, status?.unlocked, status?.passwordEnabled]);
    useEffect(() => { void loadMonth(); }, [loadMonth]);
    const saveDraft = useCallback((): Promise<void> => {
        const snapshot = draftRef.current;
        if (!snapshot)
            return writeQueue.current.then(() => undefined);
        const serialized = entryText(snapshot);
        const job = writeQueue.current.catch(() => undefined).then(async () => {
            const changed = persisted.current !== serialized;
            if (changed) {
                if (mounted.current)
                    setSaveState('正在保存…');
                await invoke<HomeEntry>('home:save', snapshot);
                persisted.current = serialized;
            }
            if (mounted.current) {
                const clean = !!draftRef.current && entryText(draftRef.current) === serialized;
                setSaveState(previous => clean ? !changed && previous === '还没有写下这一天' ? previous : '已保存' : '正在记录…');
                setError('');
                await invoke('home:dirty', { dirty: !clean });
            }
        });
        writeQueue.current = job;
        return job;
    }, []);
    useEffect(() => {
        if (!draft)
            return;
        const timer = window.setTimeout(() => {
            void saveDraft().catch(err => {
                if (mounted.current) {
                    setError(userError(err, '暂时未能保存，请重试后再离开。'));
                    setSaveState('尚未保存');
                }
            });
        }, 650);
        return () => window.clearTimeout(timer);
    }, [draft, saveDraft]);
    const beforeLeave = useCallback((): Promise<boolean> => {
        if (exportingRef.current || attachmentBusyRef.current)
            return Promise.resolve(false);
        if (exitPromise.current)
            return exitPromise.current;
        leavingRef.current = true;
        setLeaving(true);
        loadingId.current++;
        setMonthLoading(false);
        setEntryLoading(false);
        const job = (async () => {
            try {
                await saveDraft();
                await invoke('home:lock');
                draftRef.current = null;
                persisted.current = '';
                setDraft(null);
                setSelectedDate(null);
                setMonthData({ month, entries: [] });
                return true;
            }
            catch (err) {
                setError(userError(err, '暂时未能保存，日记已留在当前页面。请重试后再离开。'));
                leavingRef.current = false;
                setLeaving(false);
                return false;
            }
            finally {
                exitPromise.current = null;
            }
        })();
        exitPromise.current = job;
        return job;
    }, [month, saveDraft]);
    useImperativeHandle(ref, () => ({ beforeLeave }), [beforeLeave]);
    const openDay = async (date: string) => {
        if (leavingRef.current || entryLoading || monthLoading)
            return;
        setEntryLoading(true);
        setError('');
        const id = ++loadingId.current;
        try {
            const entry = await invoke<HomeEntry>('home:get', { date });
            if (!mounted.current || id !== loadingId.current)
                return;
            draftRef.current = entry;
            persisted.current = entryText(entry);
            setDraft(entry);
            setSelectedDate(date);
            setSaveState(entry.updatedAt ? '已保存' : '还没有写下这一天');
        }
        catch (err) {
            setError(userError(err, '这一天的日记暂时无法打开，请重试。'));
        }
        finally {
            if (mounted.current && id === loadingId.current)
                setEntryLoading(false);
        }
    };
    useEffect(() => {
        if (validHomeDate(initialDate) && openedInitialDate.current !== initialDate && status?.unlocked && !monthLoading && !entryLoading && monthData.month === month) {
            openedInitialDate.current = initialDate;
            void openDay(initialDate);
        }
    }, [initialDate, status?.unlocked, monthLoading, entryLoading, monthData.month, month]);
    const edit = (patch: Partial<HomeEntry>) => {
        if (!draftRef.current || leavingRef.current)
            return;
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        setDraft(next);
        setSaveState('正在记录…');
        void invoke('home:dirty', { dirty: true });
    };
    const attachmentAction = async (kind: 'photo' | 'file' | 'remove', id?: string) => {
        if (attachmentBusyRef.current || leavingRef.current || !draftRef.current)
            return;
        if (kind === 'remove' && !window.confirm('从这篇日记中移除这个附件？原始文件不会改变。'))
            return;
        attachmentBusyRef.current = true;
        leavingRef.current = true;
        setAttachmentBusy(true);
        setLeaving(true);
        setError('');
        try {
            await saveDraft();
            const next = await invoke<HomeEntry>(kind === 'remove' ? 'home:attachmentRemove' : 'home:attachmentAdd', { date: draftRef.current.date, kind, id });
            draftRef.current = next;
            persisted.current = entryText(next);
            setDraft(next);
            setSaveState('已保存');
        }
        catch (err) {
            setError(userError(err, '附件暂时未能保存，请重试。'));
        }
        finally {
            attachmentBusyRef.current = false;
            leavingRef.current = false;
            setAttachmentBusy(false);
            setLeaving(false);
        }
    };
    const returnToMonth = async () => {
        if (leavingRef.current)
            return;
        leavingRef.current = true;
        setLeaving(true);
        try {
            await saveDraft();
            setSelectedDate(null);
            setDraft(null);
            draftRef.current = null;
            await loadMonth();
        }
        catch (err) {
            setError(userError(err, '暂时未能保存，请重试后再返回月历。'));
        }
        finally {
            leavingRef.current = false;
            setLeaving(false);
        }
    };
    const lock = async () => {
        if (await beforeLeave()) {
            leavingRef.current = false;
            setLeaving(false);
            await loadStatus();
        }
    };
    const exportDiary = async () => {
        if (exportingRef.current || leavingRef.current)
            return;
        exportingRef.current = true;
        leavingRef.current = true;
        setExporting(true);
        setLeaving(true);
        setExportMessage('');
        setExportFolder('');
        setExportError('');
        try {
            await saveDraft();
            const selection: HomeExportScope = exportScope === 'all' ? { scope: 'all' } : exportScope === 'range' ? { scope: 'range', start: rangeStart, end: rangeEnd } : exportScope === 'day' && selectedDate ? { scope: 'day', date: selectedDate } : { scope: 'month', month };
            const result = await invoke<HomeExportResult>('home:export', { ...selection, mode: exportMode, format: exportFormat });
            if (!result.canceled) {
                setExportMessage(`已导出 ${result.count} 篇日记，${result.mode === 'overview' ? '合成一份 Word 总览' : result.format === 'word' ? '每天一份 Word 文档' : '每天一个 TXT 文件'}。`);
                setExportFolder(result.folder ?? '');
            }
        }
        catch (err) {
            setExportError(userError(err, '暂时无法导出日记，请重试。'));
        }
        finally {
            exportingRef.current = false;
            leavingRef.current = false;
            setExporting(false);
            setLeaving(false);
        }
    };
    const entries = useMemo(() => new Map(monthData.month === month ? monthData.entries.map(entry => [entry.date, entry]) : []), [monthData, month]);
    const days = useMemo(() => homeMonthDays(month), [month]);
    const albumPhotos = useMemo(() => [...entries.values()].flatMap(entry => (entry.attachments ?? []).filter(a => a.kind === 'photo').map(a => ({ ...a, date: entry.date, title: entry.title }))), [entries]);
    const [year, monthNumber] = month.split('-').map(Number);
    if (!status)
        return <div className="home-page home-gate"><HomeHeading></HomeHeading><div className="home-gate-card"><p>{error || "\u6B63\u5728\u6253\u5F00\u8FD9\u7247\u7530\u56ED\u2026"}</p>{error && <button className="primary-btn" onClick={() => void loadStatus()}>{"\u91CD\u8BD5"}</button>}</div></div>;
    if (!status.initialized)
        return <div className="home-page home-gate"><HomeHeading></HomeHeading><ProtectionForm initial={true} onComplete={next => { setStatus(next); }}></ProtectionForm></div>;
    if (!status.unlocked)
        return <div className="home-page home-gate"><HomeHeading></HomeHeading><UnlockForm onComplete={next => { setStatus(next); setLeaving(false); }}></UnlockForm></div>;
    return <div className={`home-page${selectedDate ? " home-writing" : ""}`}><div ref={homeContentRef} aria-hidden={protectionOpen || void 0}><header className="home-header"><HomeHeading></HomeHeading><div className="home-tools"><button className="ghost-btn" disabled={leaving} aria-expanded={exportOpen} onClick={() => { setExportOpen(value => !value); setExportMessage(""); setExportFolder(""); }}>{"\u5BFC\u51FA\u65E5\u8BB0"}</button>{selectedDate ? <button className="ghost-btn" disabled={leaving} onClick={() => void returnToMonth()}>{"\u2190 \u4FDD\u5B58\u5E76\u56DE\u5230\u6708\u5386"}</button> : <><button className="ghost-btn" disabled={leaving} onClick={() => setProtectionOpen(true)}>{status.passwordEnabled ? "\u5BC6\u7801\u8BBE\u7F6E" : "\u8BBE\u7F6E\u5BC6\u7801"}</button>{status.passwordEnabled && <button className="ghost-btn" disabled={leaving} onClick={() => void lock()}>{"\u9501\u5B9A"}</button>}</>}</div></header>{exportOpen && <section className="home-export-panel" aria-label="导出日记"><div><h2>{"\u628A\u5FC3\u4E8B\u5E26\u8D70"}</h2><p>{"\u5305\u542B\u5C01\u9762\u3001\u5929\u6C14\u3001\u5FC3\u60C5\u3001\u6B63\u6587\u548C\u7167\u7247\u3002\u6709\u7167\u7247\u65F6\u81EA\u52A8\u5BFC\u51FA Word\uFF0C\u5176\u4ED6\u6587\u4EF6\u653E\u5728\u76F8\u90BB\u9644\u4EF6\u6587\u4EF6\u5939\u3002"}{status.passwordEnabled ? "\u5BFC\u51FA\u5185\u5BB9\u4E0D\u52A0\u5BC6\uFF0C\u8BF7\u59A5\u5584\u4FDD\u7BA1\u3002" : "\u65E5\u8BB0\u539F\u6587\u4ECD\u4F1A\u4FDD\u7559\u5728 home \u4E2D\u3002"}</p></div><div className="home-export-controls"><select className="input" aria-label="日记导出范围" disabled={exporting} value={exportScope === "day" && !selectedDate ? "month" : exportScope} onChange={event => { setExportScope(event.target.value as typeof exportScope); setExportError(""); setExportMessage(""); setExportFolder(""); }}><option value="month">{"\u5F53\u524D\u6708\u4EFD\uFF08"}{month}{"\uFF09"}</option><option value="range">{"\u81EA\u9009\u65E5\u671F\u8303\u56F4"}</option><option value="all">{"\u5168\u90E8\u65E5\u8BB0"}</option>{selectedDate && <option value="day">{"\u8FD9\u4E00\u5929\uFF08"}{selectedDate}{"\uFF09"}</option>}</select>{exportScope === "range" && <div className="home-export-dates"><label>{"\u5F00\u59CB\u65E5\u671F"}<input className="input" type="date" value={rangeStart} disabled={exporting} onChange={e => setRangeStart(e.target.value)}></input></label><span>{"\u81F3"}</span><label>{"\u7ED3\u675F\u65E5\u671F"}<input className="input" type="date" value={rangeEnd} disabled={exporting} onChange={e => setRangeEnd(e.target.value)}></input></label></div>}<select className="input" aria-label="日记导出方式" disabled={exporting} value={exportMode} onChange={e => setExportMode(e.target.value as typeof exportMode)}><option value="diary">{"\u65E5\u8BB0 \u00B7 \u6BCF\u5929\u4E00\u4EFD"}</option><option value="overview">{"\u603B\u89C8 \u00B7 \u5408\u6210\u4E00\u4EFD Word"}</option></select><select className="input" aria-label="日记导出格式" disabled={exporting || exportMode === "overview"} value={exportMode === "overview" ? "word" : exportFormat} onChange={e => setExportFormat(e.target.value as typeof exportFormat)}><option value="word">{"Word\uFF08\u5305\u542B\u7167\u7247\uFF09"}</option><option value="txt">{"TXT\uFF08\u6709\u7167\u7247\u81EA\u52A8\u6539\u4E3A Word\uFF09"}</option></select><button className="primary-btn" disabled={leaving || exportScope === "range" && (!validHomeDate(rangeStart) || !validHomeDate(rangeEnd) || rangeStart > rangeEnd)} onClick={() => void exportDiary()}>{exporting ? "\u6B63\u5728\u5BFC\u51FA\u2026" : mobile ? "\u751F\u6210\u5E76\u9009\u62E9\u4FDD\u5B58\u4F4D\u7F6E" : "\u9009\u62E9\u6587\u4EF6\u5939\u5E76\u5BFC\u51FA"}</button></div>{exportError && <div className="home-error home-export-error" role="alert">{exportError}<button className="ghost-btn" disabled={leaving} onClick={() => void exportDiary()}>{"\u91CD\u8BD5\u5BFC\u51FA"}</button></div>}{exportMessage && <div className="home-export-result" role="status"><strong>{exportMessage}</strong><span>{exportFolder}</span></div>}</section>}{error && <div className="home-error" role="alert">{error}<button className="ghost-btn" onClick={() => selectedDate ? void saveDraft().catch(() => { }) : void loadMonth()}>{"\u91CD\u8BD5"}</button></div>}{selectedDate && draft ? <div className="home-editor"><div className="home-date-heading"><div><h2>{selectedDate.replaceAll("-", " / ")}</h2><span>{weekdayCn(selectedDate)}</span></div><span className="home-save-state" role="status">{saveState}</span></div><section className="home-cover-editor"><label htmlFor="home-cover">{"\u5C01\u9762 "}<span>{"\u5199\u4E00\u53E5\u8BDD\uFF0C\u628A\u8FD9\u4E00\u5929\u7559\u5728\u6708\u5386\u91CC\u3002"}</span></label><textarea id="home-cover" className="home-cover-input" maxLength={160} rows={2} placeholder="今天，想留给自己的一句话……" value={draft.cover} disabled={leaving} onChange={e => edit({ cover: e.target.value })}></textarea><small>{draft.cover.length}{" / 160"}</small></section><div className="home-metadata"><label>{"\u5929\u6C14"}<select value={draft.weather} disabled={leaving} onChange={e => edit({ weather: e.target.value })}><option value="">{"\u9009\u62E9\u5929\u6C14"}</option>{WEATHER.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><label>{"\u5FC3\u60C5"}<select value={draft.mood} disabled={leaving} onChange={e => edit({ mood: e.target.value })}><option value="">{"\u9009\u62E9\u5FC3\u60C5"}</option>{MOODS.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div><label className="home-diary-title">{"\u8FD9\u4E00\u5929\u7684\u5C0F\u6807\u9898"}<input className="input" maxLength={100} placeholder="给这篇日记起个名字，导出时会用作标题" disabled={leaving} value={draft.title ?? ""} onChange={e => edit({ title: e.target.value })}></input></label><section className="home-diary-paper"><label htmlFor="home-body">{"\u8FD9\u4E00\u5929\u7684\u6545\u4E8B"}</label><textarea id="home-body" maxLength={200000} placeholder="慢慢写。发生的事，没说出口的话，都可以留在这里。" value={draft.body} disabled={leaving} onChange={e => edit({ body: e.target.value })}></textarea></section><section className="home-attachments"><div className="row-between"><div><h3>{"\u7167\u7247\u4E0E\u6587\u4EF6"}</h3><p>{"\u7559\u4E0B\u4ECA\u5929\u7684\u753B\u9762\uFF0C\u4E5F\u6536\u597D\u4E0E\u8FD9\u4E00\u5929\u6709\u5173\u7684\u6587\u4EF6\u3002"}</p></div><div className="row"><button className="ghost-btn" disabled={leaving} onClick={() => void attachmentAction("photo")}>{attachmentBusy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\uFF0B \u7167\u7247"}</button><button className="ghost-btn" disabled={leaving} onClick={() => void attachmentAction("file")}>{"\uFF0B \u6587\u4EF6"}</button></div></div><HomePhotos items={(draft.attachments ?? []).filter(a => a.kind === "photo").map(a => ({ ...a, date: draft.date }))} disabled={leaving} onRemove={id => void attachmentAction("remove", id)}></HomePhotos><HomeFiles items={(draft.attachments ?? []).filter(a => a.kind === "file")} date={draft.date} disabled={leaving} onRemove={id => void attachmentAction("remove", id)}></HomeFiles>{!draft.attachments?.length && <div className="home-attachment-empty">{"\u6DFB\u52A0\u7B2C\u4E00\u5F20\u7167\u7247\uFF0C\u8BA9\u65E5\u8BB0\u4E5F\u6210\u4E3A\u4F60\u7684\u76F8\u518C\u3002"}</div>}<small>{mobile ? "\u5355\u4E2A\u4E0D\u8D85\u8FC7 10 MB \u00B7 \u6BCF\u6B21\u6700\u591A 10 \u4E2A \u00B7 \u6BCF\u5929\u6700\u591A 60 \u4E2A" : "\u5355\u4E2A\u4E0D\u8D85\u8FC7 25 MB \u00B7 \u6BCF\u6B21\u6700\u591A 20 \u4E2A \u00B7 \u6BCF\u5929\u6700\u591A 60 \u4E2A"}</small></section>{(!mobile||onOpenExpense)&&<DiaryExpenseButton allowOpenLedger={mobile} date={draft.date} onOpenExpense={onOpenExpense}/>}<footer className="home-editor-foot"><span>{"\u5185\u5BB9\u4F1A\u81EA\u52A8\u4FDD\u5B58\uFF0C\u8FD4\u56DE\u6708\u5386\u524D\u4E5F\u4F1A\u5B8C\u6210\u4FDD\u5B58\u3002"}</span><button className="primary-btn" disabled={leaving} onClick={() => void returnToMonth()}>{"\u4FDD\u5B58\u5E76\u56DE\u5230\u6708\u5386"}</button></footer></div> : <><div className="home-month-toolbar"><div className="home-month-controls"><button title="上个月" disabled={monthLoading} onClick={() => setMonth(shiftHomeMonth(month, -1))}>{"\u2039"}</button><h2>{year}<span>{"\u5E74"}</span>{" "}{monthNumber}<span>{"\u6708"}</span></h2><button title="下个月" disabled={monthLoading} onClick={() => setMonth(shiftHomeMonth(month, 1))}>{"\u203A"}</button></div><div className="home-month-actions"><input aria-label="选择月份" type="month" value={month} onChange={e => {
                if (validHomeDate(e.target.value + "-01"))
                    setMonth(e.target.value);
            }}></input><button className="ghost-btn" onClick={() => setMonth(today().slice(0, 7))}>{"\u672C\u6708"}</button><button className="home-write-today" disabled={entryLoading || monthLoading} onClick={() => {
                const date = today();
                void openDay(date).then(() => {
                    if (draftRef.current?.date === date)
                        setMonth(date.slice(0, 7));
                });
            }}>{"\u5199\u4ECA\u5929"}</button></div></div><div className="home-view-switch"><div className="segmented"><button className={!album ? "active" : ""} aria-pressed={!album} onClick={() => setAlbum(false)}>{"\u6708\u5386"}</button><button className={album ? "active" : ""} aria-pressed={album} onClick={() => setAlbum(true)}>{"\u76F8\u518C "}<small>{albumPhotos.length}</small></button></div><span>{album ? "\u6309\u65E5\u671F\u6536\u85CF\u7684\u753B\u9762" : "\u4E00\u53E5\u5C01\u9762\uFF0C\u8BB0\u4F4F\u4E00\u5929"}</span></div>{album && <section className="home-album" aria-label="本月相册"><HomePhotos items={albumPhotos} onOpenDiary={date => void openDay(date)}></HomePhotos>{!albumPhotos.length && <div className="home-attachment-empty">{"\u8FD9\u4E2A\u6708\u8FD8\u6CA1\u6709\u7167\u7247\u3002\u70B9\u5F00\u4E00\u5929\u7684\u65E5\u8BB0\uFF0C\u6DFB\u52A0\u4F60\u7684\u7B2C\u4E00\u5F20\u7167\u7247\u3002"}</div>}</section>}<div hidden={album}><div className="home-weekdays">{(["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"] as const).map(day => <span key={day}>{weekdayShort(day)}</span>)}</div><div className={`home-month-grid${days.length === 42 ? " six-weeks" : ""}`} style={{ "--home-weeks": days.length / 7 } as (RecoveredStyle | undefined)} aria-busy={monthLoading || entryLoading}>{days.map((date, i) => date ? <button className={`home-day${date === today() ? " is-today" : ""}${entries.has(date) ? " has-entry" : ""}`} aria-label={`${date}${entries.get(date)?.cover ? " \u00B7 " + entries.get(date)!.cover : " \u5199\u65E5\u8BB0"}`} title={entries.get(date)?.cover || "\u5199\u4E0B\u8FD9\u4E00\u5929"} disabled={monthLoading || entryLoading} onClick={() => void openDay(date)} key={date}><span className="home-day-header"><span>{Number(date.slice(8, 10))}</span>{entries.has(date) && <i aria-label="已记录"></i>}</span><span className="home-cover">{entries.get(date)?.cover}</span>{!!entries.get(date)?.attachments?.length && <span className="home-day-media">{entries.get(date)!.attachments!.filter(a => a.kind === "photo").length}{" \u5F20\u7167\u7247 \u00B7 "}{entries.get(date)!.attachments!.filter(a => a.kind === "file").length}{" \u4E2A\u6587\u4EF6"}</span>}<span className="home-day-hint">{entries.has(date) ? "\u6253\u5F00\u65E5\u8BB0" : "\u5199\u4E0B\u8FD9\u4E00\u5929"}</span></button> : <div className="home-empty-day" key={"blank-" + i}></div>)}</div><footer className="home-month-foot"><span>{monthLoading ? "\u6B63\u5728\u8BFB\u53D6\u6708\u5386\u2026" : `\u8FD9\u4E2A\u6708\uFF0C\u7559\u4E0B\u4E86 ${entries.size} \u5929\u7684\u5FC3\u4E8B\u3002`}</span><span>{"\u70B9\u51FB\u4E00\u5929\uFF0C\u7ED9\u5FC3\u60C5\u7559\u4E00\u4E2A\u4F4D\u7F6E\u3002"}</span></footer></div></>}</div>{protectionOpen && <div className="home-protection-backdrop"><div role="dialog" aria-modal="true" aria-label="home 密码设置"><ProtectionForm protectedEnabled={status.passwordEnabled} onCancel={() => setProtectionOpen(false)} onComplete={next => { setStatus(next); setProtectionOpen(false); }}></ProtectionForm></div></div>}</div>;
});
function HomeHeading() { return <div className="home-heading"><div className="home-wordmark">{"home"}<span className="home-leaf" aria-hidden="true">{"\u2767"}</span></div><p>{"\u4E00\u4E2A\u8BB0\u5F55\u81EA\u5DF1\u5FC3\u7075\u7684\u7530\u56ED"}</p></div>; }
function ProtectionForm({ initial = false, protectedEnabled = false, onComplete, onCancel }: {
    initial?: boolean;
    protectedEnabled?: boolean;
    onComplete: (status: HomeStatus) => void;
    onCancel?: () => void;
}) {
    const [mode, setMode] = useState<'none' | 'password'>(protectedEnabled ? 'password' : 'none');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const formRef = useRef<HTMLFormElement | null>(null);
    const cancelRef = useRef(onCancel);
    const busyRef = useRef(busy);
    cancelRef.current = onCancel;
    busyRef.current = busy;
    useEffect(() => {
        if (initial)
            return;
        const old = document.activeElement as HTMLElement | null;
        formRef.current?.querySelector<HTMLElement>('button')?.focus();
        const trap = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busyRef.current) {
                cancelRef.current?.();
                return;
            }
            if (event.key !== 'Tab')
                return;
            const controls = Array.from(formRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
            if (!controls.length)
                return;
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', trap);
        return () => { document.removeEventListener('keydown', trap); window.requestAnimationFrame(() => old?.focus()); };
    }, [initial]);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy)
            return;
        if (!initial && protectedEnabled && mode === 'password' && !password && !confirm) {
            try {
                onComplete(await invoke<HomeStatus>('home:status'));
            }
            catch {
                setError('暂时无法读取设置，请重试。');
            }
            return;
        }
        if (mode === 'password' && (password.length < 6 || password.length > 128 || !password.trim())) {
            setError('请设置 6–128 个字符的密码。');
            return;
        }
        if (mode === 'password' && password !== confirm) {
            setError('两次密码不一致，请检查。');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const next = await invoke<HomeStatus>(initial ? 'home:setup' : 'home:protection', mode === 'password' ? { password } : {});
            setPassword('');
            setConfirm('');
            onComplete(next);
        }
        catch (err) {
            setError(userError(err, '暂时无法保存设置，请重试。'));
        }
        finally {
            setBusy(false);
        }
    };
    return <form ref={formRef} className="home-gate-card" onSubmit={e => void submit(e)}><span className="home-eyebrow">{initial ? "\u7B2C\u4E00\u6B21\u6765\u5230\u8FD9\u91CC" : "\u4FDD\u62A4\u81EA\u5DF1\u7684\u5FC3\u4E8B"}</span><h1>{initial ? "\u7ED9\u5FC3\u7075\u7559\u4E00\u7247\u7530\u56ED" : "home \u5BC6\u7801\u8BBE\u7F6E"}</h1><p>{initial ? "\u8FD9\u91CC\u53EF\u4EE5\u5199\u4E0B\u65E5\u8BB0\u3001\u5929\u6C14\u4E0E\u5FC3\u60C5\u3002\u6708\u5386\u91CC\u7684\u6BCF\u4E00\u53E5\u5C01\u9762\uFF0C\u90FD\u662F\u5C5E\u4E8E\u4F60\u7684\u65E5\u5E38\u3002" : "\u53EF\u4EE5\u8BBE\u7F6E\u6216\u66F4\u6362\u5BC6\u7801\uFF0C\u4E5F\u53EF\u4EE5\u9009\u62E9\u76F4\u63A5\u8FDB\u5165\u3002\u65E5\u8BB0\u4F1A\u4FDD\u7559\u3002"}</p><div className="home-access-options"><button type="button" className={mode === "none" ? "selected" : ""} aria-pressed={mode === "none"} onClick={() => setMode("none")} disabled={busy}><strong>{"\u4E0D\u8BBE\u7F6E\u5BC6\u7801"}</strong><span>{"\u76F4\u63A5\u8FDB\u5165\uFF0C\u8F7B\u8F7B\u677E\u677E\u8BB0\u5F55\u3002"}</span></button><button type="button" className={mode === "password" ? "selected" : ""} aria-pressed={mode === "password"} onClick={() => setMode("password")} disabled={busy}><strong>{"\u8BBE\u7F6E\u5BC6\u7801"}</strong><span>{"\u89E3\u9501\u540E\u624D\u80FD\u770B\u89C1\u8FD9\u7247\u7530\u56ED\u3002"}</span></button></div>{mode === "password" && <div className="home-password-fields"><label>{protectedEnabled ? "\u65B0\u5BC6\u7801\uFF08\u7559\u7A7A\u4FDD\u6301\u73B0\u6709\u5BC6\u7801\uFF09" : "\u5BC6\u7801"}<input type="password" autoComplete="new-password" value={password} maxLength={128} disabled={busy} onChange={e => setPassword(e.target.value)}></input></label><label>{"\u518D\u6B21\u8F93\u5165"}<input type="password" autoComplete="new-password" value={confirm} maxLength={128} disabled={busy} onChange={e => setConfirm(e.target.value)}></input></label><p>{"\u65E5\u8BB0\u6587\u5B57\u3001\u7167\u7247\u4E0E\u6587\u4EF6\u90FD\u4F1A\u52A0\u5BC6\u4FDD\u5B58\u3002\u8BF7\u8BB0\u4F4F\u5BC6\u7801\uFF0C\u5FD8\u8BB0\u540E\u65E0\u6CD5\u6062\u590D\u52A0\u5BC6\u65E5\u8BB0\u3002"}</p>{!initial && <p>{"\u65E0\u5BC6\u7801\u65F6\u751F\u6210\u7684\u65E7\u5907\u4EFD\uFF0C\u53EF\u80FD\u4ECD\u4FDD\u7559\u672A\u52A0\u5BC6\u7684\u5185\u5BB9\u3002"}</p>}</div>}{error && <p className="home-form-error" role="alert">{error}</p>}<div className="home-gate-actions">{onCancel && <button type="button" className="ghost-btn" disabled={busy} onClick={onCancel}>{"\u53D6\u6D88"}</button>}<button className="primary-btn" disabled={busy} type="submit">{busy ? "\u6B63\u5728\u51C6\u5907\u2026" : initial ? "\u8FDB\u5165 home" : "\u4FDD\u5B58\u8BBE\u7F6E"}</button></div></form>;
}
function UnlockForm({ onComplete }: {
    onComplete: (status: HomeStatus) => void;
}) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    return <form className="home-gate-card home-unlock" onSubmit={e => {
            e.preventDefault();
            if (busy)
                return;
            setBusy(true);
            setError("");
            void invoke<HomeStatus>("home:unlock", { password }).then(next => { setPassword(""); onComplete(next); }).catch(err => setError(userError(err, "\u6682\u65F6\u65E0\u6CD5\u89E3\u9501\uFF0C\u8BF7\u91CD\u8BD5\u3002"))).finally(() => setBusy(false));
        }}><span className="home-eyebrow">{"\u5FC3\u4E8B\uFF0C\u7559\u7ED9\u81EA\u5DF1"}</span><h1>{"\u6B22\u8FCE\u56DE\u5230 home"}</h1><p>{"\u8F93\u5165\u5BC6\u7801\uFF0C\u6253\u5F00\u5C5E\u4E8E\u4F60\u7684\u7530\u56ED\u3002"}</p><label>{"\u5BC6\u7801"}<input type="password" autoComplete="current-password" value={password} maxLength={128} disabled={busy} onChange={e => setPassword(e.target.value)} autoFocus={true}></input></label>{error && <p className="home-form-error" role="alert">{error}</p>}<button className="primary-btn" type="submit" disabled={busy}>{busy ? "\u6B63\u5728\u89E3\u9501\u2026" : "\u8FDB\u5165 home"}</button></form>;
}
