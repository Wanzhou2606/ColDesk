import * as React from 'react';
import {TaskHoverPreview} from '../components/TaskHoverPreview';
import { getApi } from '../lib/api';
import { useGlassAppearance } from '../lib/glassAppearance';
import { useAppState } from '../lib/useAppState';
import { Widget } from './WidgetView';
import { IslandWidget } from './IslandWidget';

/**
 * 悬浮窗入口（容器）：把真实的数据订阅与 IPC 注入纯展示层。
 * 展示逻辑在 WidgetView 里，便于在纯 Node 下端到端渲染验证。
 */
export function WidgetWindow() {
  const state = useAppState();

  // 玻璃外观（透明度 + 光感强度）同步到 CSS 变量，与主窗口共用同一实现
  useGlassAppearance(state);

  if(state?.settings.desktopMode==='island')return <><IslandWidget state={state}/><TaskHoverPreview state={state}/></>;
  return (
    <><TaskHoverPreview state={state}/><Widget
      useAppState={() => state}
      invoke={(channel, payload) => {
        void getApi().invoke(channel, payload);
      }}
    /></>
  );
}
