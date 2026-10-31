import {getDb} from './db';

/** SQLite data_version changes only for commits made by another connection, including WAL writes. */
export function externalChangeCheck(readVersion: () => number, reload: () => void) {
  let seen = readVersion();
  return () => {
    const next = readVersion();
    if (next === seen) return false;
    reload();
    // Keep the version observed before reload: a concurrent external commit must be retried.
    seen = next;
    return true;
  };
}

export function watchExternalChanges(reload: () => void) {
  const check = externalChangeCheck(() => Number((getDb().prepare('PRAGMA data_version').get() as {data_version: number}).data_version), reload);
  const timer = setInterval(() => {try {check();} catch (error) {console.error('[coldesk] 外部数据刷新失败', error);}}, 3000);
  timer.unref();
  return () => clearInterval(timer);
}
