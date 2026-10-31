import {TimePicker} from './TimePicker';
import * as React from 'react';
import { AppLogo } from './AppLogo';
import { useEffect, useRef, useState } from 'react';
import type { TodayView } from '@shared/view';
import { AppIcon, type AppIconName } from './AppIcon';
import {NumberStepper} from './NumberStepper';
import { getApi } from '../lib/api';
export const INTRO_STEPS = ['认识 ColDesk', '按你的习惯设置', '添加第一项任务', '准备开始'];
export function OnboardingDialog({ state, onDone, replay = false }: {
    state: TodayView;
    onDone: () => void;
    replay?: boolean;
}) {
    const [step, setStep] = useState(0);
    const [autoSchedule, setAutoSchedule] = useState(false);
    const [autoLaunch, setAutoLaunch] = useState(state.settings.autoLaunch);
    const [digest, setDigest] = useState(state.settings.dailyDigestAt);
    const [title, setTitle] = useState('');
    const [due, setDue] = useState('');
    const [duration, setDuration] = useState(45);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const createdTask = useRef(false);
    const dialogRef = useRef<HTMLElement | null>(null);
    const titleRef = useRef<HTMLHeadingElement | null>(null);
    useEffect(() => { titleRef.current?.focus(); }, [step]);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const trap = (event: KeyboardEvent) => {
            if (event.key !== 'Tab')
                return;
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []);
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
        };
        document.addEventListener('keydown', trap);
        return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
    }, []);
    const finish = async (skip: boolean) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            if (!skip) {
                await getApi().invoke('settings:update', { autoSchedule, autoLaunch, dailyDigestAt: digest });
                if (title.trim() && !createdTask.current) {
                    await getApi().invoke('task:create', { title: title.trim(), domain:'study', type:'todo', urgency: 3, dueAt: due || undefined, estMinutes: duration, splittable: true });
                    createdTask.current = true;
                }
            }
            await getApi().invoke('settings:update', { onboardingVersion: 1 });
            onDone();
        }
        catch {
            setError('暂时未能保存，请重试。已保存的任务不会重复添加。');
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="onboarding-backdrop"><section className="onboarding-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-subtitle" aria-busy={busy}><header className="intro-head"><div className="intro-brand"><AppLogo alt=""></AppLogo><strong>{"ColDesk"}</strong></div><span>{step + 1}{" / "}{INTRO_STEPS.length}</span></header><ol className="intro-progress" aria-label="引导进度">{INTRO_STEPS.map((label, i) => <li className={i <= step ? "active" : ""} aria-current={i === step ? "step" : void 0} key={label}><span>{i + 1}</span><small>{label}</small></li>)}</ol><div className="intro-body"><h1 id="intro-title" ref={titleRef} tabIndex={-1}>{step === 0 ? "\u6B22\u8FCE\u4F7F\u7528 ColDesk" : INTRO_STEPS[step]}</h1><p id="intro-subtitle">{["\u628A\u5F85\u529E\u3001\u82B1\u9500\u548C\u4E60\u60EF\u653E\u5728\u4E00\u8D77\uFF0C\u4ECE\u4E00\u4EF6\u5C0F\u4E8B\u5F00\u59CB\u3002", "\u8FD9\u4E9B\u9009\u9879\u4EE5\u540E\u90FD\u80FD\u5728\u8BBE\u7F6E\u91CC\u8C03\u6574\u3002", "\u53EF\u4EE5\u73B0\u5728\u6DFB\u52A0\uFF0C\u4E5F\u53EF\u4EE5\u7559\u7A7A\uFF0C\u8FDB\u5165\u5E94\u7528\u540E\u518D\u6DFB\u52A0\u3002", title.trim() ? "\u70B9\u51FB\u5F00\u59CB\u4F7F\u7528\u540E\uFF0C\u8BBE\u7F6E\u548C\u8FD9\u9879\u4EFB\u52A1\u4F1A\u4E00\u8D77\u4FDD\u5B58\u3002" : "\u8BBE\u7F6E\u5B8C\u6210\u540E\uFF0C\u5C31\u53EF\u4EE5\u5F00\u59CB\u5B89\u6392\u81EA\u5DF1\u7684\u65E5\u5E38\u4E86\u3002"][step]}</p>{step === 0 && <><div className="intro-features">{[["schedule", "\u62D6\u62FD\u5B89\u6392\u65E5\u7A0B", "默认预览06:00–24:00，可在设置中修改范围。任务可自由设置日期与起止时间，或从任务栏拖入空闲处。一个任务可分成多段，日程标题后显示①②③；拖动一段只调整这一段。任务栏中仍只显示一项。"] as const, ["study", "\u8BB0\u4EFB\u52A1", "\u586B\u5199\u622A\u6B62\u65F6\u95F4\u548C\u9884\u8BA1\u65F6\u957F\u3002\u4EFB\u52A1\u53F3\u4E0A\u89D2\u300C\u22EF\u300D\u53EF\u7F6E\u9876\u3001\u5220\u9664\u3001\u4FEE\u6539\u7D27\u8FEB\u7A0B\u5EA6\u3001\u622A\u6B62\u65F6\u95F4\u548C\u540D\u79F0\uFF1B\u6D6E\u7A97\u7F16\u8F91\u4F1A\u6253\u5F00\u4E3B\u7A97\u53E3\u3002"] as const, ["home", "home \u00B7 \u5FC3\u7075\u7530\u56ED", "\u9996\u6B21\u8FDB\u5165\u53EF\u9009\u62E9\u662F\u5426\u8BBE\u7F6E\u5BC6\u7801\u3002\u70B9\u5F00\u6708\u5386\u4E2D\u7684\u4E00\u5929\uFF0C\u8BB0\u5F55\u5C01\u9762\u3001\u5929\u6C14\u3001\u5FC3\u60C5\u548C\u6B63\u6587\uFF0C\u6DFB\u52A0\u7167\u7247\u4E0E\u6587\u4EF6\uFF1B\u5207\u6362\u76F8\u518C\u53EF\u6D4F\u89C8\u672C\u6708\u7167\u7247\u3002"] as const, ["home", "\u5BFC\u51FA\u65E5\u8BB0", "\u5728 home \u53F3\u4E0A\u89D2\u70B9\u300C\u5BFC\u51FA\u65E5\u8BB0\u300D\uFF0C\u9009\u62E9\u5F53\u5929\u3001\u6708\u4EFD\u3001\u5168\u90E8\u6216\u65E5\u671F\u8303\u56F4\uFF1B\u603B\u89C8\u5408\u6210\u4E00\u4EFD Word\uFF0C\u65E5\u8BB0\u6309\u5929\u4FDD\u5B58\uFF0C\u6807\u9898\u7528\u65E5\u671F\u548C\u5C0F\u6807\u9898\u3002\u6709\u7167\u7247\u65F6\u81EA\u52A8\u4F7F\u7528 Word\uFF0C\u53EF\u5355\u72EC\u5BFC\u51FA\u539F\u56FE\u3002\u5BC6\u7801\u65E5\u8BB0\u987B\u5148\u89E3\u9501\uFF0C\u5BFC\u51FA\u5185\u5BB9\u4E0D\u52A0\u5BC6\u3002"] as const, ["settings", "\u4E2A\u6027\u5316", "\u8BBE\u7F6E \u2192 \u4E2A\u6027\u5316\u4E2D\u53EF\u4E0A\u4F20\u56FE\u7247\u4F5C\u4E3A\u8F6F\u4EF6\u56FE\u6807\uFF0C\u4E3B\u9875\u9762\u548C home \u5404\u81EA\u9009\u62E9\u9ED8\u8BA4\u3001\u6D45\u84DD\u3001\u6D45\u7EFF\u3001\u6DE1\u7D2B\u6216\u7C89\u8272\uFF1B\u66F4\u6539\u540E\u7ACB\u5373\u751F\u6548\uFF0C\u91CD\u542F\u540E\u4FDD\u7559\u3002"] as const, ["settings", "\u5B57\u4F53\u4E0E\u6708\u5386", "\u8FDB\u5165\u300C\u8BBE\u7F6E \u2192 \u5916\u89C2\u4E0E\u684C\u9762 \u2192 \u5B57\u4F53\u4E0E\u6708\u5386\u300D\uFF0C\u72EC\u7ACB\u9009\u62E9\u5E94\u7528\u5B57\u4F53\u548C\u6708\u5386\u5C01\u9762\u5B57\u4F53\uFF0C\u4E5F\u53EF\u586B\u5199\u672C\u673A\u5DF2\u5B89\u88C5\u7684\u5B57\u4F53\u540D\u79F0\uFF1B\u6709\u9884\u89C8\uFF0C\u91CD\u542F\u540E\u4ECD\u4FDD\u7559\u3002"] as const, ["schedule", "\u5BFC\u5165\u8BFE\u8868", "\u8BBE\u7F6E \u2192 \u8BFE\u7A0B\u4E0E\u6392\u7A0B\uFF1A\u590D\u5236\u63D0\u793A\u8BCD\uFF0C\u8BA9\u4F60\u5E38\u7528\u7684 AI \u8BC6\u522B\u8BFE\u8868\u56FE\u7247\uFF0C\u7C98\u8D34 JSON \u540E\u6821\u9A8C\u3001\u9884\u89C8\u3001\u786E\u8BA4\u5BFC\u5165\u3002\u676D\u7535\u7528\u6237\u53EF\u76F4\u63A5\u70B9\u65E5\u7A0B\u53F3\u4E0A\u89D2\u300C\u5BFC\u5165\u8BFE\u8868\u300D\uFF0C\u6253\u5F00\u676D\u7535\u52A9\u624B\u5E76\u767B\u5F55\uFF0C\u5728\u8BFE\u8868\u53F3\u4E0A\u89D2\u83DC\u5355\u590D\u5236\u300C\u8BA2\u9605\u8BFE\u8868\u300D\u94FE\u63A5\uFF0C\u7C98\u8D34\u5E76\u8BFB\u53D6\uFF0C\u6838\u5BF9\u540E\u786E\u8BA4\u3002\u5BFC\u5165\u4F1A\u66FF\u6362\u5F53\u524D\u8BFE\u7A0B\u8868\uFF1B\u8BFE\u7A0B\u53D8\u66F4\u540E\u53EF\u91CD\u65B0\u8BFB\u53D6\u66F4\u65B0\u3002\u8BFE\u7A0B\u4F1A\u76F4\u63A5\u663E\u793A\u5728\u65E5\u7A0B\u4E2D\uFF0C\u5B89\u6392\u4EFB\u52A1\u4F1A\u907F\u5F00\u8BFE\u7A0B\u3002"] as const, ["schedule", "\u5468\u89C6\u56FE\u4E0E\u8BFE\u8868\u6A21\u5F0F", "\u5468\u89C6\u56FE\u8BFE\u7A0B\u5361\u7247\u4F18\u5148\u663E\u793A\u8BFE\u7A0B\u540D\uFF0C\u7A7A\u95F4\u5145\u8DB3\u65F6\u663E\u793A\u8001\u5E08\u548C\u5730\u70B9\u3002\u70B9\u51FB\u8BFE\u7A0B\u5373\u53EF\u5C55\u5F00\u67E5\u770B\u5177\u4F53\u65F6\u95F4\u548C\u8282\u6570\uFF0C\u70B9\u51FB\u7A7A\u767D\u6216\u6309 Esc \u6536\u8D77\u3002\u300C\u8BFE\u8868\u6A21\u5F0F\u300D\u5728\u65E5\u7A0B\u8868\u548C\u5468\u89C6\u56FE\u4E0A\u6309\u300C\u5F00\u59CB\u65F6\u95F4\u3001\u6570\u5B57\u8282\u6B21\u3001\u7ED3\u675F\u65F6\u95F4\u300D\u4E0A\u4E0B\u663E\u793A\uFF0C\u53BB\u6389\u6574\u70B9\u523B\u5EA6\uFF0C\u8BFE\u7A0B\u4E0E\u4EFB\u52A1\u90FD\u4FDD\u7559\uFF1B\u5207\u6362\u89C6\u56FE\u4FDD\u6301\u5F00\u5173\u72B6\u6001\u3002\u672A\u63D0\u4F9B\u8282\u6B21\u4FE1\u606F\u7684\u901A\u7528\u8BA2\u9605\u4F1A\u8BF4\u660E\u7F16\u53F7\u8868\u793A\u5B9E\u9645\u65F6\u6BB5\u3002"] as const, ["expenses", "\u8BB0\u82B1\u9500", "\u8BB0\u5F55\u652F\u51FA\uFF0C\u67E5\u770B\u5206\u7C7B\u7EDF\u8BA1\u4E0E\u9884\u7B97\u3002"] as const, ["habits", "\u575A\u6301\u4E60\u60EF", "\u521B\u5EFA\u81EA\u5DF1\u7684\u4E60\u60EF\uFF0C\u6BCF\u5929\u5B8C\u6210\u540E\u6253\u5361\u3002"] as const].map(([icon, label, hint]) => <div key={label}><AppIcon name={icon}></AppIcon><strong>{label}</strong><span>{hint}</span></div>)}</div><div className="intro-note">{"\u8F6F\u4EF6\u9ED8\u8BA4\u6253\u5F00\u65E5\u7A0B\uFF0Chome \u5728\u5BFC\u822A\u6700\u4E0A\u65B9\u3002\u4E2A\u4EBA\u8BB0\u5F55\u4FDD\u5B58\u5728\u8FD9\u53F0\u7535\u8111\u4E0A\uFF0C\u65E0\u9700\u6CE8\u518C\u8D26\u53F7\u3002\u6BCF\u65E5\u540D\u8A00\u4F1A\u5C1D\u8BD5\u8054\u7F51\u83B7\u53D6\u3002"}</div></>}{step === 1 && <div className="intro-preferences"><p className="intro-note">任务保存后留在任务栏，在日程页选择日期并拖入空闲节次。</p><label><div><strong>{"\u5F00\u673A\u81EA\u52A8\u8FD0\u884C"}</strong><span>{"\u767B\u5F55 Windows \u540E\u542F\u52A8 ColDesk\u3002"}</span></div><input type="checkbox" checked={autoLaunch} onChange={e => setAutoLaunch(e.target.checked)}></input></label><label><div><strong>{"\u6BCF\u65E5\u6C47\u603B\u65F6\u95F4"}</strong><span>{"\u6C47\u603B\u5F53\u5929\u5B89\u6392\u548C\u5F85\u5B8C\u6210\u4EFB\u52A1\u3002"}</span></div><TimePicker className="input" value={digest} onChange={e => setDigest(e || "07:30")}/></label></div>}{step === 2 && <div className="intro-task"><label>{"\u4EFB\u52A1\u540D\u79F0"}<input className="input" maxLength={120} placeholder="例如：完成周末的阅读作业" value={title} onChange={e => setTitle(e.target.value)}></input></label><div className="intro-fields"><label>{"\u9884\u8BA1\u7528\u65F6\uFF08\u5206\u949F\uFF09"}<NumberStepper className="input" min={10} max={720} step={5} value={duration} onValueChange={value => setDuration(Number(value))}/></label></div><label>{"\u622A\u6B62\u65F6\u95F4\uFF08\u53EF\u9009\uFF09"}<input className="input" type="datetime-local" value={due} onChange={e => setDue(e.target.value)}></input></label><p className="intro-note">所有待办统一保存在任务列表，需要安排时再拖入日程。</p></div>}{step === 3 && <><div className="intro-summary"><span>{"\u4EFB\u52A1\u5B89\u6392\u65B9\u5F0F"}</span><strong>手动安排</strong><span>{"\u6BCF\u65E5\u6C47\u603B"}</span><strong>{digest}</strong><span>{"\u5F00\u673A\u81EA\u52A8\u8FD0\u884C"}</span><strong>{autoLaunch ? "\u5F00\u542F" : "\u5173\u95ED"}</strong>{title.trim() && <><span>{"\u7B2C\u4E00\u9879\u4EFB\u52A1"}</span><strong>{title.trim()}</strong></>}</div><div className="intro-tips"><h2>{"\u7528\u597D\u684C\u9762\u60AC\u6D6E\u7A97"}</h2><p>{"\u62D6\u52A8\u9876\u90E8\u53EF\u79FB\u52A8\uFF0C\u677E\u624B\u540E\u4FDD\u5B58\u4F4D\u7F6E\u3002\u8BBE\u7F6E \u2192 \u5916\u89C2\u4E0E\u684C\u9762 \u2192 \u684C\u9762\u5F62\u6001\u53EF\u9009\u62E9\u7075\u52A8\u5C9B\uFF1A\u60AC\u505C\u5C55\u5F00\u65E5\u7A0B\u3001\u79FB\u5F00\u6536\u8D77\uFF0C\u63D0\u9192\u65F6\u5E73\u6ED1\u5F39\u5F00\u3002\u5173\u95ED\u4E3B\u7A97\u53E3\u540E\u8F6F\u4EF6\u4ECD\u5728\u6258\u76D8\u8FD0\u884C\uFF0C\u53F3\u952E\u6258\u76D8\u56FE\u6807\u53EF\u4EE5\u9000\u51FA\u3002"}</p></div><div className="intro-tips"><h2>任务与一次提醒</h2><p>同一任务可以自由分成多段，在任务详情里修改日期、起止时间或增删分段，日程按时间先后显示①②③。所有任务统一管理，不再区分学习或生活。新建日程的起止时间留空；只填写开始时间、不填写结束时间，即在该时间提醒一次，不占用时间段。填写结束时间则保存为时间段日程。</p></div><div className="intro-tips"><h2>按习惯打开应用</h2><p>设置 → 通用可切换中文、英语和日语，调整导航顺序和启动页面。启动提醒会自动收起，可随时关闭，无需确认。日记与记账可添加双向关联，加密日记仍需解锁。</p></div><div className="intro-tips"><h2>长期方向与分支</h2><p>长期任务点击后打开方向手册，用分支旁的加号逐级细分。开启量化目标后可更新数量，在月历中查看每天的变化；完成时记录时间，也能关联日记。设为主任务后，每次进入长期直接打开该方向手册。</p></div><div className="intro-replay"><h2>{"\u4EE5\u540E\u60F3\u518D\u6B21\u89C2\u770B\u6559\u7A0B\uFF1F"}</h2><p className="intro-replay-path">{"\u8BBE\u7F6E \u2192 \u4F7F\u7528\u5E2E\u52A9 \u2192 \u91CD\u65B0\u67E5\u770B\u5F15\u5BFC"}</p><p>{"\u5728 home \u4E2D\uFF0C\u5148\u70B9\u5DE6\u4E0B\u89D2\u7684\u4E09\u6A2A\u6760\u5C55\u5F00\u5BFC\u822A\uFF0C\u518D\u8FDB\u5165\u8BBE\u7F6E\u3002\u300C\u4F7F\u7528\u5E2E\u52A9\u300D\u4E2D\u4E5F\u80FD\u968F\u65F6\u67E5\u9605\u5404\u9879\u529F\u80FD\u7684\u64CD\u4F5C\u8BF4\u660E\u3002"}</p></div></>}{error && <p className="intro-error" role="alert">{error}</p>}</div><footer className="intro-footer">{step === 3 && <p className="intro-replay-hint">{"\u518D\u6B21\u89C2\u770B\u6559\u7A0B\uFF1A\u8BBE\u7F6E \u2192 \u4F7F\u7528\u5E2E\u52A9 \u2192 \u91CD\u65B0\u67E5\u770B\u5F15\u5BFC"}</p>}<button className="ghost-btn" disabled={busy} onClick={() => void finish(true)}>{replay ? "\u5173\u95ED\u5F15\u5BFC" : "\u6682\u65F6\u8DF3\u8FC7"}</button><div>{step > 0 && <button className="ghost-btn lg" disabled={busy} onClick={() => { setError(""); setStep(step - 1); }}>{"\u4E0A\u4E00\u6B65"}</button>}<button className="primary-btn lg" disabled={busy} onClick={() => {
            if (step === 2 && (duration < 10 || duration > 720 || !Number.isFinite(duration))) {
                setError("\u9884\u8BA1\u7528\u65F6\u8BF7\u586B\u5199 10\u2013720 \u5206\u949F\u3002");
                return;
            }
            if (step < 3) {
                setError("");
                setStep(step + 1);
            }
            else
                void finish(false);
        }}>{busy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : step === 3 ? "\u5F00\u59CB\u4F7F\u7528" : "\u4E0B\u4E00\u6B65"}</button></div></footer></section></div>;
}
