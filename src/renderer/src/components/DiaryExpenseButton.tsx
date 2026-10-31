import * as React from 'react';
import {useEffect,useRef,useState} from 'react';
import {JournalLinks} from './JournalLinks';
import {AppIcon} from './AppIcon';
export function DiaryExpenseButton({date,onOpenExpense,allowOpenLedger=false}:{date:string;allowOpenLedger?:boolean;onOpenExpense?:(id:string,date:string)=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>setOpen(false),[date]);
 useEffect(()=>{
  if(!open)return;
  root.current?.querySelector<HTMLSelectElement>('.diary-expense-popover select')?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
 },[open]);
 return <div className="diary-expense-corner" ref={root}>
  {open&&<div className="diary-expense-popover" role="dialog" aria-label="关联记账"><button type="button" className="icon-btn diary-expense-close" aria-label="关闭记账关联" onClick={()=>{setOpen(false);button.current?.focus();}}>×</button><JournalLinks diaryDate={date} onOpenExpense={onOpenExpense}/>{allowOpenLedger&&onOpenExpense&&<button type="button" className="ghost-btn diary-open-expenses" onClick={()=>onOpenExpense('',date)}>打开记账</button>}</div>}
  <button type="button" className="diary-expense-button" ref={button} aria-expanded={open} aria-label="关联记账" onClick={()=>setOpen(v=>!v)}><AppIcon name="expenses"/><span>记账</span></button>
 </div>;
}
