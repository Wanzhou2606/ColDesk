import {strict as assert} from 'node:assert';
import {before,after,describe,it} from 'node:test';
process.env.COLDESK_DB_FACTORY='fake';
describe('日记与记账关联',()=>{
 let db:any,repos:any,links:any,entry:any;
 before(async()=>{db=await import('../db/index.ts');repos=await import('../db/repositories.ts');links=await import('../recordLinks.ts');db.initDatabase('.',':memory:');db.initializeUserData();entry=repos.addExpenseEntry({categoryId:repos.getExpenseCategories()[0].id,amount:12.5,date:'2020-01-01',note:'早期记录'});});
 after(()=>db.closeDatabase());
 it('可双向读取、去重，且不存放日记正文',()=>{links.editRecordLink({date:'2026-10-16',expenseId:entry.id});links.editRecordLink({date:'2026-10-16',expenseId:entry.id});const a=links.recordLinks({date:'2026-10-16'}),b=links.recordLinks({expenseId:entry.id});assert.equal(a.length,1);assert.deepEqual(a,b);assert.equal(a[0].note,'早期记录');assert.equal('body' in a[0],false);});
 it('历史记录可以精确定位，日期和来源需要有效',()=>{assert.equal(links.linkExpenseChoices(undefined,entry.id)[0].id,entry.id);assert.throws(()=>links.editRecordLink({date:'2026-02-30',expenseId:entry.id}));assert.throws(()=>links.editRecordLink({date:'2026-10-16',expenseId:'missing'}));});
 it('解除关联保留原记录，删除支出会清理关联',()=>{links.editRecordLink({date:'2026-10-16',expenseId:entry.id},true);assert.equal(links.recordLinks({expenseId:entry.id}).length,0);assert.equal(links.linkExpenseChoices(undefined,entry.id).length,1);links.editRecordLink({date:'2026-10-16',expenseId:entry.id});repos.deleteExpenseEntry(entry.id);assert.equal(links.recordLinks({date:'2026-10-16'}).length,0);assert.equal(db.getDb().prepare("SELECT COUNT(*) AS c FROM journal_link").get().c,0);});
});
