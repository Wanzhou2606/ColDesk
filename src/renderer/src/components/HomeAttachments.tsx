import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { HomeAttachment } from '@shared/home';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
export type HomePhotoItem = HomeAttachment & {
    date: string;
    title?: string;
};
function Photo({ item }: {
    item: HomePhotoItem;
}) {
    const [url, setUrl] = useState(''), [error, setError] = useState(false), ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        let active = true, requested = false;
        const observer = new IntersectionObserver(entries => {
            if (requested || !entries.some(e => e.isIntersecting))
                return;
            requested = true;
            observer.disconnect();
            void getApi().invoke('home:attachmentRead', { date: item.date, id: item.id }).then(value => {
                if (active)
                    setUrl((value as {
                        url: string;
                    }).url);
            }).catch(() => {
                if (active)
                    setError(true);
            });
        }, { rootMargin: '180px' });
        if (ref.current)
            observer.observe(ref.current);
        return () => { active = false; observer.disconnect(); };
    }, [item.id, item.date]);
    return <span className="home-photo-image" ref={ref}>{url ? <img src={url} alt={item.name}></img> : <span>{error ? "\u7167\u7247\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6" : "\u52A0\u8F7D\u7167\u7247\u2026"}</span>}</span>;
}
export function HomePhotos({ items, onOpenDiary, onRemove, disabled = false }: {
    items: HomePhotoItem[];
    onOpenDiary?: (date: string) => void;
    onRemove?: (id: string) => void;
    disabled?: boolean;
}) {
    const [index, setIndex] = useState<number | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), dialog = useRef<HTMLDialogElement>(null);
    const selected = index === null ? undefined : items[index];
    useEffect(() => {
        if (selected && !dialog.current?.open)
            dialog.current?.showModal();
        if (!selected && dialog.current?.open)
            dialog.current?.close();
    }, [selected]);
    const save = async () => {
        if (!selected || busy)
            return;
        setBusy(true);
        setMessage('');
        try {
            const result = await getApi().invoke('home:attachmentExport', { date: selected.date, id: selected.id }) as {
                canceled: boolean;
            };
            if (!result.canceled)
                setMessage('原图已导出');
        }
        catch (e) {
            setMessage(userError(e, '暂时无法导出照片'));
        }
        finally {
            setBusy(false);
        }
    };
    return <><div className="home-photo-grid">{items.map((item, i) => <article className="home-photo-card" key={item.id}><button className="home-photo-open" aria-label={"\u67E5\u770B\u7167\u7247 " + item.name} onClick={() => { setIndex(i); setMessage(""); }}><Photo item={item}></Photo><span className="home-photo-caption"><strong>{item.title || item.name}</strong><small>{item.date}</small></span></button>{onRemove && <button className="home-photo-remove" disabled={disabled} aria-label={"\u79FB\u9664\u7167\u7247 " + item.name} onClick={() => onRemove(item.id)}>{"\u00D7"}</button>}</article>)}</div><dialog className="home-photo-dialog" ref={dialog} onClose={() => setIndex(null)} onCancel={e => {
            if (busy)
                e.preventDefault();
        }} onKeyDown={e => {
            if (busy)
                return;
            if (e.key === "ArrowRight")
                setIndex(i => i === null ? null : (i + 1) % items.length);
            if (e.key === "ArrowLeft")
                setIndex(i => i === null ? null : (i + items.length - 1) % items.length);
        }}>{selected && <><header><div><strong>{selected.name}</strong><span>{selected.date}{" \u00B7 "}{index! + 1}{" / "}{items.length}</span></div><button className="ghost-btn" disabled={busy} onClick={() => setIndex(null)} aria-label="关闭照片">{"\u00D7"}</button></header><div className="home-photo-large"><Photo item={selected} key={selected.id}></Photo></div><footer><div className="row"><button className="ghost-btn" disabled={busy || items.length < 2} onClick={() => setIndex((index! + items.length - 1) % items.length)}>{"\u4E0A\u4E00\u5F20"}</button><button className="ghost-btn" disabled={busy || items.length < 2} onClick={() => setIndex((index! + 1) % items.length)}>{"\u4E0B\u4E00\u5F20"}</button></div><div className="row">{onOpenDiary && <button className="ghost-btn" disabled={busy} onClick={() => { setIndex(null); onOpenDiary(selected.date); }}>{"\u6253\u5F00\u8FD9\u5929\u65E5\u8BB0"}</button>}<button className="primary-btn" disabled={busy} onClick={() => void save()}>{busy ? "\u6B63\u5728\u5BFC\u51FA\u2026" : "\u5BFC\u51FA\u539F\u56FE"}</button></div></footer>{message && <p role="status">{message}</p>}</>}</dialog></>;
}
export function HomeFiles({ items, date, onRemove, disabled }: {
    items: HomeAttachment[];
    date: string;
    onRemove: (id: string) => void;
    disabled: boolean;
}) {
    const [error, setError] = useState(''), [busy, setBusy] = useState('');
    const save = async (id: string) => {
        setBusy(id);
        setError('');
        try {
            await getApi().invoke('home:attachmentExport', { date, id });
        }
        catch (e) {
            setError(userError(e, '无法导出附件'));
        }
        finally {
            setBusy('');
        }
    };
    return <><div className="home-file-list">{items.map(item => <article key={item.id}><span className="home-file-icon" aria-hidden="true">{"\u2197"}</span><div><strong>{item.name}</strong><small>{item.size >= 1024 * 1024 ? (item.size / 1024 / 1024).toFixed(1) + " MB" : Math.ceil(item.size / 1024) + " KB"}</small></div><button className="ghost-btn" disabled={disabled || !!busy} onClick={() => void save(item.id)}>{busy === item.id ? "\u5BFC\u51FA\u4E2D\u2026" : "\u5BFC\u51FA\u6587\u4EF6"}</button><button className="ghost-btn" disabled={disabled || !!busy} aria-label={"\u79FB\u9664\u6587\u4EF6 " + item.name} onClick={() => onRemove(item.id)}>{"\u79FB\u9664"}</button></article>)}</div>{error && <p className="home-error" role="alert">{error}</p>}</>;
}
