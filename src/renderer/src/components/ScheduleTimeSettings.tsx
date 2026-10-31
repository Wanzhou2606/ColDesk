import * as React from 'react';
import { useEffect, useState } from 'react';
import type { TodayView } from '@shared/view';
import { scheduleWindow, validateScheduleWindow } from '@shared/personalization';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
export function ScheduleTimeSettings({ state }: {
    state: TodayView | null;
}) {
    const range = scheduleWindow(state?.settings);
    const [start, setStart] = useState(range.startLabel), [end, setEnd] = useState(range.endLabel), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    useEffect(() => { setStart(range.startLabel); setEnd(range.endLabel); }, [range.startLabel, range.endLabel]);
    const save = async (reset = false) => {
        if (busy)
            return;
        setMessage('');
        setError('');
        try {
            const value = validateScheduleWindow(reset ? '06:00' : start.trim(), reset ? '24:00' : end.trim());
            setBusy(true);
            await getApi().invoke('settings:update', { scheduleStart: value.startLabel, scheduleEnd: value.endLabel });
            setStart(value.startLabel);
            setEnd(value.endLabel);
            setMessage('日程时间已保存。');
        }
        catch (e) {
            setError(userError(e, '暂时无法保存日程时间'));
        }
        finally {
            setBusy(false);
        }
    };
    return <section className="panel schedule-time-settings"><div className="panel-head"><span className="t-title">{"\u65E5\u7A0B\u65F6\u95F4"}</span><span className="t-caption">{"\u9ED8\u8BA4 06:00\u201324:00"}</span></div><p className="t-caption">{"\u8BBE\u7F6E\u65E5\u7A0B\u8868\u548C\u5468\u89C6\u56FE\u663E\u793A\u7684\u65F6\u95F4\u8303\u56F4\u3002\u8303\u56F4\u5916\u7684\u5B89\u6392\u4ECD\u7136\u4FDD\u7559\uFF0C\u53EF\u5728\u65E5\u7A0B\u6E05\u5355\u4E2D\u67E5\u770B\uFF1B\u81EA\u52A8\u6392\u7A0B\u7684\u53EF\u7528\u65F6\u6BB5\u5728\u4E0B\u65B9\u5355\u72EC\u8BBE\u7F6E\u3002"}</p><div className="schedule-time-fields"><label>{"\u5F00\u59CB\u65F6\u95F4"}<input className="input" aria-label="日程开始时间" inputMode="numeric" maxLength={5} placeholder="06:00" disabled={busy} value={start} onChange={e => { setStart(e.target.value); setError(""); setMessage(""); }}></input></label><span>{"\u81F3"}</span><label>{"\u7ED3\u675F\u65F6\u95F4"}<input className="input" aria-label="日程结束时间" inputMode="numeric" maxLength={5} placeholder="24:00" disabled={busy} value={end} onChange={e => { setEnd(e.target.value); setError(""); setMessage(""); }}></input></label></div><p className="t-caption">{"\u4F7F\u7528 24 \u5C0F\u65F6\u5236\uFF0C\u586B\u5199 HH:mm\uFF0C\u4F8B\u5982 07:30\u201322:30\uFF1B\u7ED3\u675F\u65F6\u95F4\u53EF\u586B\u5199 24:00\u3002"}</p><div className="row"><button className="primary-btn" disabled={busy} onClick={() => void save()}>{busy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u65E5\u7A0B\u65F6\u95F4"}</button><button className="ghost-btn" disabled={busy} onClick={() => void save(true)}>{"\u6062\u590D\u9ED8\u8BA4\u65F6\u95F4"}</button></div>{error && <p role="alert" className="editor-message error">{error}</p>}{message && <p role="status" className="editor-message">{message}</p>}</section>;
}
