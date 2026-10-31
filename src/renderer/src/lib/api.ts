/**
 * 渲染层访问主进程的唯一通道（由 preload 注入）。
 * 浏览器里单独打开时提供一个空实现，方便只调样式。
 */

export interface ColdeskApi {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    coldesk?: ColdeskApi;
  }
}

const noop: ColdeskApi = {
  invoke: async () => null,
  on: () => () => undefined
};

export function getApi(): ColdeskApi {
  return window.coldesk ?? noop;
}
