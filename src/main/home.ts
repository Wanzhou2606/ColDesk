import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { HomeEntry, HomeMonth, HomeStatus, HomeExportScope, HomeAsset } from '@shared/home';
import { validHomeDate } from '@shared/home';
import { nowLocal } from '@shared/time';
import { getDb } from './db';

interface Protection { version: 1; enabled: boolean; salt?: string; verifier?: string }
const CONFIG_KEY = 'home_protection_v1';
function config(): Protection | undefined {
  const row = getDb().prepare('SELECT value FROM setting WHERE key = ?').get(CONFIG_KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as Protection : undefined;
}
function writeConfig(value: Protection): void {
  getDb().prepare('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(CONFIG_KEY, JSON.stringify(value), nowLocal());
}
function derive(password: unknown, salt: string): Buffer {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128 || !password.trim()) throw new Error('密码需为 6–128 个字符');
  return scryptSync(password, Buffer.from(salt, 'base64'), 32);
}
function verifier(key: Buffer): string { return createHmac('sha256', key).update('ColDesk home password v1').digest('hex'); }
function encode(entry: { date: string }, key: Buffer | null): string {
  const data = JSON.stringify(entry);
  if (!key) return data;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(entry.date));
  const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  return JSON.stringify({ encrypted: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
}
function decode<T = HomeEntry>(date: string, payload: string, key: Buffer | null): T {
  const parsed = JSON.parse(payload);
  if (!parsed.encrypted) return parsed as T;
  if (!key) throw new Error('请先解锁 home');
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    cipher.setAAD(Buffer.from(date));
    cipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(parsed.data, 'base64')), cipher.final()]).toString('utf8')) as T;
  } catch { throw new Error('这篇日记暂时无法读取，请保留备份后重试'); }
}

