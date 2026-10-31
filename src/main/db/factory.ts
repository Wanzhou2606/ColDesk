/**
 * 应用数据库工厂：把"数据库句柄"和"设置存储"组合起来。
 *
 * 分为两套实现：
 *  - RealAppDatabase：设置项落在 setting 表（正式运行）；
 *  - FakeStoreDatabase：设置项放在内存里（纯 Node 测试用，避免把 electron 拉进来）。
 */

import type { DriverDatabase } from './driver';

export interface AppDatabase extends DriverDatabase {
  /** 读取设置（按命名空间存 JSON） */
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
}

class RealAppDatabase implements AppDatabase {
  constructor(private readonly inner: DriverDatabase) {}

  get driver(): DriverDatabase['driver'] {
    return this.inner.driver;
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  prepare(sql: string) {
    return this.inner.prepare(sql);
  }

  transaction<F extends (...args: never[]) => unknown>(fn: F): F {
    return this.inner.transaction(fn);
  }

  pragma(statement: string) {
    return this.inner.pragma(statement);
  }

  close(): void {
    this.inner.close();
  }

  getSetting(key: string): string | undefined {
    const row = this.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES (@key, @value, @ts)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @ts`
    ).run({ key, value, ts: new Date().toISOString().slice(0, 16) });
  }
}

class FakeStoreDatabase implements AppDatabase {
  private readonly settings = new Map<string, string>();

  constructor(private readonly inner: DriverDatabase) {}

  get driver(): DriverDatabase['driver'] {
    return this.inner.driver;
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  prepare(sql: string) {
    return this.inner.prepare(sql);
  }

  transaction<F extends (...args: never[]) => unknown>(fn: F): F {
    return this.inner.transaction(fn);
  }

  pragma(statement: string) {
    return this.inner.pragma(statement);
  }

  close(): void {
    this.inner.close();
  }

  getSetting(key: string): string | undefined {
    return this.settings.get(key);
  }

  setSetting(key: string, value: string): void {
    this.settings.set(key, value);
  }
}

export function useFakeSettings(): boolean {
  return process.env.COLDESK_DB_FACTORY === 'fake';
}

export function createAppDatabase(driver: DriverDatabase): AppDatabase {
  return useFakeSettings() ? new FakeStoreDatabase(driver) : new RealAppDatabase(driver);
}
