/** ColDesk 云同步协议 v1：传输与存储均通过接口接入，当前版本默认关闭。 */
export const SYNC_PROTOCOL_VERSION = 1 as const;
export type SyncEntity = 'task'|'semester'|'course'|'course_session'|'course_override'|'time_slot'|'manual_schedule'|'expense_category'|'expense_entry'|'expense_budget'|'habit'|'habit_checkin'|'diary_entry'|'attachment'|'shared_settings';
export interface SyncDevice { deviceId:string; platform:'windows'|'android'|'wechat'; protocolVersion:1; enabled:boolean }
export interface EncryptedSyncPayload { encrypted:true; algorithm:'AES-256-GCM'; keyId:string; iv:string; ciphertext:string; formatVersion:1 }
export interface SyncChange { operationId:string; deviceId:string; sequence:number; entity:SyncEntity; entityId:string; operation:'upsert'|'delete'; baseVersion:string|null; modifiedAt:string; payload?:Record<string,unknown>|EncryptedSyncPayload }
export interface SyncRecord { entity:SyncEntity; entityId:string; serverVersion:string; operation:'upsert'|'delete'; modifiedAt:string; payload?:Record<string,unknown>|EncryptedSyncPayload }
export interface SyncPush { protocolVersion:1; deviceId:string; batchId:string; changes:SyncChange[] }
export interface SyncConflict { operationId:string; local:SyncChange; remote:SyncRecord; resolution:'user_required' }
export interface SyncPushResult { accepted:Array<{operationId:string;entity:SyncEntity;entityId:string;serverVersion:string}>; conflicts:SyncConflict[]; cursor:string }
export interface SyncPullResult { records:SyncRecord[]; cursor:string; hasMore:boolean }
export interface SyncAttachmentTicket { uploadId:string; url:string; expiresAt:string; requiredHeaders:Record<string,string> }

/** 小程序可实现 wx.request；安卓/Windows 可实现 HTTPS，不绑定云厂商。 */
export interface SyncTransport {
 push(batch:SyncPush,signal?:AbortSignal):Promise<SyncPushResult>;
 pull(input:{deviceId:string;cursor:string|null;limit:number},signal?:AbortSignal):Promise<SyncPullResult>;
 prepareAttachment(input:{attachmentId:string;sha256:string;bytes:number;encrypted:boolean},signal?:AbortSignal):Promise<SyncAttachmentTicket>;
}
/** 同步适配器必须提供事务和发件箱；删除用 tombstone，不能静默丢掉未确认操作。 */
export interface SyncPersistence {
 getDevice():Promise<SyncDevice>;
 readPending(limit:number):Promise<SyncChange[]>;
 enqueueAtomically(changes:SyncChange[]):Promise<void>;
 applyPushResultAtomically(result:SyncPushResult):Promise<void>;
 applyRemoteAtomically(records:SyncRecord[],cursor:string):Promise<void>;
 listConflicts():Promise<SyncConflict[]>;
}
export function createSyncDevice(platform:SyncDevice['platform'],deviceId:string):SyncDevice {if(!/^[a-zA-Z0-9_-]{8,100}$/.test(deviceId))throw new Error('同步设备标识不正确');return {deviceId,platform,protocolVersion:1,enabled:false};}
export function validateSyncChange(change:SyncChange) {
 if(!change||!change.operationId||!change.deviceId||!change.entityId||!Number.isSafeInteger(change.sequence)||change.sequence<1||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(change.modifiedAt)||!Number.isFinite(Date.parse(change.modifiedAt)))throw new Error('同步变更格式不正确');
 if(!['task','semester','course','course_session','course_override','time_slot','manual_schedule','expense_category','expense_entry','expense_budget','habit','habit_checkin','diary_entry','attachment','shared_settings'].includes(change.entity))throw new Error('同步记录类型不支持');
 if(!['upsert','delete'].includes(change.operation))throw new Error('同步操作不支持');
 if(change.operation==='delete'){if(change.payload!==undefined)throw new Error('删除标记不能带数据正文');return;}
 if(!change.payload||typeof change.payload!=='object')throw new Error('同步变更缺少数据');
 if(change.entity==='diary_entry'){const payload=change.payload as EncryptedSyncPayload;if(payload.encrypted!==true||payload.algorithm!=='AES-256-GCM'||typeof payload.keyId!=='string'||!payload.keyId||typeof payload.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(payload.iv)||typeof payload.ciphertext!=='string'||payload.ciphertext.length<24||payload.formatVersion!==1||Object.keys(payload).some(key=>!['encrypted','algorithm','keyId','iv','ciphertext','formatVersion'].includes(key)))throw new Error('日记必须使用加密同步载荷');}
}
export function validateSyncEndpoint(endpoint:string) {let url:URL;try{url=new URL(endpoint);}catch{throw new Error('请配置有效的同步服务地址');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('同步服务必须使用不带凭据和查询参数的 HTTPS 地址');return url.href.replace(/\/$/,'');}

/** 仅在未来启用同步时构造；当前安卓/Windows 启动流程不会实例化或发出请求。 */
export class HttpSyncTransport implements SyncTransport {
 private endpoint:string;
 constructor(endpoint:string,private accessToken:()=>Promise<string>,private fetcher:typeof fetch=fetch){this.endpoint=validateSyncEndpoint(endpoint);}
 private async request<T>(route:string,payload:unknown,signal?:AbortSignal):Promise<T> {
  const token=await this.accessToken();if(!token||/[\r\n]/.test(token))throw new Error('请先登录同步账号');
  const response=await this.fetcher(this.endpoint+'/v1/sync/'+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(payload),redirect:'error',credentials:'omit',signal:signal??AbortSignal.timeout(15000)});
  if(response.status===401)throw new Error('同步登录已失效，请重新登录');if(!response.ok)throw new Error('同步服务暂时不可用');try{return await response.json() as T;}catch{throw new Error('同步服务响应格式不正确');}
 }
 async push(batch:SyncPush,signal?:AbortSignal){if(batch.protocolVersion!==1||!batch.batchId||batch.changes.length>200)throw new Error('同步批次不正确');for(const change of batch.changes)validateSyncChange(change);return this.request<SyncPushResult>('push',batch,signal);}
 async pull(input:{deviceId:string;cursor:string|null;limit:number},signal?:AbortSignal){if(!Number.isInteger(input.limit)||input.limit<1||input.limit>200)throw new Error('同步拉取数量不正确');return this.request<SyncPullResult>('pull',{protocolVersion:1,...input},signal);}
 async prepareAttachment(input:{attachmentId:string;sha256:string;bytes:number;encrypted:boolean},signal?:AbortSignal){if(!/^[a-f0-9]{64}$/.test(input.sha256)||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>100*1024*1024)throw new Error('同步附件信息不正确');return this.request<SyncAttachmentTicket>('attachments/prepare',{protocolVersion:1,...input},signal);}
}
