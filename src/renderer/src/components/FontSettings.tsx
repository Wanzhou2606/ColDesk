import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useState } from 'react';
import { COVER_FONT_OPTIONS, UI_FONT_OPTIONS, coverFontFamily, uiFontFamily, validFontName } from '@shared/fonts';
import type { TodayView } from '@shared/view';
export function FontSettings({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    return <section className="panel font-settings"><div className="panel-head"><div><h2>{"\u5B57\u4F53\u4E0E\u6708\u5386"}</h2><p>{"\u9009\u4E00\u79CD\u559C\u6B22\u7684\u5B57\uFF0C\u8BA9\u8BB0\u5F55\u66F4\u50CF\u81EA\u5DF1\u3002"}</p></div></div><FontPicker setting="uiFont" label="应用字体" hint="用于主界面、日记正文及桌面组件。" value={state?.settings.uiFont ?? "system"} options={UI_FONT_OPTIONS} update={update}></FontPicker><FontPicker setting="homeCoverFont" label="月历封面字体" hint="单独用于 home 月历格子里的封面和封面编辑框。" value={state?.settings.homeCoverFont ?? "STXingkai"} options={COVER_FONT_OPTIONS} update={update}></FontPicker><p className="t-caption">{"\u4E5F\u53EF\u4EE5\u586B\u5199\u672C\u673A\u5DF2\u5B89\u88C5\u7684\u5B57\u4F53\u540D\u79F0\uFF1B\u672A\u5B89\u88C5\u7684\u5B57\u4F53\u4F1A\u4F7F\u7528\u9ED8\u8BA4\u5B57\u4F53\u3002\u8BBE\u7F6E\u4F1A\u81EA\u52A8\u4FDD\u7559\u3002"}</p></section>;
}
function FontPicker({ setting, label, hint, value, options, update }: {
    setting: 'uiFont' | 'homeCoverFont';
    label: string;
    hint: string;
    value: string;
    options: Array<{
        value: string;
        label: string;
    }>;
    update: (patch: Record<string, unknown>) => void;
}) {
    const [custom, setCustom] = useState(!options.some(option => option.value === value));
    const [name, setName] = useState(value);
    const [error, setError] = useState('');
    useEffect(() => {
        setName(value);
        if (!options.some(option => option.value === value))
            setCustom(true);
    }, [value, options]);
    const family = setting === 'uiFont' ? uiFontFamily(name) : coverFontFamily(name);
    return <div className="font-picker"><div className="font-picker-head"><div><label htmlFor={setting + "-choice"}>{label}</label><p className="t-caption">{hint}</p></div><select className="input" id={setting + "-choice"} value={custom ? "custom" : value} onChange={event => {
            setError("");
            if (event.target.value === "custom") {
                setCustom(true);
                return;
            }
            setCustom(false);
            setName(event.target.value);
            update({ [setting]: event.target.value });
        }}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}<option value="custom">{"\u81EA\u5B9A\u4E49\u5B57\u4F53\u2026"}</option></select></div>{custom && <div className="font-custom"><input className="input" aria-label={label + "\u540D\u79F0"} maxLength={80} placeholder="例如：华文行楷" value={name} onChange={event => { setName(event.target.value); setError(""); }}></input><button className="ghost-btn" onClick={() => {
                if (!validFontName(name)) {
                    setError("\u8BF7\u586B\u5199\u6709\u6548\u7684\u5B57\u4F53\u540D\u79F0\u3002");
                    return;
                }
                update({ [setting]: name.trim() });
            }}>{"\u5E94\u7528\u5B57\u4F53"}</button></div>}<div className={`font-preview${setting === "homeCoverFont" ? " cover-preview" : ""}`} style={{ fontFamily: family } as (RecoveredStyle | undefined)}><span>{setting === "homeCoverFont" ? "\u4ECA\u5929\u7684\u98CE\uFF0C\u66FF\u6211\u7FFB\u5F00\u65B0\u7684\u4E00\u9875\u3002" : "\u628A\u65F6\u95F4\u7559\u7ED9\u91CD\u8981\u7684\u4E8B\uFF0C\u628A\u5FC3\u4E8B\u5199\u6210\u65E5\u8BB0\u3002"}</span><small>{"ColDesk \u00B7 1234567890"}</small></div>{error && <p className="danger t-caption" role="alert">{error}</p>}</div>;
}
