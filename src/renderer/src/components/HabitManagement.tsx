import * as React from 'react';
import {useState,type RefObject} from 'react';
import type {Habit} from '@shared/habit';
import type {HabitView} from '@shared/view';
import {t} from '@shared/i18n';
import {getApi} from '../lib/api';
import {userError} from '../lib/userError';
import {HabitIconPicker} from './HabitIconPicker';

export function HabitManagement({habit,inputRef}:{habit:HabitView;inputRef:RefObject<HTMLInputElement>}){
 const [name,setName]=useState(''),[icon,setIcon]=useState('⭐'),[error,setError]=useState('');
 const [editingId,setEditingId]=useState<string|null>(null),[editingName,setEditingName]=useState('');
 const [expanded,setExpanded]=useState(false),[archivedOpen,setArchivedOpen]=useState(false),[busy,setBusy]=useState(false);
 const active=habit.habits,archived=habit.archivedHabits??[];
 const perform=async(channel:string,payload:unknown)=>{
  setBusy(true);setError('');
  try{await getApi().invoke(channel,payload);}catch(e){setError(userError(e,'操作失败'));throw e;}finally{setBusy(false);}
 };
 const editIcon=(h:Habit,next:string)=>perform('habit:update',{id:h.id,icon:next});
 const rename=async()=>{if(!editingName.trim()){setError('习惯名不能为空');return;}try{await perform('habit:update',{id:editingId,name:editingName});setEditingId(null);}catch{}};
 const archive=async(h:Habit)=>{try{await perform('habit:update',{id:h.id,archived:true});setArchivedOpen(true);}catch{}};
 const restore=async(h:Habit)=>{try{await perform('habit:update',{id:h.id,archived:false});setExpanded(true);}catch{}};
 const remove=async(h:Habit)=>{if(!window.confirm(t('删除“{0}”及其打卡记录？此操作无法撤销。',[h.name])))return;try{await perform('habit:remove',{id:h.id});}catch{}};
 const create=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;if(!name.trim()){setError('习惯名不能为空');return;}try{await perform('habit:add',{name,icon,activeDays:[]});setName('');}catch{}};
 return <section className="panel habit-manage-panel">
  <div className="panel-head"><span className="t-title">我的习惯</span><div className="row"><span className="t-caption">{t('{0} 个进行中',[active.length])}</span>{active.length>0&&<button type="button" className="ghost-btn habit-manage-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'收起管理':'管理'}</button>}</div></div>
  {error&&<div className="editor-message error" role="alert">{error}</div>}
  {expanded&&active.length>0&&<ul className="habit-list">{active.map(h=><li className="habit-row" data-habit-id={h.id} key={h.id}>
   <HabitIconPicker value={h.icon} label={t('更换“{0}”的图标',[h.name])} disabled={busy} onChange={next=>editIcon(h,next)}/>
   {editingId===h.id?<><input className="input narrow" aria-label="习惯名称" maxLength={20} value={editingName} disabled={busy} onChange={e=>setEditingName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void rename();}}}/><button type="button" className="primary-btn" disabled={busy} onClick={()=>void rename()}>保存</button><button type="button" className="ghost-btn" disabled={busy} onClick={()=>setEditingId(null)}>取消</button></>:<><span className="grow t-body">{h.name}</span><span className="t-caption">{weekLabel(h)}</span><button type="button" className="ghost-btn" disabled={busy} onClick={()=>{setEditingId(h.id);setEditingName(h.name);}}>改名</button><button type="button" className="ghost-btn" disabled={busy} title="收起习惯并保留打卡记录，可在下方已归档中恢复" onClick={()=>void archive(h)}>归档</button><button type="button" className="icon-btn" disabled={busy} aria-label={t('删除习惯：{0}',[h.name])} title="删除习惯（其签到记录会一并删除）" onClick={()=>void remove(h)}>×</button></>}
  </li>)}</ul>}
  {active.length===0&&<div className="t-caption">还没有进行中的习惯，可以新建，或从下方已归档中恢复。</div>}
  <form className="row budget-total-row habit-create-form" onSubmit={e=>void create(e)}>
   <HabitIconPicker value={icon} label="选择新习惯图标" disabled={busy} onChange={setIcon}/>
   <input className="input narrow" ref={inputRef} aria-label="新习惯名" placeholder="新习惯名" maxLength={20} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/>
   <button type="submit" className="ghost-btn" disabled={busy}>{busy?'正在保存…':'＋ 加习惯'}</button>
  </form>
  <p className="t-caption habit-manage-help">新习惯默认每天打卡。点击左侧图标可选择 20 个常用图标；已有习惯可在「管理」中更换。</p>
  <details className="habit-archive" open={archivedOpen} onToggle={e=>setArchivedOpen(e.currentTarget.open)}>
   <summary><span>已归档</span><span className="habit-archive-count">{archived.length}</span><i aria-hidden="true">⌄</i></summary>
   <div className="habit-archive-body"><p className="t-caption">归档会移出日常打卡列表和当前统计，原打卡记录仍保留。恢复后可继续打卡，并重新查看历史记录。</p>
    {archived.length?<ul className="habit-archive-list">{archived.map(h=><li className="habit-row" data-archived-habit-id={h.id} key={h.id}><span className="habit-archived-icon" aria-hidden="true">{h.icon}</span><span className="grow t-body">{h.name}</span><button type="button" className="ghost-btn" disabled={busy} onClick={()=>void restore(h)}>恢复到打卡</button></li>)}</ul>:<p className="t-caption habit-archive-empty">暂无已归档习惯</p>}
   </div>
  </details>
 </section>;
}
function weekLabel(h:Habit):string{
 if(h.activeDays.length===0)return t('每天');
 return t('周')+h.activeDays.map(day=>t(['一','二','三','四','五','六','日'][day-1])).join('·');
}
