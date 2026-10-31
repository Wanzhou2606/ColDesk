import {TimePicker} from './TimePicker';
import {NumberStepper} from './NumberStepper';
import {ControlIcon} from './ControlIcon';
import {DeadlineDatePicker} from './DeadlineDatePicker';
import {TaskSegmentsFields,segmentDrafts,serializeSegments} from './TaskSegmentsFields';
import type {ScheduleBlock} from '@shared/types';
import {today} from '@shared/time';
import {validHomeDate} from '@shared/home';
import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Task, Urgency } from '@shared/types';
import type { TaskEditField, TaskPatch } from '@shared/taskActions';
import { urgencyMeta } from '@shared/scoring';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
const TITLES = { name: '编辑名称', urgency: '修改紧迫程度', due: '修改截止时间', all: '编辑任务', schedule:'调整分段安排' };
export function TaskEditDialog({ task, field, onClose,placements=[],defaultDate }: {
    task?: Task;
    placements?:ScheduleBlock[];
    defaultDate?:string;
    field: TaskEditField;
    onClose: () => void;
}) {
    const [segments,setSegments]=useState(()=>segmentDrafts(placements.filter(block=>block.taskId===task?.id)));
    const canArrange=!!task&&task.status!=='done'&&task.status!=='canceled';
    const [title, setTitle] = useState(task?.title ?? ''), [urgency, setUrgency] = useState<Urgency>(task?.urgency ?? 3);
    const [due, setDue] = useState(task?.dueAt ?? `${today()}T18:00`), [noDue, setNoDue] = useState(!task?.dueAt);
    const [minutes, setMinutes] = useState(String(task?.estMinutes ?? 45)), [split, setSplit] = useState(task?.splittable ?? true), [detail, setDetail] = useState(task?.detail ?? '');
    const [saving, setSaving] = useState(false), [error, setError] = useState('');
    const form = useRef<HTMLFormElement>(null);
    const busyRef = useRef(false);
    busyRef.current = saving;
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        form.current?.querySelector<HTMLElement>('input:not(:disabled), button')?.focus();
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (!busyRef.current)
                    onClose();
            }
            if (event.key === 'Tab') {
                const controls = Array.from(form.current?.querySelectorAll<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)') ?? []);
                if (!controls.length)
                    return;
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('keydown', key); previous?.focus(); };
    }, [onClose]);
    const submit = async () => {
        if (saving || !task)
            return;
        let patch: TaskPatch = {};
        if (field === 'all' || field === 'name')
            patch.title = title;
        if (field === 'all' || field === 'urgency')
            patch.urgency = urgency;
        if (field === 'all' || field === 'due')
            patch.dueAt = noDue ? null : due;
        if (field === 'all')
            patch = { ...patch, estMinutes: Number(minutes), splittable: split, detail };
        setSaving(true);
        setError('');
        try {
            if(field==='schedule')await getApi().invoke('schedule:saveSegments',{taskId:task.id,segments:serializeSegments(segments)});
            else await getApi().invoke('task:update', { id: task.id, patch,...(field==='all'&&canArrange?{segments:serializeSegments(segments)}:{}) });
            onClose();
        }
        catch (err) {
            setError(userError(err, '暂时未能保存，请重试。'));
        }
        finally {
            setSaving(false);
        }
    };
    return <div className="task-edit-backdrop"><form ref={form} className="task-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="task-edit-title" onSubmit={event => { event.preventDefault(); void submit(); }}><header><div><span className="t-caption">任务</span><h2 id="task-edit-title">{TITLES[field]}</h2></div><button className="ghost-btn" type="button" disabled={saving} aria-label="关闭任务编辑" onClick={onClose}><ControlIcon name="close"/></button></header>{!task ? <p role="alert">{"\u8FD9\u9879\u4EFB\u52A1\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5173\u95ED\u540E\u91CD\u65B0\u9009\u62E9\u3002"}</p> : <div className="task-edit-body">{(field === "all" || field === "name") && <label>{"\u4EFB\u52A1\u540D\u79F0"}<input className="input" maxLength={200} required={true} value={title} disabled={saving} onChange={event => setTitle(event.target.value)}></input></label>}{(field === "all" || field === "urgency") && <fieldset><legend>{"\u7D27\u8FEB\u7A0B\u5EA6"}</legend><div className="task-edit-urgencies">{([1, 2, 3, 4, 5] as const).map(value => <button type="button" disabled={saving} aria-pressed={urgency === value} style={{ "--urgency-color": urgencyMeta(value).color } as (RecoveredStyle | undefined)} onClick={() => setUrgency(value)} key={value}><strong>{value}</strong><span>{urgencyMeta(value).label}</span></button>)}</div><p className="t-caption">{urgencyMeta(urgency).meaning}</p></fieldset>}{(field === "all" || field === "due") && <div><label className="task-edit-no-due"><input type="checkbox" checked={noDue} disabled={saving} onChange={event => setNoDue(event.target.checked)}></input>{"\u4E0D\u8BBE\u7F6E\u622A\u6B62\u65F6\u95F4"}</label><span className="deadline-field-label">截止时间</span><div className="task-deadline-fields"><DeadlineDatePicker value={due.slice(0,10)} onChange={date=>setDue(`${date}T${due.slice(11,16)||'18:00'}`)} disabled={saving || noDue}/><TimePicker className="input" aria-label="截止时刻" required={!noDue} disabled={saving || noDue} value={due.slice(11,16)} onChange={event=>setDue(`${due.slice(0,10)}T${event}`)}/></div></div>}{field === "all" && <><label>{"\u9884\u8BA1\u7528\u65F6\uFF08\u5206\u949F\uFF09"}<NumberStepper className="input" min={5} max={1440} step={1} required value={minutes} disabled={saving} onValueChange={setMinutes}/></label><label>{"详细内容"}<textarea className="input" rows={3} maxLength={2000} value={detail} disabled={saving} onChange={event => setDetail(event.target.value)}></textarea></label></>}{(field==='all'||field==='schedule')&&canArrange&&<TaskSegmentsFields rows={segments} onChange={setSegments} defaultDate={validHomeDate(defaultDate)?defaultDate:today()} disabled={saving}/>}
{error && <p className="danger" role="alert">{error}</p>}</div>}<footer><span>{"\u4FEE\u6539\u4F1A\u540C\u6B65\u5230\u65E5\u7A0B\u548C\u684C\u9762\u7EC4\u4EF6\u3002"}</span><div><button className="ghost-btn" type="button" disabled={saving} onClick={onClose}>{"\u53D6\u6D88"}</button><button className="primary-btn" disabled={saving || !task} type="submit">{saving ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u4FEE\u6539"}</button></div></footer></form></div>;
}
