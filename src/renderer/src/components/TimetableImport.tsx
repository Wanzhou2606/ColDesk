import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
import { TIMETABLE_PROMPT, type TimetableImport as ImportData } from '@shared/timetableImport';
export function TimetableImport() {
    const [result, setResult] = useState<{
        count: number;
        sessions: number;
    } | null>(null);
    const [text, setText] = useState(''), [preview, setPreview] = useState<{
        data: ImportData;
        warnings: string[];
    } | null>(null), [mode, setMode] = useState<'replace' | 'append'>('replace'), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [promptOpen, setPromptOpen] = useState(false);
    const check = async () => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            setPreview(await getApi().invoke('timetable:preview', { text }) as typeof preview);
        }
        catch (e) {
            setError(userError(e, '无法识别课表，请检查内容'));
            setPreview(null);
        }
        finally {
            setBusy(false);
        }
    };
    const save = async () => {
        if (!preview || busy)
            return;
        setBusy(true);
        setError('');
        try {
            const imported = await getApi().invoke('timetable:import', { text, mode }) as {
                count: number;
                sessions: number;
            };
            setMessage(`已导入 ${imported.count} 门课程、${imported.sessions} 个上课安排，日程已更新。`);
            setResult(imported);
            setPreview(null);
        }
        catch (e) {
            setError(userError(e, '导入未完成，请重试'));
        }
        finally {
            setBusy(false);
        }
    };
    return <section className="panel timetable-import"><div className="panel-head"><span className="t-title">{"\u5BFC\u5165\u6211\u7684\u8BFE\u8868"}</span><span className="t-caption">{"\u56FE\u7247 \u2192 AI \u8BC6\u522B \u2192 \u6821\u9A8C\u5BFC\u5165"}</span></div><p className="t-caption">{"\u628A\u8BFE\u8868\u56FE\u7247\u548C\u4E0B\u9762\u7684\u63D0\u793A\u8BCD\u53D1\u7ED9\u4F60\u5E38\u7528\u7684 AI\uFF0C\u518D\u7C98\u8D34\u5B83\u8F93\u51FA\u7684\u5185\u5BB9\u3002\u683C\u5F0F\u5927\u81F4\u76F8\u540C\u5373\u53EF\uFF0C\u5E38\u89C1\u7684\u661F\u671F\u3001\u6570\u5B57\u548C\u5468\u6B21\u5199\u6CD5\u4F1A\u81EA\u52A8\u6574\u7406\u3002\u8BF7\u63D0\u4F9B\u7B2C\u4E00\u6559\u5B66\u5468\u7684\u65E5\u671F\u4E0E\u6BCF\u8282\u8BFE\u7684\u65F6\u95F4\u3002"}</p><div className="row"><button className="ghost-btn" onClick={() => { void navigator.clipboard.writeText(TIMETABLE_PROMPT).then(() => setMessage("\u63D0\u793A\u8BCD\u5DF2\u590D\u5236\uFF0C\u53EF\u4EE5\u53D1\u7ED9\u4F60\u7684 AI\u3002")).catch(() => { setPromptOpen(true); setError("\u8BF7\u5C55\u5F00\u63D0\u793A\u8BCD\u540E\u624B\u52A8\u590D\u5236\u3002"); }); }}>{"\u590D\u5236\u8BC6\u522B\u63D0\u793A\u8BCD"}</button><button className="ghost-btn" aria-expanded={promptOpen} onClick={() => setPromptOpen(v => !v)}>{promptOpen ? "\u6536\u8D77\u63D0\u793A\u8BCD" : "\u67E5\u770B\u63D0\u793A\u8BCD"}</button></div>{promptOpen && <textarea className="input import-prompt" aria-label="课表识别提示词" readOnly={true} value={TIMETABLE_PROMPT} onFocus={e => e.target.select()}></textarea>}<label className="import-input-label">{"\u7C98\u8D34\u8BC6\u522B\u7ED3\u679C"}<textarea className="input import-json" value={text} disabled={busy} maxLength={300000} placeholder="在这里粘贴完整的 JSON，支持带 json 代码框的内容" onChange={e => { setText(e.target.value); setPreview(null); setError(""); setMessage(""); }}></textarea></label><button className="primary-btn" disabled={busy || !text.trim()} onClick={() => void check()}>{busy ? "\u6B63\u5728\u5904\u7406\u2026" : "\u6821\u9A8C\u5E76\u9884\u89C8"}</button>{preview && <div className="timetable-preview"><h3>{preview.data.semester.name}</h3><p className="t-caption">{"\u7B2C 1 \u5468\u5468\u4E00\uFF1A"}{preview.data.semester.startDate}{" \u00B7 \u5171 "}{preview.data.semester.totalWeeks}{" \u5468"}</p>{preview.data.notes?.map(note => <p className="t-caption" key={note}>{note}</p>)}<div className="import-course-list">{preview.data.courses.map((c, i) => <article key={i}><strong>{c.name}</strong>{c.sessions.map((s, j) => <span key={j}>{"\u5468"}{"\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u65E5"[s.weekday - 1]}{" \u00B7 \u7B2C "}{s.startSlot}{"\u2013"}{s.endSlot}{" \u8282 \u00B7 "}{preview.data.timeSlots.find(t => t.slot === s.startSlot)?.start}{"\u2013"}{preview.data.timeSlots.find(t => t.slot === s.endSlot)?.end}{" \u00B7 \u7B2C "}{s.weeks.join("\u3001")}{" \u5468"}{s.room ? " \u00B7 " + s.room : ""}</span>)}</article>)}</div>{preview.warnings.map(w => <p className="editor-message error" key={w}>{w}</p>)}<label className="import-mode">{"\u5BFC\u5165\u65B9\u5F0F"}<select className="input" value={mode} disabled={busy} onChange={e => setMode(e.target.value as "replace" | "append")}><option value="replace">{"\u5207\u6362\u4E3A\u8FD9\u4EFD\u8BFE\u8868"}</option><option value="append">{"\u6DFB\u52A0\u5230\u73B0\u6709\u8BFE\u8868\uFF08\u540C\u5B66\u671F\u3001\u540C\u8282\u6B21\u65F6\u95F4\uFF09"}</option></select></label><p className="t-caption">{"\u5207\u6362\u540E\u65E5\u7A0B\u4F7F\u7528\u8FD9\u4EFD\u8BFE\u8868\uFF0C\u4EFB\u52A1\u3001\u65E5\u8BB0\u548C\u6253\u5361\u4F1A\u4FDD\u7559\u3002\u8BF7\u6838\u5BF9\u8BFE\u7A0B\u3001\u6559\u5BA4\u548C\u5468\u6B21\u540E\u786E\u8BA4\u3002"}</p><button className="primary-btn" disabled={busy || !!preview.warnings.length} onClick={() => void save()}>{"\u786E\u8BA4\u5BFC\u5165"}</button></div>}{error && <p role="alert" className="editor-message error">{error}</p>}{message && <p role="status" className="editor-message">{message}</p>}{result && <ImportResultDialog result={result} onClose={() => setResult(null)}></ImportResultDialog>}</section>;
}
function ImportResultDialog({ result, onClose }: {
    result: {
        count: number;
        sessions: number;
    };
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (!dialog.current?.open)
            dialog.current?.showModal();
    }, []);
    return <dialog className="import-result-dialog" ref={dialog} aria-labelledby="import-result-title" onClose={onClose}><span className="import-result-icon" aria-hidden="true">{"\u2713"}</span><h2 id="import-result-title">{"\u8BFE\u8868\u5DF2\u5BFC\u5165"}</h2><strong>{"\u7ED3\u679C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u8BF7\u4ED4\u7EC6\u6838\u5BF9"}</strong><p>{"\u5DF2\u6DFB\u52A0 "}{result.count}{" \u95E8\u8BFE\u7A0B\u3001"}{result.sessions}{" \u4E2A\u4E0A\u8BFE\u5B89\u6392\u3002\u8BF7\u5BF9\u7167\u539F\u8BFE\u8868\u68C0\u67E5\u8BFE\u7A0B\u540D\u79F0\u3001\u661F\u671F\u3001\u8282\u6B21\u65F6\u95F4\u3001\u4E0A\u8BFE\u5468\u6B21\u548C\u6559\u5BA4\u3002"}</p><button className="primary-btn" autoFocus={true} onClick={() => dialog.current?.close()}>{"\u6211\u4F1A\u4ED4\u7EC6\u6838\u5BF9"}</button></dialog>;
}
