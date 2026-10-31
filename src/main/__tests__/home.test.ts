import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { homeMonthDays, shiftHomeMonth, validHomeDate } from '@shared/home';
import type { HomeEntry, HomeAsset } from '@shared/home';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHomeExport } from '../homeExport';
process.env.COLDESK_DB_FACTORY = 'fake';
let db: typeof import('../db/index');
let HomeVault: typeof import('../home').HomeVault;
const entry: HomeEntry = { date: '2026-10-10', cover: '给自己一点温柔', body: '今天的日记正文\n第二段文字。', weather: '☀️ 晴天', mood: '🌿 平静' };
describe('home：日记与密码保护', () => {
  before(async () => { db = await import('../db/index'); HomeVault = (await import('../home')).HomeVault; });
  after(() => db.closeDatabase());
  const fresh = () => { try { db.closeDatabase(); } catch {} db.initDatabase('.', ':memory:'); return new HomeVault(); };
  it('首次必须选择进入方式，无密码模式完整保留日记字段', () => {
    const vault = fresh();
    assert.deepEqual(vault.status(1), { initialized: false, passwordEnabled: false, unlocked: false });
    assert.throws(() => vault.month(1, '2026-10'), /先选择/);
    vault.setup(1);
    vault.save(1, entry);
    assert.deepEqual({ ...vault.get(1, entry.date), updatedAt: undefined }, { ...entry, updatedAt: undefined });
    assert.equal(new HomeVault().get(2, entry.date).cover, entry.cover);
  });
  it('月历只返回封面和元信息，不把正文发到月视图', () => {
    const vault = fresh(); vault.setup(1); vault.save(1, entry);
    const month = vault.month(1, '2026-10');
    assert.equal(month.entries[0].cover, entry.cover);
    assert.equal('body' in month.entries[0], false);
    assert.equal(vault.month(1, '2026-11').entries.length, 0);
  });
  it('导出按范围筛选、按日期排序，忽略空白日记并校验范围', () => {
    const vault = fresh(); vault.setup(1);
    vault.save(1, { ...entry, date: '2026-11-02' }); vault.save(1, entry);
    vault.save(1, { date: '2026-10-01', cover: ' ', body: '', weather: '', mood: '' });
    assert.deepEqual(vault.exportEntries(1, { scope: 'all' }).map(e => e.date), ['2026-10-10','2026-11-02']);
    assert.equal(vault.exportEntries(1, { scope: 'month', month: '2026-10' }).length, 1);
    assert.equal(vault.exportEntries(1, { scope: 'day', date: entry.date })[0].body, entry.body);
    assert.equal(vault.exportEntries(1, { scope: 'month', month: '2026-12' }).length, 0);
    assert.throws(() => vault.exportEntries(1, { scope: 'month', month: '2026-13' }), /有效/);
    assert.throws(() => vault.exportEntries(1, { scope: 'day', date: '../secret' }), /有效/);
  });
  it('加密日记仅在当前解锁会话中可导出，重新锁定后不可导出', () => {
    const vault = fresh(); vault.setup(1, 'garden-test-2026'); vault.save(1, entry);
    assert.equal(vault.exportEntries(1, { scope: 'all' })[0].body, entry.body);
    assert.throws(() => vault.exportEntries(2, { scope: 'all' }), /解锁/);
    vault.lock(1); assert.throws(() => vault.exportEntries(1, { scope: 'all' }), /解锁/);
  });
  it('相册日记和小标题可按包含边界的日期范围导出',()=>{
    const vault=fresh();vault.setup(1);vault.save(1,{...entry,title:'周末散步'});
    vault.addAssets(1,'2026-10-11',[{id:'asset-one',date:'2026-10-11',name:'散步.png',kind:'photo',size:3,data:'YWJj'}]);
    assert.deepEqual(vault.exportEntries(1,{scope:'range',start:'2026-10-10',end:'2026-10-11'}).map(e=>e.date),['2026-10-10','2026-10-11']);
    assert.equal(vault.get(1,entry.date).title,'周末散步');
    assert.throws(()=>vault.exportEntries(1,{scope:'range',start:'2026-10-11',end:'2026-10-10'}),/有效/);
  });
  it('附件跟随密码重加密、锁定拒绝读取，文本保存保留附件且不能伪造跨日引用',()=>{
    const vault=fresh();vault.setup(1,'old-password');vault.save(1,entry);
    const file:HomeAsset={id:'asset-two',date:entry.date,name:'私人文件.txt',kind:'file',size:6,data:Buffer.from('秘密文件').toString('base64')};
    vault.addAssets(1,entry.date,[file]);
    vault.save(1,{...entry,attachments:[{id:'forged',name:'伪造',kind:'file',size:1}]});
    assert.equal(vault.get(1,entry.date).attachments![0].id,file.id);
    const raw=db.getDb().prepare('SELECT payload FROM home_asset').get() as {payload:string};assert.ok(!raw.payload.includes(file.name));assert.ok(!raw.payload.includes(file.data));
    assert.throws(()=>vault.asset(2,entry.date,file.id),/解锁/);
    assert.throws(()=>vault.asset(1,'2026-10-11',file.id),/不存在/);
    vault.changeProtection(1,'new-password');vault.lock(1);assert.throws(()=>vault.asset(1,entry.date,file.id),/解锁/);
    vault.unlock(1,'new-password');assert.equal(vault.asset(1,entry.date,file.id).data,file.data);
    vault.changeProtection(1);assert.equal(new HomeVault().asset(2,entry.date,file.id).name,file.name);
    vault.removeAsset(1,entry.date,file.id);assert.equal(vault.get(1,entry.date).attachments!.length,0);assert.throws(()=>vault.asset(1,entry.date,file.id),/不存在/);
  });
  it('Word 日记嵌入照片，标题使用日期和小标题，总览合并多天，文件附件保留原文',async()=>{
    const parent=await mkdtemp(join(tmpdir(),'coldesk-word-'));
    const require=createRequire(import.meta.url),JSZip=createRequire(require.resolve('docx'))('jszip');
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBc8AAAAASUVORK5CYII=';
    const photo:HomeAsset={id:'photo-123',date:entry.date,name:'小小照片.png',kind:'photo',size:68,data:png,image:{data:png,width:1,height:1}};
    const file:HomeAsset={id:'file-1234',date:entry.date,name:'原始内容.txt',kind:'file',size:6,data:Buffer.from('附件内容').toString('base64')};
    const records=[{...entry,title:'周末 / 记录',attachments:[photo,file]},{...entry,date:'2026-10-11',title:'第二天'}];
    try{
      const folder=await writeHomeExport(parent,records,{scope:'all',format:'txt',mode:'diary'},(_date,id)=>id===photo.id?photo:file);
      assert.ok((await readdir(folder)).includes('2026-10-10 周末 记录.docx'));
      const zip=await JSZip.loadAsync(await readFile(join(folder,'2026-10-10 周末 记录.docx')));
      const xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes('2026-10-10 周末 / 记录'));assert.ok(xml.includes('日记正文'));assert.ok(xml.includes('w:drawing'));assert.ok(Object.keys(zip.files).some(k=>k.startsWith('word/media/')&&k.endsWith('.png')));
      assert.equal(await readFile(join(folder,'2026-10-10-附件','file-123-原始内容.txt'),'utf8'),'附件内容');
      const overview=await writeHomeExport(parent,records,{scope:'all',mode:'overview'},(_date,id)=>id===photo.id?photo:file);
      assert.deepEqual((await readdir(overview)).filter(n=>n.endsWith('.docx')),['心灵日记总览.docx']);
      const all=await JSZip.loadAsync(await readFile(join(overview,'心灵日记总览.docx')));const allXml=await all.file('word/document.xml').async('string');assert.ok(allXml.includes('2026-10-11 第二天'));assert.ok(allXml.includes('w:drawing'));
      const before=(await readdir(parent)).length;await assert.rejects(()=>writeHomeExport(parent,records,{scope:'all',mode:'overview'},()=>{throw new Error('丢失附件');}),/丢失附件/);assert.equal((await readdir(parent)).length,before);
    }finally{await rm(parent,{recursive:true,force:true});}
  });
  it('TXT 导出保留中文、换行和全部字段，重复导出不覆盖文件', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'coldesk-export-'));
    try {
      const first = await writeHomeExport(parent, [entry]);
      const text = await readFile(join(first, entry.date + '.txt'), 'utf8');
      assert.ok(text.startsWith('\uFEFF')); assert.ok(text.includes('天气：' + entry.weather)); assert.ok(text.includes('心情：' + entry.mood));
      assert.ok(text.includes(entry.cover)); assert.ok(text.includes(entry.body.replace(/\n/g, '\r\n')));
      const second = await writeHomeExport(parent, [{ ...entry, body: '新的内容' }]);
      assert.notEqual(first, second); assert.equal(await readFile(join(first,entry.date + '.txt'),'utf8'), text);
      await assert.rejects(() => writeHomeExport(parent, []), /没有日记/);
      await assert.rejects(() => writeHomeExport(parent, [{ ...entry, date: '../bad' }]), /日期异常/);
      assert.equal((await readdir(parent)).length, 2);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it('密码模式数据库不出现封面、正文、天气或密码明文', () => {
    const vault = fresh(); vault.setup(1, 'garden-test-2026'); vault.save(1, entry);
    const row = db.getDb().prepare('SELECT payload FROM home_entry').get() as { payload: string };
    for (const value of [entry.cover, entry.body, entry.weather, 'garden-test-2026']) assert.ok(!row.payload.includes(value));
    const config = db.getDb().prepare("SELECT value FROM setting WHERE key='home_protection_v1'").get() as { value: string };
    assert.ok(!config.value.includes('garden-test-2026'));
    assert.equal(vault.get(1, entry.date).body, entry.body);
  });
  it('未解锁或其他窗口不能读取月历、正文，不能写入或移除密码', () => {
    const vault = fresh(); vault.setup(1, 'garden-test-2026'); vault.save(1, entry);
    for (const action of [() => vault.month(2, '2026-10'), () => vault.get(2, entry.date), () => vault.save(2, entry), () => vault.changeProtection(2)]) assert.throws(action, /解锁/);
    vault.lock(1); assert.throws(() => vault.get(1, entry.date), /解锁/);
  });
  it('错误密码失败，正确密码解锁，重建会话后仍要输入密码', () => {
    const vault = fresh(); vault.setup(1, 'garden-test-2026'); vault.save(1, entry); vault.lock(1);
    assert.throws(() => vault.unlock(1, 'wrong-password'), /密码不正确/);
    assert.equal(vault.status(1).unlocked, false);
    vault.unlock(1, 'garden-test-2026'); assert.equal(vault.get(1, entry.date).cover, entry.cover);
    const reopened = new HomeVault(); assert.equal(reopened.status(1).unlocked, false);
    reopened.unlock(1, 'garden-test-2026'); assert.equal(reopened.get(1, entry.date).body, entry.body);
  });
  it('更换密码重新加密所有日记，旧密码不可用且其他会话失效', () => {
    const vault = fresh(); vault.setup(1, 'old-password'); vault.save(1, entry); vault.unlock(2, 'old-password');
    vault.changeProtection(1, 'new-password');
    assert.equal(vault.status(2).unlocked, false);
    vault.lock(1); assert.throws(() => vault.unlock(1, 'old-password'), /密码不正确/);
    vault.unlock(1, 'new-password'); assert.equal(vault.get(1, entry.date).body, entry.body);
  });
  it('无密码日记后来设置密码也会加密，取消密码后内容保留', () => {
    const vault = fresh(); vault.setup(1); vault.save(1, entry); vault.changeProtection(1, 'new-password');
    assert.equal(vault.get(1, entry.date).cover, entry.cover);
    const protectedRow = db.getDb().prepare('SELECT payload FROM home_entry').get() as { payload: string };
    assert.ok(!protectedRow.payload.includes(entry.body));
    vault.changeProtection(1);
    assert.equal(new HomeVault().get(2, entry.date).body, entry.body);
  });
  it('密码变更失败不能破坏原配置和内容', () => {
    const vault = fresh(); vault.setup(1, 'old-password'); vault.save(1, entry);
    assert.throws(() => vault.changeProtection(1, '123'), /密码需为/);
    assert.equal(vault.get(1, entry.date).body, entry.body);
    assert.equal(vault.status(1).passwordEnabled, true);
  });
  it('拒绝不存在的日期、异常月份与超长封面', () => {
    const vault = fresh(); vault.setup(1);
    assert.throws(() => vault.save(1, { ...entry, date: '2026-02-30' }), /有效/);
    assert.throws(() => vault.month(1, "2026-10' OR 1=1"), /有效/);
    assert.throws(() => vault.save(1, { ...entry, cover: '文'.repeat(161) }), /160/);
    assert.equal(validHomeDate('2024-02-29'), true); assert.equal(validHomeDate('2026-02-29'), false);
  });
  it('加密正文被篡改后读取失败，而不会显示乱码或部分内容', () => {
    const vault = fresh(); vault.setup(1, 'old-password'); vault.save(1, entry);
    const raw = db.getDb().prepare('SELECT payload FROM home_entry').get() as { payload: string };
    const data = JSON.parse(raw.payload); data.data = Buffer.from('tampered').toString('base64');
    db.getDb().prepare('UPDATE home_entry SET payload=?').run(JSON.stringify(data));
    assert.throws(() => vault.get(1, entry.date), /无法读取/);
  });
  it('连续错误密码会短暂限制重试', () => {
    const vault = fresh(); vault.setup(1, 'old-password'); vault.lock(1);
    for(let i=0;i<5;i++) assert.throws(()=>vault.unlock(1,'wrong-password'),/密码不正确/);
    assert.throws(()=>vault.unlock(1,'old-password'),/稍后再试/);
  });
  it('月视图从周一开始，跨年与闰年不会错位', () => {
    assert.equal(shiftHomeMonth('2026-12',1),'2027-01');
    const days=homeMonthDays('2024-02');
    assert.equal(days.filter(Boolean).length,29);
    assert.equal(days[3],'2024-02-01');
    assert.equal(days.length%7,0);
  });
});
