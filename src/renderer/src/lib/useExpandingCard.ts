import {useLayoutEffect,useRef,useState,type CSSProperties} from 'react';

/** Shared spring-like geometry animation for course and task cards. */
export function useExpandingCard(element:HTMLElement,onClose:()=>void,color:string,width:number,height:number,options:{focus?:boolean;anchor?:{x:number;y:number};verticalOnly?:boolean}={}){
 const panel=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null),animation=useRef<Animation|null>(null),alive=useRef(true),closing=useRef(false),[exiting,setExiting]=useState(false);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const origin=element.getBoundingClientRect(),computed=getComputedStyle(element);
 const surface=computed.getPropertyValue('--surface-raised')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'#273242':'#fffefd');
 const style={position:'fixed',left:origin.left,top:origin.top,width:origin.width,height:origin.height,fontFamily:computed.fontFamily,'--course-color':color,'--course-ink':computed.color,'--surface-raised':surface,'--accent':computed.getPropertyValue('--accent'),'--accent-soft':computed.getPropertyValue('--accent-soft'),'--border':computed.getPropertyValue('--border'),'--text-primary':computed.getPropertyValue('--text-primary'),'--text-secondary':computed.getPropertyValue('--text-secondary'),'--text-tertiary':computed.getPropertyValue('--text-tertiary')} as CSSProperties;
 const finish=()=>{if(!alive.current)return;closeRef.current();if(options.focus!==false)window.requestAnimationFrame(()=>{if(element.isConnected)element.focus({preventScroll:true});});};
 const dismiss=()=>{if(closing.current)return;closing.current=true;setExiting(true);const node=panel.current;
  if(!node||window.matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
  const from=node.getBoundingClientRect(),to=element.getBoundingClientRect();animation.current?.cancel();
  const next=node.animate([{left:`${from.left}px`,top:`${from.top}px`,width:`${from.width}px`,height:`${from.height}px`,borderRadius:options.verticalOnly?'16px':'24px'},{left:`${to.left}px`,top:`${to.top}px`,width:`${to.width}px`,height:`${to.height}px`,borderRadius:'12px'}],{duration:240,easing:'cubic-bezier(.32,0,.22,1)',fill:'forwards'});animation.current=next;void next.finished.then(finish).catch(()=>{});
 };
 const dismissRef=useRef(dismiss);dismissRef.current=dismiss;
 useLayoutEffect(()=>{
  alive.current=true;const node=panel.current!,original=element.getBoundingClientRect(),w=options.verticalOnly?original.width:Math.min(width,window.innerWidth-32),h=Math.min(Math.max(height,options.verticalOnly?original.height:0),window.innerHeight-32);
  const anchor=options.anchor;
  const desiredLeft=original.left+original.width/2-w/2,desiredTop=original.top+original.height/2-h/2;
  const left=options.verticalOnly?original.left:Math.max(16,Math.min(anchor?Math.max(anchor.x-w+24,Math.min(desiredLeft,anchor.x-24)):desiredLeft,window.innerWidth-w-16)),top=Math.max(16,Math.min(anchor?Math.max(anchor.y-h+24,Math.min(desiredTop,anchor.y-24)):desiredTop,window.innerHeight-h-16));
  const end={left:`${left}px`,top:`${top}px`,width:`${w}px`,height:`${h}px`,borderRadius:options.verticalOnly?'16px':'24px'};Object.assign(node.style,end);
  // Hover rows only stretch vertically, including the elastic overshoot.
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){const next=node.animate([{left:`${original.left}px`,top:`${original.top}px`,width:`${original.width}px`,height:`${original.height}px`,borderRadius:'12px'},{left:`${options.verticalOnly?left:left-3}px`,top:`${top-3}px`,width:`${options.verticalOnly?w:w+6}px`,height:`${h+6}px`,borderRadius:options.verticalOnly?'19px':'30px',offset:.76},end],{duration:options.verticalOnly?360:440,easing:'cubic-bezier(.18,.85,.26,1)',fill:'both'});animation.current=next;void next.finished.then(()=>{if(options.focus!==false&&alive.current&&!closing.current)closeButton.current?.focus({preventScroll:true});}).catch(()=>{});}else if(options.focus!==false)closeButton.current?.focus({preventScroll:true});
  const outside=(event:PointerEvent)=>{if(!node.contains(event.target as Node)&&!element.contains(event.target as Node))dismissRef.current();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();dismissRef.current();}else if(event.key==='Tab'&&options.focus===false){dismissRef.current();}else if(event.key==='Tab'){const buttons=[...node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}else if(!node.contains(document.activeElement)){event.preventDefault();first?.focus();}}};
  const resize=()=>dismissRef.current(),scroll=(event:Event)=>{if(!node.contains(event.target as Node))dismissRef.current();};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,true);
  return()=>{alive.current=false;animation.current?.cancel();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll,true);};
 },[element]);
 return {panel,closeButton,style,exiting,dismiss};
}
