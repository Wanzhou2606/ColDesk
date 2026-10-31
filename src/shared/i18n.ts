import en from './locales/en.json';
import ja from './locales/ja.json';
import extra from './locales/extra.json';
import { validLanguage,type Language } from './navigation';
let language:Language='zh-CN';
export function setLanguage(next:unknown){language=validLanguage(next)?next:'zh-CN';}
export function currentLanguage(){return language;}
export function weekdayShort(value:string){const index='一二三四五六日'.indexOf(value);return index<0?value:language==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]:language==='ja'?['月','火','水','木','金','土','日'][index]:value;}
const dictionaries:Record<string,Record<string,string>>={en,ja};
for(const [key,values] of Object.entries(extra)){dictionaries.en[key]=values[0];dictionaries.ja[key]=values[1];}
const patterns=Object.fromEntries(Object.entries(dictionaries).map(([locale,dict])=>[locale,Object.keys(dict).filter(key=>/\{\d+\}/.test(key)&&/[\u3400-\u9fff]/.test(key.replace(/\{\d+\}/g,''))).sort((a,b)=>b.replace(/\{\d+\}/g,'').length-a.replace(/\{\d+\}/g,'').length).map(key=>({translated:dict[key],regex:new RegExp('^'+key.split(/\{\d+\}/g).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('([\\s\\S]+?)')+'$')}))]));
const format=(text:string,args:unknown[])=>text.replace(/\{(\d+)\}/g,(match,n)=>Number(n)<args.length?String(args[Number(n)]??''):match);
export function t<T>(value:T,args:unknown[]=[]):T{
 if(typeof value!=='string')return value;
 const direct=dictionaries[language]?.[value];
 if(direct!==undefined)return format(direct,args) as T;
 const trimmed=dictionaries[language]?.[value.trim()];
 if(trimmed!==undefined)return (value.slice(0,value.length-value.trimStart().length)+format(trimmed,args)+value.slice(value.trimEnd().length)) as T;
 if(args.length)return format(value,args) as T;
 for(const pattern of patterns[language]??[]){const match=value.match(pattern.regex);if(match)return format(pattern.translated,match.slice(1).map(part=>dictionaries[language]?.[part]??part)) as T;}
 return value;
}
