import * as React from 'react';
import {ControlIcon} from './ControlIcon';
import {useEffect,useId,useRef,useState} from 'react';
import {homeMonthDays,shiftHomeMonth,validHomeDate} from '@shared/home';
import {currentLanguage,t} from '@shared/i18n';
import {addDays,today} from '@shared/time';

/** A top-layer calendar stays visible inside the scrolling task editor. */
export function DeadlineDatePicker({value,onChange,disabled=false}:{value:string;onChange:(date:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 const selected=validHomeDate(value)?value:today();
 const close=()=>{setOpen(false);window.requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));};
 return <div className="deadline-date-control"><button ref={trigger} type="button" className="input deadline-date-trigger" aria-label="选择截止日期" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(true)}><ControlIcon name="calendar"/><span>{new Intl.DateTimeFormat(currentLanguage(),{year:'numeric',month:'short',day:'numeric',weekday:'short'}).format(new Date(selected+'T12:00'))}</span><ControlIcon name="down"/></button>{open&&!disabled&&<DeadlineCalendar value={selected} anchor={trigger} onChange={date=>{onChange(date);close();}} onClose={close}/>}</div>;
}

function DeadlineCalendar({value,anchor,onChange,onClose}:{value:string;anchor:React.RefObject<HTMLButtonElement>;onChange:(date:string)=>void;onClose:()=>void}){
 const [month,setMonth]=useState(value.slice(0,7)),dialog=useRef<HTMLDialogElement>(null),title=useId();
 useEffect(()=>{
  const element=dialog.current!;
  element.showModal();
  const position=()=>{
   const rect=anchor.current?.getBoundingClientRect();if(!rect)return;
   const size=element.getBoundingClientRect(),gap=8;
   element.style.left=Math.max(gap,Math.min(rect.left,window.innerWidth-size.width-gap))+'px';
   const below=rect.bottom+gap;
   element.style.top=Math.max(gap,Math.min(below+size.height<=window.innerHeight-gap?below:rect.top-size.height-gap,window.innerHeight-size.height-gap))+'px';
  };
  position();element.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({preventScroll:true});
  const observer=new ResizeObserver(position);observer.observe(element);
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);element.close();};
 },[anchor]);
 return <dialog ref={dialog} className="deadline-calendar" aria-labelledby={title} onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}} onClick={event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
  <header><h3 id={title}>选择截止日期</h3><button type="button" className="icon-btn" aria-label="关闭日历" onClick={onClose}><ControlIcon name="close"/></button></header>
  <div className="deadline-calendar-month"><button type="button" className="icon-btn" aria-label="上个月" disabled={month==='0001-01'} onClick={()=>setMonth(shiftHomeMonth(month,-1))}><ControlIcon name="left"/></button><input type="month" aria-label="选择月份" value={month} min="0001-01" max="9999-12" onChange={event=>{if(event.target.validity.valid&&validHomeDate(event.target.value+'-01'))setMonth(event.target.value);}}/><button type="button" className="icon-btn" aria-label="下个月" disabled={month==='9999-12'} onClick={()=>setMonth(shiftHomeMonth(month,1))}><ControlIcon name="right"/></button></div>
  <div className="deadline-calendar-weekdays">{Array.from({length:7},(_,i)=><span key={i}>{new Intl.DateTimeFormat(currentLanguage(),{weekday:'short'}).format(new Date(2026,9,12+i))}</span>)}</div>
  <div className="deadline-calendar-days">{homeMonthDays(month).map((date,index)=>date?<button type="button" key={date} data-date={date} className={date===today()?'is-today':''} aria-label={date} aria-pressed={date===value} onClick={()=>onChange(date)}>{Number(date.slice(-2))}</button>:<span key={index}/>)}</div>
  <footer>{[0,1,7].map((days,index)=><button type="button" className="ghost-btn" key={days} onClick={()=>onChange(addDays(today(),days))}>{[t('今天'),t('明天'),t('一周后')][index]}</button>)}</footer>
 </dialog>;
}
