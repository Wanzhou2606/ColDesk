import { parseHduCalendar, validateHduSubscription, type HduCalendarPreview } from '@shared/hduCalendar';

/** 官方订阅限定到 HTTPS 固定接口；不携带网页登录 Cookie，且不接受跳转。 */
export async function fetchHduCalendar(source:unknown,fetcher:typeof fetch=fetch):Promise<HduCalendarPreview> {
  const url=validateHduSubscription(source);
  try{
    const response=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{accept:'text/calendar'}});
    if(!response.ok)throw new Error('无法读取官方订阅，链接可能已失效，请重新获取');
    if(Number(response.headers.get('content-length'))>6*1024*1024)throw new Error('订阅文件过大，请核对范围');
    const reader=response.body?.getReader();if(!reader)throw new Error('官方订阅没有返回课表内容');
    const chunks:Uint8Array[]=[];let bytes=0;
    try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>6*1024*1024)throw new Error('订阅文件过大，请核对范围');chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
    return parseHduCalendar(Buffer.concat(chunks).toString('utf8'));
  }catch(error){if(error instanceof Error&&/订阅|课程|时区/.test(error.message))throw error;throw new Error('无法连接杭电助手，请检查网络后重试');}
}
