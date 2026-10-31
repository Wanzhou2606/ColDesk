import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { HduCalendarPreview } from '@shared/hduCalendar';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
type Preview = HduCalendarPreview & {
    id: string;
    warnings: string[];
};
type Operation = 'clipboard' | 'read' | 'commit' | null;
export function HduCalendarImport({ onViewSchedule }: {
    onViewSchedule?: () => void;
}) {
    const [url, setUrl] = useState('');
    const [preview, setPreview] = useState<Preview | null>(null);
    const [operation, setOperation] = useState<Operation>(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [done, setDone] = useState(false);
    const mounted = useRef(true);
    const pending = useRef(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const busy = operation !== null;
    const step = preview ? 3 : url ? 2 : 1;
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; void getApi().invoke('hdu:clear').catch(() => { }); };
    }, []);
    useEffect(() => {
        if (done && !dialog.current?.open)
            dialog.current?.showModal();
    }, [done]);
    const begin = (next: Exclude<Operation, null>) => {
        if (pending.current)
            return false;
        pending.current = true;
        setOperation(next);
        setError('');
        setMessage('');
        return true;
    };
    const finish = () => {
        pending.current = false;
        if (mounted.current)
            setOperation(null);
    };
    const copy = async () => {
        if (!begin('clipboard'))
            return;
        try {
            const link = await getApi().invoke('hdu:clipboard') as string;
            if (mounted.current) {
                setUrl(link);
                setPreview(null);
            }
        }
        catch (e) {
            if (mounted.current)
                setError(userError(e, '请先在官方页面复制订阅链接'));
        }
        finally {
            finish();
        }
    };
    const read = async () => {
        if (!begin('read'))
            return;
        setPreview(null);
        try {
            const value = await getApi().invoke('hdu:preview', { url }) as Preview;
            if (mounted.current) {
                setPreview(value);
                setUrl('');
            }
        }
        catch (e) {
            if (mounted.current)
                setError(userError(e, '暂时无法读取官方订阅，请检查网络后重试'));
        }
        finally {
            finish();
        }
    };
    const commit = async () => {
        if (!preview || !begin('commit'))
            return;
        try {
            const result = await getApi().invoke('hdu:commit', { id: preview.id }) as {
                count: number;
                sessions: number;
            };
            if (mounted.current) {
                setMessage(`已导入 ${result.count} 门课程，日程已更新。`);
                setPreview(null);
                setDone(true);
            }
        }
        catch (e) {
            if (mounted.current)
                setError(userError(e, '暂时无法导入，请重新预览'));
        }
        finally {
            finish();
        }
    };
    const discard = async () => {
        if (pending.current)
            return;
        setPreview(null);
        setUrl('');
        setError('');
        setMessage('');
        try {
            await getApi().invoke('hdu:clear');
        }
        catch {
            if (mounted.current)
                setError('暂时未能清除预览，请切换页面后重新读取。');
        }
    };
    return <section className="panel hdu-calendar-import" aria-busy={busy}><div className="panel-head"><span className="t-title">{"\u676D\u7535\u8BFE\u8868\u5BFC\u5165"}</span><span className="hdu-import-badge">{"\u5B98\u65B9\u8BA2\u9605"}</span></div><p className="t-caption">{"\u4ECE\u676D\u7535\u52A9\u624B\u8BFB\u53D6\u8BFE\u7A0B\u65E5\u671F\u3001\u4E0A\u8BFE\u65F6\u95F4\u3001\u8001\u5E08\u548C\u6559\u5BA4\uFF0C\u65E0\u9700\u624B\u586B\u8BFE\u7A0B\u3002"}</p><ol className="hdu-import-steps" aria-label="杭电课表导入步骤">{(["\u6253\u5F00\u5B98\u65B9\u8BFE\u8868", "\u590D\u5236\u5E76\u8BFB\u53D6\u8BA2\u9605", "\u6838\u5BF9\u540E\u5BFC\u5165"] as const).map((label, i) => <li className={i + 1 <= step ? "active" : ""} aria-current={i + 1 === step ? "step" : void 0} key={label}><span>{i + 1}</span>{label}</li>)}</ol>{!preview && <><div className="hdu-import-instructions"><strong>{"\u5728\u54EA\u91CC\u627E\u8BA2\u9605\u94FE\u63A5\uFF1F"}</strong><p>{"\u6253\u5F00\u676D\u7535\u52A9\u624B\u5E76\u767B\u5F55\uFF08\u53EF\u9009\u9489\u9489\u767B\u5F55\uFF09\uFF0C\u8FDB\u5165\u8BFE\u8868\uFF0C\u70B9\u53F3\u4E0A\u89D2\u83DC\u5355 \u2192\u300C\u8BA2\u9605\u8BFE\u8868\u300D\u2192 \u590D\u5236\u94FE\u63A5\uFF0C\u518D\u56DE\u5230\u8FD9\u91CC\u7C98\u8D34\u3002"}</p></div><div className="row hdu-import-actions"><button className="ghost-btn" disabled={busy} onClick={() => {
                void getApi().invoke("hdu:open").catch(e => {
                    if (mounted.current)
                        setError(userError(e, "\u65E0\u6CD5\u6253\u5F00\u5B98\u65B9\u8BFE\u8868"));
                });
            }}>{"\u6253\u5F00\u676D\u7535\u52A9\u624B"}</button><button className="ghost-btn" disabled={busy} onClick={() => void copy()}>{operation === "clipboard" ? "\u6B63\u5728\u7C98\u8D34\u2026" : "\u7C98\u8D34\u5DF2\u590D\u5236\u7684\u8BA2\u9605"}</button></div></>}{!preview && <label className="import-input-label">{"\u5B98\u65B9\u8BFE\u8868\u8BA2\u9605\u94FE\u63A5"}<input className="input" type="password" autoComplete="off" spellCheck={false} aria-label="杭电课表订阅链接" placeholder="粘贴官方订阅链接" value={url} disabled={busy} onChange={e => { setUrl(e.target.value); setError(""); setMessage(""); }}></input></label>}{!preview && <p className="t-caption">{"\u94FE\u63A5\u4EC5\u7528\u4E8E\u672C\u6B21\u8BFB\u53D6\uFF0C\u4E0D\u4F1A\u4FDD\u5B58\u5230\u8F6F\u4EF6\u3002\u9884\u89C8\u4E0D\u4F1A\u66F4\u6539\u73B0\u6709\u8BFE\u8868\uFF1B\u8BFE\u7A0B\u53D8\u66F4\u540E\uFF0C\u53EF\u91CD\u65B0\u7C98\u8D34\u8BA2\u9605\u8BFB\u53D6\u66F4\u65B0\u3002"}</p>}{!preview && <button className="primary-btn" disabled={busy || !url.trim()} onClick={() => void read()}>{operation === "read" ? "\u6B63\u5728\u8BFB\u53D6\u5B98\u65B9\u8BFE\u8868\u2026" : "\u8BFB\u53D6\u5E76\u9884\u89C8\u676D\u7535\u8BFE\u8868"}</button>}{preview && <div className="timetable-preview hdu-preview"><h3>{preview.data.courses.length}{" \u95E8\u8BFE\u7A0B \u00B7 "}{preview.occurrenceCount}{" \u6B21\u4E0A\u8BFE\u5B89\u6392"}</h3><p className="t-caption">{"\u4E0A\u8BFE\u65E5\u671F\uFF1A"}{preview.firstDate}{" \u81F3 "}{preview.lastDate}</p>{preview.notes.map(note => <p className="t-caption" key={note}>{note}</p>)}<div className="import-course-list">{preview.data.courses.map((course, i) => <article key={i}><strong>{course.name}{course.teacher ? " \u00B7 " + course.teacher : ""}</strong>{course.sessions.map((session, j) => <span key={j}>{"\u5468"}{"\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u65E5"[session.weekday - 1]}{" \u00B7 "}{session.startTime}{"\u2013"}{session.endTime}{session.room ? " \u00B7 " + session.room : ""}{" \u00B7 "}{session.weeks.length}{" \u6B21"}</span>)}</article>)}</div>{preview.warnings.map(warning => <p className="editor-message error" key={warning}>{warning}</p>)}<p className="hdu-replace-note">{"\u786E\u8BA4\u540E\u4F1A\u66FF\u6362\u5F53\u524D\u8BFE\u7A0B\u8868\u3002\u4EFB\u52A1\u3001\u65E5\u8BB0\u3001\u8BB0\u8D26\u548C\u6253\u5361\u8BB0\u5F55\u4FDD\u7559\u3002\u8BF7\u5148\u6838\u5BF9\u8BFE\u7A0B\u65E5\u671F\u3001\u65F6\u95F4\u548C\u6559\u5BA4\u3002"}</p><div className="row hdu-import-actions"><button className="primary-btn" disabled={busy || !!preview.warnings.length} onClick={() => void commit()}>{operation === "commit" ? "\u6B63\u5728\u5BFC\u5165\u2026" : "\u786E\u8BA4\u4F7F\u7528\u8FD9\u4EFD\u676D\u7535\u8BFE\u8868"}</button><button className="ghost-btn" disabled={busy} onClick={() => void discard()}>{"\u53D6\u6D88\u9884\u89C8"}</button></div></div>}{error && <p className="editor-message error" role="alert">{error}</p>}{message && <div className="hdu-import-success" role="status"><p>{message}</p>{onViewSchedule && <button className="ghost-btn" onClick={onViewSchedule}>{"\u67E5\u770B\u65E5\u7A0B"}</button>}</div>}<dialog ref={dialog} className="import-result-dialog" aria-labelledby="hdu-import-result" onClose={() => setDone(false)}><span className="import-result-icon" aria-hidden="true">{"\u2713"}</span><h2 id="hdu-import-result">{"\u676D\u7535\u8BFE\u8868\u5DF2\u5BFC\u5165"}</h2><strong>{"\u7ED3\u679C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u8BF7\u4ED4\u7EC6\u6838\u5BF9"}</strong><p>{"\u8BF7\u5BF9\u7167\u5B98\u65B9\u8BFE\u8868\u6838\u5BF9\u8BFE\u7A0B\u65E5\u671F\u3001\u4E0A\u8BFE\u65F6\u95F4\u548C\u6559\u5BA4\u3002\u8BFE\u7A0B\u6309\u5B9E\u9645\u65F6\u523B\u5BFC\u5165\uFF0C\u4E0D\u53D7\u624B\u52A8\u8282\u6B21\u65F6\u95F4\u7684\u5F71\u54CD\u3002"}</p><button className="primary-btn" autoFocus={true} onClick={() => dialog.current?.close()}>{"\u6211\u4F1A\u4ED4\u7EC6\u6838\u5BF9"}</button>{onViewSchedule && <button className="ghost-btn hdu-view-schedule" onClick={() => { dialog.current?.close(); onViewSchedule(); }}>{"\u524D\u5F80\u65E5\u7A0B\u6838\u5BF9"}</button>}</dialog></section>;
}
