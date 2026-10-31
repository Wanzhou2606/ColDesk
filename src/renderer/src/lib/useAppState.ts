import { useEffect, useState } from 'react';

import type { TodayView } from '@shared/view';

import { getApi } from './api';
import {setLanguage} from './i18n';

/**
 * 订阅主进程状态。主进程任何数据变化都会广播；
 * 这里再加一个 30 秒节拍，让"还有 32 分钟结束"这类随时间变化的展示保持新鲜。
 */
export function useAppState(pollMs = 30_000): TodayView | null {
  const [state, setState] = useState<TodayView | null>(null);

  useEffect(() => {
    const api = getApi();
    let alive = true;

    const load = () => {
      void api.invoke('state:get').then((next) => {
        if (alive && next) {setLanguage((next as TodayView).settings.language);document.documentElement.lang=(next as TodayView).settings.language??"zh-CN";setState(next as TodayView);}
      }).catch(()=>undefined);
    };

    load();
    const off = api.on('state:changed', (payload) => {
      if (alive && payload) {setLanguage((payload as TodayView).settings.language);document.documentElement.lang=(payload as TodayView).settings.language??"zh-CN";setState(payload as TodayView);}
    });
    const timer = window.setInterval(load, pollMs);
    const refreshVisible=()=>{if(document.visibilityState!=='hidden')load();};
    window.addEventListener('focus',refreshVisible);document.addEventListener('visibilitychange',refreshVisible);

    return () => {
      alive = false;
      off();
      window.clearInterval(timer);
      window.removeEventListener('focus',refreshVisible);document.removeEventListener('visibilitychange',refreshVisible);
    };
  }, [pollMs]);

  return state;
}
