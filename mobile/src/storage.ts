import { Capacitor, registerPlugin } from '@capacitor/core';
const NativeStore=registerPlugin<{load():Promise<{data:string|null}>;save(options:{data:string}):Promise<void>}>('ColDeskStore');

export interface StoragePort { load(): Promise<unknown>; save(data: unknown): Promise<void> }
/** 浏览器预览与安卓使用相同的数据契约；平台实现独立，供后续小程序替换。 */
export class MobileStorage implements StoragePort {
  private db?: IDBDatabase;
  private async database() {
    if (this.db) return this.db;
    this.db = await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('coldesk-mobile-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('无法打开本机记录'));});
    return this.db;
  }
  async load(): Promise<unknown> {
    if (Capacitor.isNativePlatform()) {
      const result=await NativeStore.load();return result.data===null?undefined:JSON.parse(result.data);
    }
    const db=await this.database();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),request=tx.objectStore('state').get('main');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('无法读取本机记录'));});
  }
  async save(data: unknown) {
    if (Capacitor.isNativePlatform()) {
      await NativeStore.save({data:JSON.stringify(data)});return;
    }
    const db=await this.database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(structuredClone(data),'main');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('保存失败，请检查手机剩余空间后重试'));tx.onabort=()=>reject(new Error('保存未完成，请重试'));});
  }
}
