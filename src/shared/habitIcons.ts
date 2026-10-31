export const HABIT_ICONS = [
 {icon:'⭐',label:'通用'}, {icon:'📚',label:'阅读'}, {icon:'📝',label:'学习'}, {icon:'🗣️',label:'语言'},
 {icon:'🏃',label:'运动'}, {icon:'🚶',label:'散步'}, {icon:'💪',label:'健身'}, {icon:'🧘',label:'冥想'},
 {icon:'💧',label:'喝水'}, {icon:'🥗',label:'饮食'}, {icon:'🌙',label:'早睡'}, {icon:'☀️',label:'早起'},
 {icon:'💊',label:'健康'}, {icon:'🪥',label:'刷牙'}, {icon:'🧹',label:'整理'}, {icon:'✍️',label:'写作'},
 {icon:'🎵',label:'音乐'}, {icon:'🎨',label:'绘画'}, {icon:'💻',label:'编程'}, {icon:'💰',label:'存钱'}
] as const;

/** Keep the complete emoji, including variation selectors and joined characters. */
export function normalizeHabitIcon(input:unknown):string|undefined{
 if(input===undefined||input===null||input==='')return undefined;
 if(typeof input!=='string')throw Error('请选择一个有效的小图标');
 const icon=input.trim();
 if(!icon||icon.length>32||/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(icon)||Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(icon)).length!==1)throw Error('请选择一个有效的小图标');
 return icon;
}