/** 私密日记独立于广播状态；解锁密钥仅保存在当前主窗口会话中。 */
export class HomeVault {
  private sessions = new Map<number, Buffer | null>();
  private attempts = new Map<number, { count: number; until: number }>();
  private dirty = new Set<number>();
  status(sender: number): HomeStatus {
    const value = config();
    return { initialized: !!value, passwordEnabled: value?.enabled ?? false, unlocked: !!value && (!value.enabled || this.sessions.has(sender)) };
  }
  setup(sender: number, password?: unknown): HomeStatus {
    if (config()) throw new Error('home 已经初始化，请使用密码设置');
    this.changeProtection(sender, password, true);
    return this.status(sender);
  }
  unlock(sender: number, password: unknown): HomeStatus {
    const value = config();
    if (!value) throw new Error('请先选择 home 的进入方式');
    if (!value.enabled) return this.status(sender);
    const attempt = this.attempts.get(sender);
    if (attempt && attempt.until > Date.now()) throw new Error('尝试次数较多，请稍后再试');
    const key = derive(password, value.salt!);
    const actual = Buffer.from(verifier(key), 'hex'), expected = Buffer.from(value.verifier!, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      key.fill(0);
      const count = (attempt?.count ?? 0) + 1;
      this.attempts.set(sender, { count, until: count >= 5 ? Date.now() + 30_000 : 0 });
      throw new Error('密码不正确，请重试');
    }
    this.lock(sender);
    this.sessions.set(sender, key);
    this.attempts.delete(sender);
    return this.status(sender);
  }
  lock(sender: number): void { this.sessions.get(sender)?.fill(0); this.sessions.delete(sender); this.dirty.delete(sender); }
  setDirty(sender: number, dirty: boolean): void { if (dirty) this.dirty.add(sender); else this.dirty.delete(sender); }
  hasDraft(sender: number): boolean { return this.dirty.has(sender); }
  private key(sender: number): Buffer | null {
    const value = config();
    if (!value) throw new Error('请先选择 home 的进入方式');
    if (!value.enabled) return null;
    const key = this.sessions.get(sender);
    if (!key) throw new Error('请先解锁 home');
    return key;
  }
  get(sender: number, date: unknown): HomeEntry {
    const key = this.key(sender);
    if (!validHomeDate(date)) throw new Error('请选择有效的日记日期');
    const row = getDb().prepare('SELECT payload FROM home_entry WHERE date = ?').get(date) as { payload: string } | undefined;
    return row ? decode(date, row.payload, key) : { date, cover: '', body: '', weather: '', mood: '' };
  }
  month(sender: number, month: unknown): HomeMonth {
    const key = this.key(sender);
    if (typeof month !== 'string' || !validHomeDate(month + '-01')) throw new Error('请选择有效的月份');
    const rows = getDb().prepare('SELECT date, payload FROM home_entry WHERE date LIKE ? ORDER BY date').all(month + '-%') as Array<{ date: string; payload: string }>;
    return { month, entries: rows.map(row => { const entry = decode(row.date, row.payload, key); return { date: row.date, cover: entry.cover, weather: entry.weather, mood: entry.mood, title: entry.title, attachments: entry.attachments }; }) };
  }
  save(sender: number, input: unknown): HomeEntry {
    const key = this.key(sender);
    const value = (input ?? {}) as Partial<HomeEntry>;
    if (!validHomeDate(value.date)) throw new Error('请选择有效的日记日期');
    for (const [field, max] of [['cover', 160], ['body', 200_000], ['weather', 40], ['mood', 40]] as const) {
      if (typeof value[field] !== 'string' || value[field]!.length > max) throw new Error(field === 'cover' ? '封面请控制在 160 字以内' : '内容过长或填写不完整');
    }
    const entry: HomeEntry = { date: value.date, cover: value.cover!, body: value.body!, weather: value.weather!, mood: value.mood!, updatedAt: nowLocal() };
    if (value.title !== undefined) { if (typeof value.title !== 'string' || value.title.length > 100) throw new Error('小标题请控制在 100 字以内'); entry.title = value.title; }
    // 附件仅由主进程添加/删除，文本保存不能伪造或丢弃附件引用。
    const existing = this.get(sender, value.date);
    if (existing.attachments?.length) entry.attachments = existing.attachments;
    getDb().prepare('INSERT INTO home_entry (date,payload,updated_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at').run(entry.date, encode(entry, key), entry.updatedAt);
    return entry;
  }
  exportEntries(sender: number, input: unknown): HomeEntry[] {
    const key = this.key(sender);
    const selection = (input ?? {}) as HomeExportScope;
    let rows: Array<{ date: string; payload: string }>;
    if (selection.scope === 'all') rows = getDb().prepare('SELECT date,payload FROM home_entry ORDER BY date').all() as typeof rows;
    else if (selection.scope === 'month' && validHomeDate(selection.month + '-01')) rows = getDb().prepare('SELECT date,payload FROM home_entry WHERE date LIKE ? ORDER BY date').all(selection.month + '-%') as typeof rows;
    else if (selection.scope === 'day' && validHomeDate(selection.date)) rows = getDb().prepare('SELECT date,payload FROM home_entry WHERE date = ? ORDER BY date').all(selection.date) as typeof rows;
    else if (selection.scope === 'range' && validHomeDate(selection.start) && validHomeDate(selection.end) && selection.start <= selection.end) rows = getDb().prepare('SELECT date,payload FROM home_entry WHERE date >= ? AND date <= ? ORDER BY date').all(selection.start, selection.end) as typeof rows;
    else throw new Error('请选择有效的日记导出范围');
    return rows.map(row => decode(row.date, row.payload, key)).filter(entry => [entry.cover, entry.body, entry.weather, entry.mood, entry.title ?? ''].some(text => text.trim()) || !!entry.attachments?.length);
  }
  addAssets(sender: number, date: string, assets: HomeAsset[]): HomeEntry {
    const key = this.key(sender), entry = this.get(sender, date);
    if (!assets.length || assets.some(a => a.date !== date || !a.id || !a.name || !['photo','file'].includes(a.kind) || a.size > 25 * 1024 * 1024)) throw new Error('请选择有效的照片或文件（单个不超过 25 MB）');
    if ((entry.attachments?.length ?? 0) + assets.length > 60) throw new Error('每天最多保存 60 个附件');
    const next = { ...entry, attachments: [...(entry.attachments ?? []), ...assets.map(({ id, name, kind, size }) => ({ id, name, kind, size }))], updatedAt: nowLocal() };
    getDb().transaction(() => {
      getDb().prepare('INSERT INTO home_entry (date,payload,updated_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(date, encode(next,key), next.updatedAt);
      for (const asset of assets) getDb().prepare('INSERT INTO home_asset (id,date,payload) VALUES (?,?,?)').run(asset.id,date,encode(asset,key));
    })();
    return next;
  }
  asset(sender: number, date: unknown, id: unknown): HomeAsset {
    const key = this.key(sender), entry = this.get(sender, date);
    if (typeof id !== 'string' || !entry.attachments?.some(a => a.id === id)) throw new Error('附件不存在或已移除');
    const row = getDb().prepare('SELECT payload FROM home_asset WHERE id=? AND date=?').get(id,date) as {payload:string} | undefined;
    if (!row) throw new Error('附件暂时无法读取');
    const asset=decode<HomeAsset>(entry.date,row.payload,key);
    if(asset.id!==id||asset.date!==entry.date)throw new Error('附件校验失败，请保留备份后重试');
    return asset;
  }
  removeAsset(sender: number, date: unknown, id: unknown): HomeEntry {
    this.asset(sender,date,id);
    const entry = this.get(sender,date), key = this.key(sender);
    const next = { ...entry, attachments: entry.attachments!.filter(a => a.id !== id), updatedAt: nowLocal() };
    getDb().transaction(() => {
      getDb().prepare('UPDATE home_entry SET payload=?,updated_at=? WHERE date=?').run(encode(next,key),next.updatedAt,next.date);
      getDb().prepare('DELETE FROM home_asset WHERE id=? AND date=?').run(id,next.date);
    })();
    return next;
  }
  changeProtection(sender: number, password?: unknown, initial = false): void {
    const oldKey = initial ? null : this.key(sender);
    const enabled = password !== undefined && password !== '';
    const salt = enabled ? randomBytes(16).toString('base64') : undefined;
    const newKey = enabled ? derive(password, salt!) : null;
    const next: Protection = { version: 1, enabled, ...(enabled ? { salt, verifier: verifier(newKey!) } : {}) };
    try {
      getDb().transaction(() => {
        const rows = getDb().prepare('SELECT date,payload FROM home_entry').all() as Array<{ date: string; payload: string }>;
        for (const row of rows) getDb().prepare('UPDATE home_entry SET payload=? WHERE date=?').run(encode(decode(row.date, row.payload, oldKey), newKey), row.date);
        const assets = getDb().prepare('SELECT id,date,payload FROM home_asset').all() as Array<{id:string;date:string;payload:string}>;
        for (const row of assets) getDb().prepare('UPDATE home_asset SET payload=? WHERE id=?').run(encode(decode<HomeAsset>(row.date,row.payload,oldKey),newKey),row.id);
        writeConfig(next);
      })();
    } catch (error) { newKey?.fill(0); throw error; }
    for (const id of this.sessions.keys()) this.lock(id);
    this.sessions.set(sender, newKey);
  }
}
export const homeVault = new HomeVault();
