import {TimePicker} from './TimePicker';
import {NumberStepper} from './NumberStepper';
import {DeadlineDatePicker} from './DeadlineDatePicker';
import {TaskSegmentsFields,serializeSegments,type TaskSegmentDraft} from './TaskSegmentsFields';
import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { userError } from '../lib/userError';
import { useId,useState } from 'react';
import { URGENCY_TABLE, urgencyMeta } from '@shared/scoring';
import { nowLocal, today } from '@shared/time';
import type { Domain, Task, Urgency } from '@shared/types';
import { getApi } from '../lib/api';
const TYPES: Array<{
    value: Task['type'];
    label: string;
}> = [
    { value: 'assignment', label: '作业' },
    { value: 'experiment', label: '实验' },
    { value: 'paper', label: '论文' },
    { value: 'exam_prep', label: '复习' },
    { value: 'todo', label: '待办' },
    { value: 'event', label: '日程' }
];
const EST_PRESETS = [25, 45, 60, 90, 120];
/**
 * 手动录入表单（设计文档 7.1）。
 * 紧迫程度是必填项，且随选随显示语义与排程倾向。
 */
export function TaskForm({ courses, onDone }: {
    courses: Array<{
        id: string;
        name: string;
        color: string;
    }>;
    defaultDomain?: Domain;
    onDone: () => void;
}) {
    const [segments,setSegments]=useState<TaskSegmentDraft[]>([]);
    const [title, setTitle] = useState(''),[detail,setDetail]=useState(''),detailsId=useId();
    const [type, setType] = useState<Task['type']>('todo');
    const [courseId, setCourseId] = useState('');
    const [dueDate, setDueDate] = useState(today());
    const [dueTime, setDueTime] = useState('18:00');
    const [allDay, setAllDay] = useState(false);
    const [urgency, setUrgency] = useState<Urgency>(3);
    const [estMinutes, setEstMinutes] = useState(45);
    const [splittable, setSplittable] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const meta = urgencyMeta(urgency);
    const submit = async () => {
        const trimmed = title.trim();
        if (!trimmed) {
            setError('请先写一个任务标题');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await getApi().invoke('task:create', {
                title: trimmed,
                detail: detail.trim(),
                domain: 'study',
                type,
                courseId: courseId || undefined,
                urgency,
                dueAt: allDay ? `${dueDate}T23:59` : `${dueDate}T${dueTime}`,
                estMinutes,
                splittable:true,
                segments:serializeSegments(segments)
            });
            onDone();
        }
        catch (e) {
            setError(userError(e, '保存失败'));
        }
        finally {
            setSaving(false);
        }
    };
    return (<form className="glass-card task-form" onSubmit={e => { e.preventDefault(); void submit(); }}><div className="form-row"><label className="form-label">{"\u6807\u9898 *"}</label><input className="input grow" maxLength={200} placeholder="例如：交数据结构实验报告" value={title} autoFocus={true} onChange={e => setTitle(e.target.value)}></input></div><div className="form-row task-form-detail"><label className="form-label" htmlFor={detailsId}>详细内容</label><textarea id={detailsId} className="input grow" rows={3} maxLength={2000} value={detail} onChange={e=>setDetail(e.target.value)} placeholder="写下要做的事情、步骤或需要准备的材料…"/></div><div className="form-grid"><div className="form-row"><label className="form-label">{"\u7C7B\u578B"}</label><select className="input" value={type} onChange={e => setType(e.target.value as typeof type)}>{TYPES.map(t => <option value={t.value} key={t.value}>{t.label}</option>)}</select></div><div className="form-row"><label className="form-label">{"\u6240\u5C5E\u8BFE\u7A0B"}</label><select className="input" value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">{"\u4E0D\u5173\u8054"}</option>{courses.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div><div className="form-row"><label className="form-label">{"\u622A\u6B62\u65F6\u95F4 *"}</label><div className="task-deadline-fields"><DeadlineDatePicker value={dueDate} onChange={setDueDate} disabled={saving}/><TimePicker className="input" aria-label="截止时刻" required={!allDay} value={dueTime} disabled={allDay || saving} onChange={e => setDueTime(e)}/><label className="checkbox"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)}></input>{"\u5168\u5929"}</label></div></div></div><div className="form-row urgency-row"><label className="form-label">{"\u7D27\u8FEB\u7A0B\u5EA6 *"}</label><div className="urgency-options">{([5, 4, 3, 2, 1] as const).map(u => { const m = URGENCY_TABLE[u]; return <button type="button" className={`urgency-option${urgency === u ? " active" : ""}`} style={urgency === u ? { borderColor: m.color, background: `${m.color}18` } : void 0 as (RecoveredStyle | undefined)} onClick={() => setUrgency(u)} key={u}><span className="row gap-6"><span className="urgency-dot" style={{ background: m.color } as (RecoveredStyle | undefined)}></span><strong>{u}</strong><span>{m.label}</span></span><span className="t-caption">{m.meaning}</span></button>; })}</div></div><div className="form-row"><label className="form-label">{"\u9884\u4F30\u8017\u65F6"}</label><div className="row"><NumberStepper className="input narrow" aria-label="预估耗时" min={5} max={1440} step={5} value={estMinutes} disabled={saving} onValueChange={value => setEstMinutes(Number(value))}/><span className="t-caption">{"\u5206\u949F"}</span><div className="row presets">{EST_PRESETS.map(v => <button type="button" className={`chip${estMinutes === v ? " active" : ""}`} onClick={() => setEstMinutes(v)} key={v}>{v}</button>)}</div></div></div><TaskSegmentsFields rows={segments} onChange={setSegments} defaultDate={today()} disabled={saving}/><div className="form-hint glass-card"><div className="row-between"><span className="t-caption">{"\u7D27\u8FEB\u5EA6 "}{urgency}{" \u7684\u6392\u7A0B\u503E\u5411"}</span><span className="t-caption">{meta.scheduling}</span></div><div className="t-caption">{"\u63D0\u9192\uFF1A"}{meta.offsets.length === 0 ? "\u4EC5\u6BCF\u65E5\u6C47\u603B" : meta.offsets.map(offsetLabel).join(" / ")}{" \u00B7 \u4FDD\u5B58\u540E\u7559\u5728\u4EFB\u52A1\u680F\uFF0C\u7531\u4F60\u51B3\u5B9A\u4F55\u65F6\u5B89\u6392"}</div></div>{error && <div className="form-error">{error}</div>}<div className="row-between"><span className="t-caption">{"\u5F53\u524D\u65F6\u95F4 "}{nowLocal().slice(11, 16)}{" \u00B7 \u6392\u7A0B\u4F1A\u907F\u5F00\u4F60\u7684\u8BFE\u7A0B\u4E0E\u56FA\u5B9A\u5360\u7528"}</span><div className="row"><button type="button" className="ghost-btn lg" onClick={onDone}>{"\u53D6\u6D88"}</button><button type="submit" className="primary-btn lg" disabled={saving}>{saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u4EFB\u52A1"}</button></div></div></form>);
}
function offsetLabel(minutes: number): string {
    if (minutes >= 1440)
        return `${Math.round(minutes / 1440)} 天前`;
    if (minutes >= 60)
        return `${Math.round(minutes / 60)} 小时前`;
    return `${minutes} 分钟前`;
}
