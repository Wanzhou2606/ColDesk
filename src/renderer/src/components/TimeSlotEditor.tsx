import {TimePicker} from './TimePicker';
import * as React from 'react';
import { userError } from '../lib/userError';
import { useEffect, useState } from 'react';
import type { TimeSlot } from '@shared/types';
import { getApi } from '../lib/api';
/**
 * 课程时间设置：让用户自己设定每一节的上课时间。
 *
 * 为什么做成可编辑而不是写死：不同学校、甚至同一学校不同校区的节次时间都不一样
 * （ColDesk 现在内置了绍兴/下沙两套，但别的学校用不上），所以必须能让用户自己改。
 *
 * 交互设计取舍：
 *  - 按 上午 / 下午 / 晚上 分组显示，与真实作息表一致，降低认知负担
 *  - 预备铃单独一行：它不排课，只用来提醒"该去教室了"，所以允许起止时间相同
 *  - 支持增删节次：有的学校上午 4 节、有的 5 节
 *  - 保存前不做花哨校验，只在明显不合法（时间格式错、下课早于上课）时拒绝并说明原因
 */
type Period = 'am' | 'pm' | 'eve';
const PERIODS: Array<{
    key: Period;
    label: string;
    hint: string;
}> = [
    { key: 'am', label: '上午', hint: '上午的节次与预备铃' },
    { key: 'pm', label: '下午', hint: '下午的节次与预备铃' },
    { key: 'eve', label: '晚上', hint: '晚课的节次与预备铃' }
];
interface EditableSlot {
    key: string;
    slotIndex: number;
    period: Period;
    startTime: string;
    endTime: string;
    isPrepareBell: boolean;
}
let seq = 0;
const nextKey = () => `slot-${(seq += 1)}`;
function toEditable(slot: TimeSlot): EditableSlot {
    return {
        key: nextKey(),
        slotIndex: slot.slotIndex,
        period: slot.period,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isPrepareBell: Boolean(slot.isPrepareBell)
    };
}
export function TimeSlotEditor() {
    const [campus, setCampus] = useState('');
    const [campuses, setCampuses] = useState<string[]>([]);
    const [slots, setSlots] = useState<EditableSlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{
        kind: 'ok' | 'error';
        text: string;
    } | null>(null);
    const load = async (target?: string) => {
        setLoading(true);
        setMessage(null);
        const result = (await getApi().invoke('timeslots:get', target ? { campus: target } : undefined)) as {
            campus: string;
            campuses: string[];
            slots: TimeSlot[];
        } | null;
        if (result) {
            setCampus(result.campus);
            setCampuses(result.campuses.length ? result.campuses : [result.campus]);
            setSlots(result.slots.map(toEditable));
        }
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);
    const update = (key: string, patch: Partial<EditableSlot>) => {
        setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
        setMessage(null);
    };
    const remove = (key: string) => {
        setSlots((prev) => prev.filter((s) => s.key !== key));
        setMessage(null);
    };
    /** 在某个半天末尾追加一节（预备铃占 slotIndex 0，正常节次从 1 开始） */
    const addSlot = (period: Period) => {
        setSlots((prev) => {
            const inPeriod = prev.filter((s) => s.period === period);
            const maxIndex = inPeriod.reduce((max, s) => Math.max(max, s.slotIndex), 0);
            const last = inPeriod[inPeriod.length - 1];
            const start = last ? last.endTime : period === 'am' ? '08:00' : period === 'pm' ? '13:30' : '18:00';
            return [
                ...prev,
                {
                    key: nextKey(),
                    slotIndex: maxIndex + 1,
                    period,
                    startTime: start,
                    endTime: addMinutesToHhmm(start, 45),
                    isPrepareBell: false
                }
            ];
        });
        setMessage(null);
    };
    const save = async () => {
        const payload = slots
            .filter((s) => s.startTime && s.endTime)
            .map((s) => ({
            slotIndex: s.slotIndex,
            period: s.period,
            startTime: s.startTime,
            endTime: s.endTime,
            isPrepareBell: s.isPrepareBell
        }));
        if (payload.length === 0) {
            setMessage({ kind: 'error', text: '至少要保留一个节次' });
            return;
        }
        setSaving(true);
        setMessage(null);
        try {
            const result = (await getApi().invoke('timeslots:save', { campus, slots: payload })) as {
                slots: TimeSlot[];
            } | null;
            if (result?.slots)
                setSlots(result.slots.map(toEditable));
            setMessage({ kind: 'ok', text: '已保存，日程与提醒会按新的时间重排' });
        }
        catch (error) {
            setMessage({
                kind: 'error',
                text: userError(error, '保存失败，请检查时间是否填写完整')
            });
        }
        finally {
            setSaving(false);
        }
    };
    if (loading) {
        return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u8BFE\u7A0B\u65F6\u95F4"}</span></div><div className="t-caption">{"\u6B63\u5728\u8BFB\u53D6\u2026"}</div></section>);
    }
    return (<section className="panel"><div className="panel-head"><span className="t-title">{"\u8BFE\u7A0B\u65F6\u95F4"}</span><div className="row">{campuses.length > 1 && <select className="input narrow" value={campus} onChange={e => { setCampus(e.target.value); void load(e.target.value); }}>{campuses.map(c => <option value={c} key={c}>{c}{"\u6821\u533A"}</option>)}</select>}<button className="primary-btn" onClick={() => void save()} disabled={saving}>{saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"}</button></div></div><div className="t-caption">{"\u8FD9\u91CC\u7684\u65F6\u95F4\u51B3\u5B9A\u8BFE\u8868\u663E\u793A\u3001\"\u8BE5\u53BB\u4E0A\u8BFE\u4E86\"\u7684\u63D0\u9192\uFF0C\u4EE5\u53CA\u81EA\u52A8\u6392\u7A0B\u65F6\u54EA\u4E9B\u65F6\u6BB5\u7B97\u88AB\u4F60\u5360\u7528\u3002 \u6539\u5B8C\u70B9\u4FDD\u5B58\u5373\u53EF\uFF0C\u4E0D\u7528\u91CD\u542F\u3002"}</div>{message && <div className={`editor-message ${message.kind}`}>{message.text}</div>}{PERIODS.map(period => { const rows = slots.filter(s => s.period === period.key).sort((a, b) => a.slotIndex - b.slotIndex || Number(a.isPrepareBell) - Number(b.isPrepareBell)); return <div className="slot-group" key={period.key}><div className="row-between slot-group-head"><span className="t-body">{period.label}</span><button className="ghost-btn" onClick={() => addSlot(period.key)}>{"\uFF0B \u52A0\u4E00\u8282"}</button></div>{rows.length === 0 ? <div className="t-caption">{"\u8FD9\u4E2A\u534A\u5929\u8FD8\u6CA1\u6709\u8282\u6B21\uFF0C\u70B9\"\u52A0\u4E00\u8282\"\u6DFB\u52A0"}</div> : <ul className="slot-list">{rows.map(slot => <li className={`slot-row${slot.isPrepareBell ? " bell" : ""}`} key={slot.key}><span className="slot-name">{slot.isPrepareBell ? "\u9884\u5907\u94C3" : `\u7B2C ${slot.slotIndex} \u8282`}</span><TimePicker className="input narrow" value={slot.startTime} onChange={e => update(slot.key, { startTime: e })}/><span className="t-caption">{"\u81F3"}</span><TimePicker className="input narrow" value={slot.endTime} disabled={slot.isPrepareBell} onChange={e => update(slot.key, { endTime: e })}/>{slot.isPrepareBell && <span className="t-caption">{"\uFF08\u53EA\u63D0\u9192\uFF0C\u4E0D\u6392\u8BFE\uFF09"}</span>}<button className="icon-btn" title="删除这一节" onClick={() => remove(slot.key)}>{"\u2715"}</button></li>)}</ul>}</div>; })}<div className="t-caption">{"\u63D0\u793A\uFF1A\u9884\u5907\u94C3\u90A3\u4E00\u884C\u53EA\u586B\u4E00\u4E2A\u65F6\u95F4\u5373\u53EF\uFF0C\u5B83\u4EE3\u8868\"\u8BE5\u5F80\u6559\u5BA4\u8D70\u4E86\"\uFF0C\u4E0D\u4F1A\u5360\u7528\u8BFE\u8868\u65F6\u6BB5\u3002"}</div></section>);
}
function addMinutesToHhmm(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m))
        return hhmm;
    const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
