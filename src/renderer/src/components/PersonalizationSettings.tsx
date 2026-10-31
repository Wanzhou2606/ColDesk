import * as React from 'react';
import type {CSSProperties as RecoveredStyle} from 'react';
import { useEffect, useState } from 'react';
import type { TodayView } from '@shared/view';
import { THEME_OPTIONS, type ThemeId } from '@shared/personalization';
import {CourseColorSettings} from './CourseColorSettings';
import { AppLogo } from './AppLogo';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
export function PersonalizationSettings({ state, update }: {
    state: TodayView | null;
    update: (patch: Record<string, unknown>) => void;
}) {
    const [custom, setCustom] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    useEffect(() => {
        let alive = true;
        void getApi().invoke('appearance:iconGet').then(v => {
            if (alive)
                setCustom(!!(v as {
                    custom?: boolean;
                })?.custom);
        }).catch(() => { });
        return () => { alive = false; };
    }, []);
    const icon = async (reset: boolean) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await getApi().invoke(reset ? 'appearance:iconReset' : 'appearance:iconPick') as {
                custom: boolean;
                shortcuts?: {
                    updated: number;
                    failed: number;
                };
            } | null;
            if (result) {
                setCustom(result.custom);
                setMessage(reset ? '已恢复默认图标。' : result.shortcuts?.failed ? '图标已更换，部分 Windows 快捷方式暂未更新。' : '图标已更换。Windows 图标缓存可能需要稍等片刻。');
            }
        }
        catch (e) {
            setError(userError(e, '暂时无法更换图标，请重新选择图片'));
        }
        finally {
            setBusy(false);
        }
    };
    const group = (target: 'mainTheme' | 'homeTheme', title: string) => <div className="theme-choice-group"><h3>{title}</h3><div className="theme-choice-grid" role="group" aria-label={`${title}\u4E3B\u9898\u989C\u8272`}>{THEME_OPTIONS.map(theme => <button className={`theme-choice${(state?.settings[target] ?? "default") === theme.id ? " selected" : ""}`} aria-pressed={(state?.settings[target] ?? "default") === theme.id} onClick={() => update({ [target]: theme.id })} key={theme.id}><span className="theme-choice-preview" style={{ background: theme.id === "default" && target === "homeTheme" ? "#f7f6ee" : theme.color } as (RecoveredStyle | undefined)}><i style={{ background: theme.id === "default" && target === "homeTheme" ? "#728969" : theme.accent } as (RecoveredStyle | undefined)}></i><span></span><span></span></span><span>{theme.name}</span>{(state?.settings[target] ?? "default") === theme.id && <small aria-hidden="true">{"\u2713"}</small>}</button>)}</div></div>;
    return <><section className="panel icon-settings"><div className="panel-head"><span className="t-title">{"\u56FE\u6807\u8BBE\u7F6E"}</span><span className="t-caption">{custom ? "\u6211\u7684\u56FE\u6807" : "\u9ED8\u8BA4\u56FE\u6807"}</span></div><div className="icon-settings-content"><div className="custom-icon-preview"><AppLogo alt="当前软件图标"></AppLogo></div><div><p>{"\u7528\u559C\u6B22\u7684\u56FE\u7247\uFF0C\u4E3A ColDesk \u6362\u4E00\u4E2A\u56FE\u6807\u3002"}</p><p className="t-caption">{"\u652F\u6301 PNG\u3001JPG\u3001WebP \u7B49\u56FE\u7247\uFF0C\u6700\u5927 20 MB\u3002\u56FE\u7247\u4F1A\u5C45\u4E2D\u88C1\u6210\u65B9\u5F62\uFF0C\u4FDD\u7559\u900F\u660E\u533A\u57DF\uFF0C\u5E76\u590D\u5236\u5230\u8FD9\u53F0\u7535\u8111\u4FDD\u5B58\u3002"}</p><div className="row"><button className="primary-btn" disabled={busy} onClick={() => void icon(false)}>{busy ? "\u6B63\u5728\u5904\u7406\u2026" : "\u4E0A\u4F20\u56FE\u7247"}</button><button className="ghost-btn" disabled={busy || !custom} onClick={() => void icon(true)}>{"\u6062\u590D\u9ED8\u8BA4\u56FE\u6807"}</button></div></div></div><p className="t-caption">{"\u5E94\u7528\u5185\u3001\u7A97\u53E3\u3001\u6258\u76D8\u548C\u5DF2\u6709\u7684 ColDesk \u5FEB\u6377\u65B9\u5F0F\u4F1A\u4F7F\u7528\u65B0\u56FE\u6807\u3002\u5206\u4EAB\u7ED9\u522B\u4EBA\u7684\u5B89\u88C5\u5305\u4ECD\u4F7F\u7528\u9ED8\u8BA4\u56FE\u6807\u3002"}</p>{error && <p className="editor-message error" role="alert">{error}</p>}{message && <p className="editor-message" role="status">{message}</p>}</section><section className="panel theme-settings"><div className="panel-head"><span className="t-title">{"\u4E3B\u9898\u989C\u8272"}</span><span className="t-caption">{"\u6E05\u65B0 \u00B7 \u6DE1\u96C5"}</span></div><p className="t-caption">{"\u4E3B\u9875\u9762\u548C home \u53EF\u4EE5\u5206\u522B\u9009\u62E9\u989C\u8272\u3002\u300C\u9ED8\u8BA4\u300D\u4FDD\u7559\u5F53\u524D\u914D\u8272\uFF0C\u9009\u62E9\u540E\u7ACB\u5373\u751F\u6548\uFF0C\u91CD\u542F\u540E\u4ECD\u4FDD\u7559\u3002"}</p>{group("mainTheme", "\u4E3B\u9875\u9762")}{group("homeTheme", "home")}</section><CourseColorSettings courses={state?.courses??[]}/></>;
}
