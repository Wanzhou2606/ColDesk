import {TimePicker} from './TimePicker';
import * as React from 'react';
import { userError } from '../lib/userError';
import { useEffect, useState } from 'react';
import type { PlannerPrefsView } from '@shared/plannerPrefs';
import { getApi } from '../lib/api';
/**
 * 排程偏好设置：让用户自己决定"什么时候可以安排任务"。
 *
 * 只暴露真正影响日常感受的 4 组参数，其余（睡前缓冲、周末折减）沿用内置默认值，
 * 免得设置页变成一堵墙。所有输入都会在主进程被收敛到安全范围，
 * 所以这里不做严格校验，只在保存后回显"实际生效的值"——
 * 这样用户能立刻看到自己被纠正成了什么，而不是以为设置没生效。
 */
export function PlannerPrefsEditor({ prefs, onSaved }: {
    prefs: PlannerPrefsView | undefined;
    onSaved?: () => void;
}) {
    const [draft, setDraft] = useState<PlannerPrefsView | undefined>(prefs);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{
        kind: 'ok' | 'error';
        text: string;
    } | null>(null);
    // 主进程把值收敛过之后会把新的 prefs 推下来，这里跟着同步
    useEffect(() => {
        setDraft(prefs);
    }, [prefs]);
    if (!draft) {
        return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u81EA\u52A8\u6392\u7A0B"}</span></div><div className="t-caption">{"\u6B63\u5728\u8BFB\u53D6\u2026"}</div></section>);
    }
    const patch = (next: Partial<PlannerPrefsView>) => {
        setDraft((prev) => (prev ? { ...prev, ...next } : prev));
        setMessage(null);
    };
    const updateWindow = (key: 'studyWindows' | 'lifeWindows', index: number, field: 'start' | 'end', value: string) => {
        const list = draft[key].map((w, i) => (i === index ? { ...w, [field]: value } : w));
        patch({ [key]: list } as Partial<PlannerPrefsView>);
    };
    const addWindow = (key: 'studyWindows' | 'lifeWindows') => {
        const list = draft[key];
        const last = list[list.length - 1];
        const start = last ? last.end : '08:00';
        patch({ [key]: [...list, { start, end: addMinutesToHhmm(start, 240) }] } as Partial<PlannerPrefsView>);
    };
    const removeWindow = (key: 'studyWindows' | 'lifeWindows', index: number) => {
        patch({ [key]: draft[key].filter((_, i) => i !== index) } as Partial<PlannerPrefsView>);
    };
    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await getApi().invoke('prefs:update', { prefs: draft });
            setMessage({ kind: 'ok', text: '已保存，日程已按新偏好重新编排' });
            onSaved?.();
        }
        catch (error) {
            setMessage({
                kind: 'error',
                text: userError(error, '保存失败')
            });
        }
        finally {
            setSaving(false);
        }
    };
    return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u6392\u7A0B\u504F\u597D"}</span><button className="primary-btn" onClick={() => void save()} disabled={saving}>{saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"}</button></div><div className="t-caption">{"\u8FD9\u91CC\u51B3\u5B9A\"\u81EA\u52A8\u5316\u5B89\u6392\u4EFB\u52A1\u65F6\uFF0C\u54EA\u4E9B\u65F6\u6BB5\u53EF\u4EE5\u7528\"\u3002\u4F60\u7684\u8BFE\u7A0B\u65F6\u95F4\u4F1A\u88AB\u81EA\u52A8\u907F\u5F00\uFF0C\u4E0D\u7528\u5199\u5728\u8FD9\u91CC\u3002"}</div>{message && <div className={`editor-message ${message.kind}`}>{message.text}</div>}{([{ key: "studyWindows", label: "\u5B66\u4E60\u4EFB\u52A1\u7684\u53EF\u7528\u65F6\u6BB5", hint: "\u901A\u5E38\u653E\u5728\u6CA1\u8BFE\u7684\u81EA\u4E60\u65F6\u95F4" }, { key: "lifeWindows", label: "\u751F\u6D3B\u4EFB\u52A1\u7684\u53EF\u7528\u65F6\u6BB5", hint: "\u751F\u6D3B\u4EFB\u52A1\u72EC\u7ACB\u4F7F\u7528\u8FD9\u4E9B\u65F6\u6BB5\uFF0C\u4E0D\u4F1A\u88AB\u5B66\u4E60\u4EFB\u52A1\u6324\u5360" }] as const).map(group => <div className="slot-group" key={group.key}><div className="row-between slot-group-head"><span className="t-body">{group.label}</span><button className="ghost-btn" onClick={() => addWindow(group.key)}>{"\uFF0B \u52A0\u4E00\u6BB5"}</button></div><div className="t-caption">{group.hint}</div><ul className="slot-list">{draft[group.key].map((w, index) => <li className="slot-row" key={`${group.key}-${index}`}><TimePicker className="input narrow" value={w.start} onChange={e => updateWindow(group.key, index, "start", e)}/><span className="t-caption">{"\u81F3"}</span><TimePicker className="input narrow" value={w.end} onChange={e => updateWindow(group.key, index, "end", e)}/><button className="icon-btn" title="删除这一段" onClick={() => removeWindow(group.key, index)}>{"\u2715"}</button></li>)}</ul></div>)}<div className="pref-grid"><label className="pref-field"><span className="t-caption">{"\u5B66\u4E60\u4EFB\u52A1\u5355\u65E5\u4E0A\u9650\uFF08\u5206\u949F\uFF09"}</span><input type="number" min={30} max={720} step={15} className="input narrow" value={draft.dailyCapMinutes.study} onChange={e => patch({ dailyCapMinutes: { ...draft.dailyCapMinutes, study: Number(e.target.value) } })}></input></label><label className="pref-field"><span className="t-caption">{"\u751F\u6D3B\u4EFB\u52A1\u5355\u65E5\u4E0A\u9650\uFF08\u5206\u949F\uFF09"}</span><input type="number" min={0} max={360} step={15} className="input narrow" value={draft.dailyCapMinutes.life} onChange={e => patch({ dailyCapMinutes: { ...draft.dailyCapMinutes, life: Number(e.target.value) } })}></input></label><label className="pref-field"><span className="t-caption">{"\u5355\u5757\u6700\u77ED\uFF08\u5206\u949F\uFF09"}</span><input type="number" min={10} max={240} step={5} className="input narrow" value={draft.minBlockMinutes} onChange={e => patch({ minBlockMinutes: Number(e.target.value) })}></input></label><label className="pref-field"><span className="t-caption">{"\u5355\u5757\u6700\u957F\uFF08\u5206\u949F\uFF09"}</span><input type="number" min={15} max={360} step={5} className="input narrow" value={draft.maxBlockMinutes} onChange={e => patch({ maxBlockMinutes: Number(e.target.value) })}></input></label><label className="pref-field"><span className="t-caption">{"\u5757\u95F4\u4F11\u606F\uFF08\u5206\u949F\uFF09"}</span><input type="number" min={0} max={60} step={5} className="input narrow" value={draft.breakMinutes} onChange={e => patch({ breakMinutes: Number(e.target.value) })}></input></label><label className="pref-field"><span className="t-caption">{"\u622A\u6B62\u524D\u9884\u7559\u7F13\u51B2\uFF08%\uFF09"}</span><input type="number" min={0} max={50} step={5} className="input narrow" value={Math.round(draft.dueBufferRatio * 100)} onChange={e => patch({ dueBufferRatio: Number(e.target.value) / 100 })}></input></label></div><div className="t-caption">{"\u53EA\u5728\u8FD9\u4E9B\u65F6\u6BB5\u5185\u5B89\u6392\u4EFB\u52A1\u3002\u4FDD\u5B58\u540E\u4F1A\u66F4\u65B0\u65E5\u7A0B\uFF0C\u5DF2\u9501\u5B9A\u7684\u5B89\u6392\u4F1A\u4FDD\u7559\u3002"}</div></section>);
}
function addMinutesToHhmm(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m))
        return hhmm;
    const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
