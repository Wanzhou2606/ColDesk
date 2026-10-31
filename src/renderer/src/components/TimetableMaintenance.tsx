import { useEffect, useRef, useState } from 'react';
import { getApi } from '../lib/api';
import { userError } from '../lib/userError';
import { t } from '../lib/i18n';

type Current = { semester: { id:string; name:string } | null; count:number };

export function TimetableMaintenance({ courses }: { courses:Array<{id:string}> }) {
  const courseIds = courses.map(course=>course.id).join(',');
  const [current,setCurrent] = useState<Current | null>(null);
  const [target,setTarget] = useState<Current | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const pending = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    void getApi().invoke('timetable:current').then(value => { if(active)setCurrent(value as Current); }).catch(e => { if(active)setError(userError(e,t('暂时无法读取当前课表，请稍后重试。'))); });
    return () => { active=false; };
  },[courseIds]);
  useEffect(() => { if(target && !dialog.current?.open)dialog.current?.showModal(); },[target]);
  const remove = async () => {
    if(pending.current || !target?.semester)return;
    pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await getApi().invoke('timetable:delete',{semesterId:target.semester.id});
      setCurrent(await getApi().invoke('timetable:current') as Current);
      setMessage(t('当前课表已删除，删除前已自动备份。'));
      dialog.current?.close();setTarget(null);
    } catch(e) { setError(userError(e,t('课表未能删除，请稍后重试。'))); }
    finally { pending.current=false;setBusy(false); }
  };
  return <section className="panel timetable-maintenance">
    <div className="panel-head"><span className="t-title">{t('当前课表')}</span><span className="t-caption">{current?.count ?? 0} {t('门课程')}</span></div>
    <p>{current?.count ? current.semester?.name : t('还没有课程，可以从下方导入。')}</p>
    <p className="t-caption">{t('删除课程与调课安排，保留节次时间、任务、日记、打卡和记账。删除前会自动备份。')}</p>
    <button className="ghost-btn danger" disabled={!current?.count || busy} onClick={() => { setError('');setMessage('');setTarget(current); }}>{t('删除当前课表')}</button>
    {message && <p role="status" className="editor-message">{message}</p>}
    {error && !target && <p role="alert" className="editor-message error">{error}</p>}
    {target && <dialog className="import-result-dialog timetable-delete-dialog" ref={dialog} aria-labelledby="timetable-delete-title" onCancel={e => { if(pending.current)e.preventDefault(); }} onClose={() => { if(!pending.current)setTarget(null); }}>
      <h2 id="timetable-delete-title">{t('删除当前课表？')}</h2><p>{target.semester?.name}</p>
      <p>{t('将删除 {0} 门课程及其上课、调课安排。任务、日记等个人记录会保留。',[target.count])}</p>
      <p className="t-caption">{t('删除前会自动备份，可在「数据」中打开备份文件夹。')}</p>
      {error && <p role="alert" className="editor-message error">{error}</p>}
      <div className="row"><button className="ghost-btn" disabled={busy} autoFocus onClick={() => dialog.current?.close()}>{t('取消')}</button><button className="ghost-btn danger" disabled={busy} onClick={() => void remove()}>{busy ? t('正在删除…') : t('确认删除')}</button></div>
    </dialog>}
  </section>;
}
