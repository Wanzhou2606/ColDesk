import { useEffect, useState } from 'react';
import { nowLocal, localToMinutes } from '@shared/time';
export function useLiveClock(initial: string) {
  const [clock,setClock]=useState({now:initial,minutes:initial?localToMinutes(initial):-1});
  useEffect(()=>{
    const update=()=>{const date=new Date(),now=nowLocal();setClock({now,minutes:localToMinutes(now)+date.getSeconds()/60});};
    update();const timer=window.setInterval(update,1000);window.addEventListener('focus',update);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',update);};
  },[]);
  return clock;
}
