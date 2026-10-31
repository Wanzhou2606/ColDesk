import type { HomeEntry, HomeAsset, HomeStatus, HomeExportOptions } from '@shared/home';
import { validHomeDate } from '@shared/home';

export interface Cipher { iv:string; data:string }
export interface DiaryPayload { entries:Record<string,HomeEntry>; assets:Record<string,HomeAsset> }
export interface DiaryState { initialized:boolean; passwordEnabled:boolean; salt?:string; cipher?:Cipher; plain?:DiaryPayload }
export const emptyDiary=():DiaryState=>({initialized:false,passwordEnabled:false,plain:{entries:{},assets:{}}});
export function bytesToBase64(bytes:Uint8Array) { let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text); }
export function base64ToBytes(text:string) { return Uint8Array.from(atob(text),c=>c.charCodeAt(0)); }
async function derive(password:string,salt:string) { const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:base64ToBytes(salt),iterations:210000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']); }
async function encrypt(key:CryptoKey,payload:DiaryPayload):Promise<Cipher> { const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(payload)));return {iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(bytes))}; }

/** 密码日记的文字与附件一起加密，持久化状态里不保留明文副本。 */
export class MobileDiary {
  private key:CryptoKey|null=null;
  private payload:DiaryPayload|null=null;
  constructor(private state:()=>DiaryState) {}
  status():HomeStatus { const state=this.state();return {initialized:state.initialized,passwordEnabled:state.passwordEnabled,unlocked:!state.passwordEnabled||this.payload!==null}; }
  private opened() { const s=this.state();if(!s.initialized)throw new Error('请先选择 home 的使用方式');if(!s.passwordEnabled)return s.plain!;if(!this.payload)throw new Error('请先解锁日记');return this.payload; }
  async setup(password:unknown) { if(this.state().initialized)throw new Error('home 已完成初始设置');this.state().initialized=true;try{await this.protection(password);}catch(e){this.state().initialized=false;throw e;}return this.status(); }
  async unlock(password:unknown) { const s=this.state();if(!s.passwordEnabled)return this.status();if(typeof password!=='string')throw new Error('请输入密码');try{const key=await derive(password,s.salt!);const value=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(s.cipher!.iv)},key,base64ToBytes(s.cipher!.data));this.payload=JSON.parse(new TextDecoder().decode(value));this.key=key;}catch{throw new Error('密码不正确，请重试');}return this.status(); }
  lock() { this.key=null;this.payload=null; }
  async protection(password:unknown) {
    const s=this.state(),data=structuredClone(s.passwordEnabled?this.opened():s.plain??{entries:{},assets:{}});
    if(password!==undefined&&password!==''&&(typeof password!=='string'||password.length<4||password.length>128))throw new Error('密码请设置为 4–128 个字符');
    if(password) { const salt=bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),key=await derive(password as string,salt),cipher=await encrypt(key,data);Object.assign(s,{passwordEnabled:true,salt,cipher});delete s.plain;this.key=key;this.payload=data; }
    else { Object.assign(s,{passwordEnabled:false,plain:data});delete s.salt;delete s.cipher;this.lock(); }
  }
  get(date:unknown):HomeEntry { if(!validHomeDate(date))throw new Error('请选择有效日期');return structuredClone(this.opened().entries[date]??{date,cover:'',body:'',weather:'',mood:'',attachments:[]}); }
  month(month:unknown) { if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('请选择有效月份');return {month,entries:Object.values(this.opened().entries).filter(e=>e.date.startsWith(month)).map(({date,cover,weather,mood,title,attachments})=>({date,cover,weather,mood,title,attachments}))}; }
  async save(input:HomeEntry) { const old=this.get(input?.date),data=this.opened();const entry:HomeEntry={date:old.date,cover:String(input.cover??'').slice(0,500),body:String(input.body??'').slice(0,200000),weather:String(input.weather??'').slice(0,80),mood:String(input.mood??'').slice(0,80),title:String(input.title??'').slice(0,120),attachments:old.attachments??[],updatedAt:new Date().toISOString()};data.entries[entry.date]=entry;await this.seal();return structuredClone(entry); }
  async add(date:string,assets:HomeAsset[]) { const entry=this.get(date),data=this.opened();if((entry.attachments?.length??0)+assets.length>60)throw new Error('每天最多添加 60 个附件');for(const asset of assets){data.assets[asset.id]=asset;(entry.attachments??=[]).push({id:asset.id,name:asset.name,kind:asset.kind,size:asset.size});}data.entries[date]=entry;if(JSON.stringify(data).length>100*1024*1024)throw new Error('本机日记已达到本版容量，请先导出照片后再整理');await this.seal();return this.get(date); }
  asset(date:string,id:string) { const entry=this.get(date),asset=this.opened().assets[id];if(!entry.attachments?.some(a=>a.id===id)||!asset)throw new Error('附件不存在');return asset; }
  async remove(date:string,id:string) { const entry=this.get(date),data=this.opened();entry.attachments=entry.attachments?.filter(a=>a.id!==id);data.entries[date]=entry;delete data.assets[id];await this.seal();return this.get(date); }
  entries(options:HomeExportOptions) { let entries=Object.values(this.opened().entries);switch(options.scope){case'all':break;case'month':if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.month))throw new Error('请选择月份');entries=entries.filter(e=>e.date.startsWith(options.month));break;case'day':if(!validHomeDate(options.date))throw new Error('请选择日期');entries=entries.filter(e=>e.date===options.date);break;case'range':if(!validHomeDate(options.start)||!validHomeDate(options.end)||options.start>options.end)throw new Error('请选择有效日期范围');entries=entries.filter(e=>e.date>=options.start&&e.date<=options.end);break;default:throw new Error('请选择导出范围');}return entries.sort((a,b)=>a.date.localeCompare(b.date)); }
  async seal() { if(this.state().passwordEnabled){if(!this.key||!this.payload)throw new Error('请先解锁日记');this.state().cipher=await encrypt(this.key,this.payload);} }
  checkpoint() { return {key:this.key,payload:this.payload?structuredClone(this.payload):null}; }
  restore(checkpoint:{key:CryptoKey|null;payload:DiaryPayload|null}) { this.key=checkpoint.key;this.payload=checkpoint.payload; }
}
