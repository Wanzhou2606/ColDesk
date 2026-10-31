export type MobileFontTarget='uiFont'|'homeCoverFont';
export interface MobileFont {name:string;data:string}
export interface MobileAppearance {icon?:{data:string};fonts?:Partial<Record<MobileFontTarget,MobileFont>>}
export const MOBILE_FONT_OPTIONS=[
 {value:'system',label:'系统字体'},
 {value:'ColDeskHand',label:'手写体'},
 {value:'serif',label:'衬线 · 书卷'},
 {value:'sans-serif-light',label:'细黑 · 轻盈'},
 {value:'sans-serif-medium',label:'中黑 · 清晰'},
 {value:'sans-serif-condensed',label:'窄体 · 紧凑'},
 {value:'monospace',label:'等宽 · 简洁'}
];
export const importedFontFamily=(target:MobileFontTarget)=>target==='uiFont'?'ColDeskMobileUI':'ColDeskMobileCover';
export function mobileFontFamily(value:string|undefined,target:MobileFontTarget){
 const font=value??(target==='uiFont'?'system':'ColDeskHand');
 if(font==='system')return 'system-ui, sans-serif';
 if(['serif','monospace','cursive'].includes(font))return font;
 return `'${font.replace(/[^\p{L}\p{N} ._-]/gu,'')}', ${target==='uiFont'?'system-ui, sans-serif':'ColDeskHand, cursive'}`;
}
function decode(data:unknown,limit:number){
 if(typeof data!=='string'||!data.length||data.length%4!==0||data.length>Math.ceil(limit/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('个性化文件内容不正确或过大');
 const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));if(bytes.length>limit)throw Error('个性化文件过大');return bytes;
}
export function validateMobileAppearance(value:MobileAppearance|undefined){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('个性化设置不正确');
 if(value.icon){const bytes=decode(value.icon.data,2*1024*1024);if([137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))throw Error('图标请使用 PNG 图片');}
 if(value.fonts){if(typeof value.fonts!=='object'||Array.isArray(value.fonts))throw Error('字体设置不正确');for(const target of Object.keys(value.fonts)){
  if(!['uiFont','homeCoverFont'].includes(target))throw Error('字体位置不正确');const font=value.fonts[target as MobileFontTarget];
  if(!font||typeof font.name!=='string'||!font.name.trim()||font.name.length>200)throw Error('字体名称不正确');
  const bytes=decode(font.data,20*1024*1024),magic=String.fromCharCode(...bytes.slice(0,4));
  if(!(bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0)&&!['OTTO','true','wOFF','wOF2'].includes(magic))throw Error('请选择 TTF、OTF、WOFF 或 WOFF2 字体');
 }}
}
