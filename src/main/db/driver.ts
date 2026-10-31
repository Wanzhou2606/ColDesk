/**
 * SQLite 驱动适配层。
 *
 * 为什么需要它：
 *  - 首选 better-sqlite3（原生模块，性能最好，Electron 下需要匹配 ABI）；
 *  - 原生模块缺失或 ABI 不匹配时，回退到 Node 内置的 node:sqlite
 *    （Node 22.5+ 提供，Electron 自带 Node 22 及以上时同样可用）；
 *  - 两者的 prepare/run/get/all/exec 语义基本一致，这里做最小归一化，
 *    让上层仓储代码只写一份。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface DriverDatabase {
  /** 驱动名，便于日志与"设置"页展示 */
  readonly driver: 'better-sqlite3' | 'node:sqlite';
  exec(sql: string): void;
  prepare(sql: string): DriverStatement;
  /**
   * 事务包装。
   *
   * 泛型参数 F 保留回调的**精确参数类型**（例如 `(list: TimeSlotInput[]) => void`），
   * 而不是把它放宽成 `(...args: unknown[]) => void`。
   * 如果放宽，调用方传 `(list: TimeSlotInput[]) => void` 会因为
   * 参数逆变而报 "not assignable"，虽然运行时完全正确。
   */
  transaction<F extends (...args: never[]) => unknown>(fn: F): F;
  pragma(statement: string): unknown;
  close(): void;
}

/**
 * 语句接口。
 *
 * 参数必须是**变长**的：上层调用既有 `stmt.run(a, b)` 这种位置参数写法，
 * 也有 `stmt.run({ key, value })` 这种具名参数写法，两种都是真实用法。
 * 之前这里声明成 `params?: unknown`（最多一个参数），
 * 与实现里的 `(...args: unknown[])` 不一致，导致类型检查一开就报
 * "Expected 0-1 arguments, but got 7"。类型检查此前未覆盖主进程，所以一直没暴露。
 */
export interface DriverStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

function tryLoadBetterSqlite3(): unknown | null {
  try {
    const mod = require('better-sqlite3') as unknown;
    return mod;
  } catch {
    return null;
  }
}

function tryLoadNodeSqlite(): { DatabaseSync: new (path: string, options?: unknown) => unknown } | null {
  try {
    return require('node:sqlite') as { DatabaseSync: new (path: string, options?: unknown) => unknown };
  } catch {
    return null;
  }
}

/**
 * 探测时真正做一次内存开库：
 * better-sqlite3 的 JS 部分可能装上了，但原生绑定缺失（例如没编译成功），
 * 只 require 会误判，必须实际打开一次才算可用。
 */
function betterSqlite3Works(Ctor: unknown): boolean {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = new (Ctor as any)(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** 把 node:sqlite 的返回值转成普通对象，避免 null 原型带来的比较问题 */
function plain<T>(value: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) } as T;
  }
  return value;
}

/**
 * node:sqlite 的两条严格规则（better-sqlite3 都很宽松）：
 *  1. 不接受 undefined 绑定值 → 统一转成 null；
 *  2. 命名参数里出现 SQL 中没有的键会直接报错 → 按 SQL 里出现的 @名字 过滤。
 * 仓储层为了写起来简洁，常常多传几个键或用 undefined 表示空，这里一次性抹平。
 */
function makeNormalizer(sql: string) {
  const names = new Set<string>();
  for (const match of sql.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(match[1]);
  }

  return (params: unknown): unknown => {
    if (params === null || typeof params !== 'object' || Array.isArray(params)) return params;
    const source = params as Record<string, unknown>;
    if (names.size === 0) return source;
    const out: Record<string, unknown> = {};
    for (const name of names) {
      const value = source[name];
      out[name] = value === undefined ? null : value;
    }
    return out;
  };
}

export function openDatabase(file: string): DriverDatabase {
  const BetterSqlite3 = tryLoadBetterSqlite3();
  if (BetterSqlite3 && betterSqlite3Works(BetterSqlite3)) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const Ctor = BetterSqlite3 as any;
    const db = new Ctor(file);
    return {
      driver: 'better-sqlite3',
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      transaction: (fn) => db.transaction(fn),
      pragma: (statement) => db.pragma(statement),
      close: () => db.close()
    };
  }

  const nodeSqlite = tryLoadNodeSqlite();
  if (!nodeSqlite) {
    throw new Error(
      '找不到可用的 SQLite 驱动：better-sqlite3 原生模块不可用（需要编译或预编译包），' +
        '且当前 Node/Electron 不含 node:sqlite。请重新执行 pnpm install，或使用自带 Node 22 以上的 Electron。'
    );
  }

  const db = new nodeSqlite.DatabaseSync(file, { enableForeignKeyConstraints: true }) as {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  };
  let transactionSequence=0;

  return {
    driver: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      const normalize = makeNormalizer(sql);
      return {
        // 注意 node:sqlite 的差异：
        //  - 位置参数必须按位置逐个传（传数组会被当成命名参数 "0"）
        //  - 无参调用不能传 undefined
        run: (...args: unknown[]) =>
          args.length === 0 ? stmt.run() : stmt.run(...(args.map((a) => normalize(a)) as [])),
        get: (...args: unknown[]) =>
          plain(args.length === 0 ? stmt.get() : stmt.get(...(args.map((a) => normalize(a)) as []))),
        all: (...args: unknown[]) =>
          (args.length === 0
            ? (stmt.all() as unknown[])
            : (stmt.all(...(args.map((a) => normalize(a)) as [])) as unknown[])
          ).map((row) => plain(row))
      };
    },
    transaction: (fn) => {
      // Savepoints match better-sqlite3's nested transaction behavior. The outermost
      // release commits; an inner failure rolls back only its own savepoint.
      const wrapped = (...args: unknown[]): unknown => {
        const savepoint=`coldesk_tx_${++transactionSequence}`;
        db.exec(`SAVEPOINT ${savepoint}`);
        try {
          const result = fn(...(args as never[]));
          db.exec(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          db.exec(`RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        }
      };
      return wrapped as unknown as typeof fn;
    },
    pragma: (statement) => db.exec(`PRAGMA ${statement}`),
    close: () => db.close()
  };
}

/** 探针：让"设置"页能显示当前使用的驱动，也便于启动日志 */
export function detectDriver(): 'better-sqlite3' | 'node:sqlite' | 'none' {
  const better = tryLoadBetterSqlite3();
  if (better && betterSqlite3Works(better)) return 'better-sqlite3';
  if (tryLoadNodeSqlite()) return 'node:sqlite';
  return 'none';
}
