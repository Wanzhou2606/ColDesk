import { randomUUID } from 'node:crypto';
import { createSyncDevice, type SyncDevice } from '@shared/sync';
import { getSettingsJson, setSettingsJson } from './db/repositories';
/** 只分配本机设备标识，不读取业务记录，也不连接云端。 */
export function desktopSyncStatus():SyncDevice {
 const stored=getSettingsJson<SyncDevice|null>('sync.device.v1',null);
 if(stored?.deviceId)return createSyncDevice('windows',stored.deviceId);
 const device=createSyncDevice('windows',randomUUID());setSettingsJson('sync.device.v1',device);return device;
}
