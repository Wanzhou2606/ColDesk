/** 展示可理解的输入提示，内部通道、数据库与堆栈信息仅保留在日志中。 */
export function userError(error: unknown, fallback: string): string {
  const message = (error instanceof Error ? error.message : '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim();
  if (!/[\u4e00-\u9fff]/.test(message) || message.length > 120 || /SQL|sqlite|node_modules|undefined|stack|\bid\b|\btable\b|\bError\b|\bTypeError\b/i.test(message)) return fallback;
  return message;
}
