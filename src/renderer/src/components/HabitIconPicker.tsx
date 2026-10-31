import * as React from 'react';
import {useEffect,useRef,useState} from 'react';
import {HABIT_ICONS} from '@shared/habitIcons';
import {t} from '@shared/i18n';
import {userError} from '../lib/userError';

export function HabitIconGrid({value,onChange,disabled=false}:{value:string;onChange:(icon:string)=>void;disabled?:boolean}){
 return <div className="habit-icon-grid" role="group" aria-label="20 个常用打卡图标">{HABIT_ICONS.map(option=><button type="button" className={'habit-icon-option'+(value===option.icon?' selected':'')} key={option.icon} data-habit-icon={option.icon} aria-pressed={value===option.icon} disabled={disabled} onClick={()=>onChange(option.icon)}><span aria-hidden="true">{option.icon}</span><small>{option.label}</small></button>)}</div>;
}
export function HabitIconPicker({value,label,onChange,disabled=false}:{value:string;label:string;onChange:(icon:string)=>void|Promise<void>;disabled?:boolean}){
 const [open,setOpen]=useState(false),button=useRef<HTMLButtonElement>(null);
 const close=()=>{setOpen(false);window.requestAnimationFrame(()=>button.current?.focus({preventScroll:true}));};
 return <><button ref={button} type="button" className="habit-icon-picker" aria-label={label} title={label} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(true)}><span aria-hidden="true">{value}</span><small aria-hidden="true">⌄</small></button>{open&&<HabitIconDialog value={value} onChange={onChange} onClose={close}/>}</>;
}
function HabitIconDialog({value,onChange,onClose}:{value:string;onChange:(icon:string)=>void|Promise<void>;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 const choose=async(icon:string)=>{if(busy)return;setBusy(true);setError('');try{await onChange(icon);onClose();}catch(e){setError(userError(e,'图标未保存，请重试。'));}finally{setBusy(false);}};
 return <dialog ref={dialog} className="habit-icon-dialog" aria-labelledby="habit-icon-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
  <header><div><h2 id="habit-icon-title">选择打卡图标</h2><p>选一个符合你习惯的小图标。</p></div><button className="icon-btn" type="button" aria-label="关闭图标选择" disabled={busy} onClick={onClose}>×</button></header>
  <HabitIconGrid value={value} onChange={icon=>void choose(icon)} disabled={busy}/>
  <footer>{error?<p role="alert">{error}</p>:<span>{busy?t('正在保存…'):t('20 个常用类型，点击即可选择')}</span>}</footer>
 </dialog>;
}
