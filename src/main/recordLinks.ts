import { getDb } from './db';
import { validHomeDate } from '@shared/home';
import { nowLocal } from '@shared/time';
export function recordLinks(input:{date?:unknown;expenseId?:unknown}){
 if(input.date!==undefined&&!validHomeDate(input.date))throw new Error('请选择有效日期');
 if(input.expenseId!==undefined&&(typeof input.expenseId!=='string'||input.expenseId.length>160))throw new Error('请选择有效记账记录');
 if(!input.date&&!input.expenseId)throw new Error('请选择日记或记账记录');
 const where=input.date?'l.diary_date=?':'l.source_id=?';
 return getDb().prepare(`SELECT l.diary_date AS diaryDate,e.id AS expenseId,e.occurred_on AS date,e.amount,e.note FROM journal_link l JOIN expense_entry e ON e.id=l.source_id WHERE l.source_kind='expense' AND ${where} ORDER BY l.diary_date DESC,e.created_at DESC`).all(input.date??input.expenseId);
}
export function editRecordLink(input:{date?:unknown;expenseId?:unknown},remove=false){
 if(!validHomeDate(input.date)||typeof input.expenseId!=='string'||input.expenseId.length>160)throw new Error('请选择有效日期和记账记录');
 if(!getDb().prepare('SELECT id FROM expense_entry WHERE id=?').get(input.expenseId))throw new Error('这笔记账已不存在');
 if(remove)getDb().prepare("DELETE FROM journal_link WHERE source_kind='expense' AND source_id=? AND diary_date=?").run(input.expenseId,input.date);
 else getDb().prepare("INSERT OR IGNORE INTO journal_link(source_kind,source_id,diary_date,created_at) VALUES('expense',?,?,?)").run(input.expenseId,input.date,nowLocal());
 return true;
}
export function linkExpenseChoices(date:unknown,expenseId?:unknown){
 if(date!==undefined&&date!==''&&!validHomeDate(date))throw new Error('请选择有效日期');
 if(expenseId!==undefined&&(typeof expenseId!=='string'||!expenseId||expenseId.length>160))throw new Error('请选择有效记账记录');
 return getDb().prepare(`SELECT id,id AS expenseId,category_id AS categoryId,created_at AS createdAt,occurred_on AS date,amount,note FROM expense_entry ${expenseId?'WHERE id=?':date?'WHERE occurred_on=?':''} ORDER BY occurred_on DESC,created_at DESC LIMIT 200`).all(...(expenseId?[expenseId]:date?[date]:[]));
}
