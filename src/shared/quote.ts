/**
 * 每日名言的纯逻辑与类型。
 *
 * 放 shared 而不是 main 的原因：`Quote` 类型要被 `shared/view.ts` 的 HabitView 引用，
 * 而 main 依赖 shared。如果反过来（shared 依赖 main），会形成反向依赖，
 * 并且 web 端的类型检查（只包含 shared + renderer）会因为找不到 main 文件而失败。
 *
 * 所以这里只保留**不碰数据库**的部分：
 *   · Quote 类型
 *   · 内置兜底名言
 *   · 从一言（v1.hitokoto.cn）取一句的函数
 * 缓存 / 存取主进程设置由调用方（store）负责，这里不碰。
 */

export interface Quote {
  text: string;
  /** 出处（书名 / 作品名） */
  from: string;
  /** 作者 */
  author: string;
  /** 来源：远端 or 内置兜底 */
  source: 'hitokoto' | 'local';
}

/* ------------------------------------------------------------ 内置兜底 */

/**
 * 内置名言：均为人所熟知的句子，且出处可靠。
 *
 * 选句标准：短、正向、不油腻。
 * 避免"只要努力就能成功"这类空话——打卡本来就已经在努力了，
 * 需要的是一句能让人安静下来的话，而不是再被喊一次口号。
 */
export const FALLBACK_QUOTES: Quote[] = [
  { text: '不积跬步，无以至千里；不积小流，无以成江海。', from: '《荀子·劝学》', author: '荀子', source: 'local' },
  { text: '锲而不舍，金石可镂。', from: '《荀子·劝学》', author: '荀子', source: 'local' },
  { text: '千里之行，始于足下。', from: '《道德经》', author: '老子', source: 'local' },
  { text: '合抱之木，生于毫末；九层之台，起于累土。', from: '《道德经》', author: '老子', source: 'local' },
  { text: '博学之，审问之，慎思之，明辨之，笃行之。', from: '《礼记·中庸》', author: '子思', source: 'local' },
  { text: '天行健，君子以自强不息。', from: '《周易·乾卦》', author: '佚名', source: 'local' },
  { text: '士不可以不弘毅，任重而道远。', from: '《论语·泰伯》', author: '曾子', source: 'local' },
  { text: '知之者不如好之者，好之者不如乐之者。', from: '《论语·雍也》', author: '孔子', source: 'local' },
  { text: '业精于勤，荒于嬉；行成于思，毁于随。', from: '《进学解》', author: '韩愈', source: 'local' },
  { text: '宝剑锋从磨砺出，梅花香自苦寒来。', from: '《警世贤文》', author: '佚名', source: 'local' },
  { text: '少年易老学难成，一寸光阴不可轻。', from: '《偶成》', author: '朱熹', source: 'local' },
  { text: '纸上得来终觉浅，绝知此事要躬行。', from: '《冬夜读书示子聿》', author: '陆游', source: 'local' },
  { text: '长风破浪会有时，直挂云帆济沧海。', from: '《行路难》', author: '李白', source: 'local' },
  { text: '会当凌绝顶，一览众山小。', from: '《望岳》', author: '杜甫', source: 'local' },
  { text: '山重水复疑无路，柳暗花明又一村。', from: '《游山西村》', author: '陆游', source: 'local' },
  { text: '路漫漫其修远兮，吾将上下而求索。', from: '《离骚》', author: '屈原', source: 'local' },
  { text: '苟日新，日日新，又日新。', from: '《礼记·大学》', author: '佚名', source: 'local' },
  { text: '日日行，不怕千万里；常常做，不怕千万事。', from: '《格言联璧》', author: '金缨', source: 'local' }
];

/** 按日期挑一句兜底名言：同一天总是同一句，不会每次刷新都跳 */
export function fallbackQuoteFor(date: string): Quote {
  const digits = Number(date.replace(/-/g, ''));
  const index = Number.isFinite(digits) ? digits % FALLBACK_QUOTES.length : 0;
  return FALLBACK_QUOTES[index];
}

/* ------------------------------------------------------------ 远端获取 */

const HITOKOTO_URL = 'https://v1.hitokoto.cn/?c=k&c=d&c=i&encode=json&max_length=60';
const REQUEST_TIMEOUT_MS = 4000;

/**
 * 抓一句名言。**永不抛错**：任何异常都降级为调用方传入的兜底。
 * 由调用方决定用什么兜底（通常是 fallbackQuoteFor(date)）。
 */
export async function fetchQuote(date: string): Promise<Quote> {
  const remote = await tryRemote();
  return remote ?? fallbackQuoteFor(date);
}

async function tryRemote(): Promise<Quote | undefined> {
  try {
    const response = await fetch(HITOKOTO_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      hitokoto?: unknown;
      from?: unknown;
      from_who?: unknown;
    };
    const text = typeof data.hitokoto === 'string' ? data.hitokoto.trim() : '';
    if (!text || text.length > 160) return undefined;

    return {
      text,
      from: typeof data.from === 'string' ? data.from.trim().slice(0,100) : '',
      author: typeof data.from_who === 'string' ? data.from_who.trim().slice(0,80) : '',
      source: 'hitokoto'
    };
  } catch {
    // 超时、DNS 失败、断网、返回不是 JSON —— 一律当作"取不到"，
    // 由调用方退回内置名言。名言取不到不该影响打卡。
    return undefined;
  }
}
