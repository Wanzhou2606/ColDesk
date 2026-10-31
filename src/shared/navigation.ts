export const NAV_PAGES=['home','schedule','study','habits','goals','expenses'] as const;
export type NavPage=typeof NAV_PAGES[number];
export const NAV_LABELS:Record<NavPage,string>={home:'Home',schedule:'日程',study:'任务',habits:'打卡',goals:'长期',expenses:'记账'};
export function validNavPage(value:unknown):value is NavPage{return NAV_PAGES.includes(value as NavPage);}
export function navigationOrder(value:unknown):NavPage[]{const items=Array.isArray(value)?value.filter(validNavPage):[];if(items.join(',')==='home,schedule,study,habits,expenses')return [...NAV_PAGES];return [...new Set([...items,...NAV_PAGES])];}
export type Language='zh-CN'|'en'|'ja';
export const validLanguage=(v:unknown):v is Language=>v==='zh-CN'||v==='en'||v==='ja';
