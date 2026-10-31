import * as React from 'react';
import {useEffect,useMemo,useRef,useState} from 'react';
import {goalPercent,type GoalNode,type GoalProgressMonth} from '@shared/goals';
import {homeMonthDays,shiftHomeMonth} from '@shared/home';
import {currentLanguage,t} from '@shared/i18n';
import {today} from '@shared/time';
import {getApi} from '../lib/api';
import {userError} from '../lib/userError';

export const goalAmount=(value:number)=>new Intl.NumberFormat(currentLanguage(),{maximumFractionDigits:3}).format(value);
const rounded=(value:number)=>Math.round(value*1000)/1000;
export function GoalProgressBar({node}:{node:GoalNode}){
 const percent=goalPercent(node);
 return <span className="goal-progress-bar"><span className="goal-progress-label"><strong>{goalAmount(node.currentAmount)} <small>/ {goalAmount(node.targetAmount??0)} {node.unit}</small></strong><span>{goalAmount(Math.round(percent*10)/10)}%</span></span><span className="goal-progress-track" role="progressbar" aria-label={node.title} aria-valuemin={0} aria-valuemax={node.targetAmount??1} aria-valuenow={Math.min(node.currentAmount,node.targetAmount??1)}><span style={{width:`${percent}%`}}/></span></span>;
}
export function GoalProgressDialog({node,busy,onClose,onRecord}:{node:GoalNode;busy:boolean;onClose:()=>void;onRecord:(payload:unknown)=>Promise<boolean>}){
 const ref=useRef<HTMLDialogElement|null>(null),request=useRef(0),[month,setMonth]=useState(today().slice(0,7)),[date,setDate]=useState(today()),[mode,setMode]=useState<'add'|'total'>('add');
 const [quantity,setQuantity]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false),[data,setData]=useState<GoalProgressMonth|null>(null),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 useEffect(()=>{ref.current?.showModal();},[]);
 useEffect(()=>{const seq=++request.current;setLoading(true);setData(null);setError('');void getApi().invoke('goals:progressMonth',{id:node.id,month}).then(value=>{if(seq===request.current)setData(value as GoalProgressMonth);}).catch(e=>{if(seq===request.current)setError(userError(e,'暂时无法读取进度，请重试。'));}).finally(()=>{if(seq===request.current)setLoading(false);});return()=>{request.current++;};},[node.id,node.currentAmount,month,retry]);
 const daily=useMemo(()=>{const amounts=new Map<string,number>();for(const entry of data?.entries??[])amounts.set(entry.date,rounded((amounts.get(entry.date)??0)+entry.delta));return amounts;},[data]);
 const selected=data?.entries.filter(entry=>entry.date===date)??[],net=rounded([...daily.values()].reduce((sum,value)=>sum+value,0));
 const cumulative=rounded((data?.openingAmount??0)+(data?.entries.filter(entry=>entry.date<=date).reduce((sum,entry)=>sum+entry.delta,0)??0));
 const maxChange=Math.max(1,...[...daily.values()].map(Math.abs)),days=homeMonthDays(month);
 const changeMonth=(delta:number)=>{const next=shiftHomeMonth(month,delta);setMonth(next);setDate(next===today().slice(0,7)?today():`${next}-01`);setSaved(false);};
 const signed=(value:number)=>(value>0?'+':'')+goalAmount(value);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setError('');setSaved(false);try{const ok=await onRecord({id:node.id,date,mode,amount:Number(quantity),note,requestId:crypto.randomUUID()});if(ok){setQuantity('');setNote('');setSaved(true);setRetry(value=>value+1);}else setError(t('暂时无法保存进度，请检查页面提示后重试。'));}catch(e){setError(userError(e,'暂时无法保存进度，请重试。'));}};
 return <dialog className="goal-editor-dialog goal-progress-dialog" ref={ref} aria-labelledby="goal-progress-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header className="row-between"><div><p className="goal-eyebrow">量化分支 / 每日足迹</p><h2 id="goal-progress-title">{node.title}</h2></div><button className="icon-btn" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
  <div className="goal-progress-overview"><GoalProgressBar node={node}/><p className="t-caption">达到目标且下级分支完成后，会自动标记完成。</p></div>
  <div className="goal-progress-layout"><section className="goal-progress-calendar"><header className="row-between"><button className="icon-btn" aria-label="上个月" disabled={busy||month==='0001-01'} onClick={()=>changeMonth(-1)}>‹</button><h3>{new Intl.DateTimeFormat(currentLanguage(),{year:'numeric',month:'long'}).format(new Date(`${month}-01T12:00:00`))}</h3><button className="icon-btn" aria-label="下个月" disabled={busy||month>=today().slice(0,7)} onClick={()=>changeMonth(1)}>›</button></header>
   <div className="goal-progress-weekdays">{['一','二','三','四','五','六','日'].map((day,index)=><span key={day}>{new Intl.DateTimeFormat(currentLanguage(),{weekday:'short'}).format(new Date(2026,9,12+index))}</span>)}</div>
   <div className="goal-progress-days" aria-label="每日进度月历" aria-busy={loading}>{days.map((day,index)=>day?<button key={day} className={`goal-progress-day${date===day?' selected':''}${day===today()?' today':''}${daily.has(day)?' recorded':''}`} data-date={day} aria-pressed={date===day} disabled={busy||loading||day>today()} onClick={()=>{setDate(day);setSaved(false);}} style={{'--day-fill':`${Math.min(.32,.06+Math.abs(daily.get(day)??0)/maxChange*.26)}`} as React.CSSProperties}><time dateTime={day}>{Number(day.slice(-2))}</time>{daily.has(day)?<strong>{signed(daily.get(day)!)}<small>{node.unit}</small></strong>:<span aria-hidden="true">·</span>}</button>:<span key={`empty-${index}`}/>)}</div>
   {loading?<p className="t-caption" role="status">正在读取…</p>:data&&<p className="t-caption goal-month-stats">{t('本月净增加 {0} · 记录 {1} 天',[`${signed(net)} ${node.unit}`,daily.size])}</p>}
   <button className="ghost-btn" disabled={busy} onClick={()=>{setMonth(today().slice(0,7));setDate(today());}}>回到今天</button>
  </section><section className="goal-progress-entry"><h3>{date}</h3><p className="t-caption">{t('当天结束累计 {0}',[`${goalAmount(cumulative)} ${node.unit}`])}</p>
   <form onSubmit={e=>void submit(e)}><label>更新方式<select className="input" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as 'add'|'total');setQuantity('');setSaved(false);}}><option value="add">本次增加</option><option value="total">修改当前累计</option></select></label><label>{mode==='add'?'增加数量':'当前累计数量'}<div className="goal-quantity-input"><input className="input" type="number" min={mode==='add'?'0.001':'0'} max="1000000000" step="0.001" required value={quantity} disabled={busy} onChange={e=>{setQuantity(e.target.value);setSaved(false);}}/><span>{node.unit}</span></div></label><label>备注（可选）<input className="input" maxLength={500} disabled={busy} value={note} onChange={e=>setNote(e.target.value)} placeholder="今天的小小进展…"/></label>
    <p className="t-caption">{mode==='add'?'增加量记在选中的日期；可以补记过去的进度。':'填写目前的总数量，差额记在选中的日期；可用于修正记录。'}</p><button className="primary-btn" disabled={busy||loading||!data||quantity===''}>{busy?'正在保存…':'保存进度'}</button>{saved&&<p className="goal-progress-saved" role="status">已记录进度</p>}
   </form>
   {error&&<p className="goal-error" role="alert">{error}<button className="ghost-btn" onClick={()=>setRetry(value=>value+1)}>重试</button></p>}
   <div className="goal-daily-records"><h4>当日记录</h4>{!loading&&!selected.length&&<p className="t-caption">这一天还没有记录</p>}{selected.slice().reverse().map(entry=><article key={entry.id}><div><strong>{signed(entry.delta)} {entry.unit}</strong><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat(currentLanguage(),{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(entry.createdAt))}</time></div>{entry.note&&<p>{entry.note}</p>}</article>)}</div>
  </section></div>
 </dialog>;
}
