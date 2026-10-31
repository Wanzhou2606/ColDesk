import {strict as assert} from 'node:assert';
import {describe,it} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {externalChangeCheck} from '../externalChanges';

describe('外部写入刷新',()=>{
 it('自身写入不刷新；WAL 中的外部提交即时识别，连续提交不漏掉',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coldesk-watch-')),file=join(dir,'test.db');const own=new DatabaseSync(file),external=new DatabaseSync(file);let reloads=0;
  try{own.exec('PRAGMA journal_mode=WAL; CREATE TABLE value(n INTEGER)');const read=()=>Number(own.prepare('PRAGMA data_version').get()!.data_version);const check=externalChangeCheck(read,()=>{reloads++;});own.exec('INSERT INTO value VALUES(1)');assert.equal(check(),false);external.exec('INSERT INTO value VALUES(2)');assert.equal(check(),true);assert.equal(check(),false);external.exec('INSERT INTO value VALUES(3)');assert.equal(check(),true);assert.equal(reloads,2);}finally{external.close();own.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('刷新失败后保留版本重试；刷新期间新提交仍会在下次处理',()=>{
  let version=1,fail=true,reloads=0;const check=externalChangeCheck(()=>version,()=>{if(fail)throw Error('locked');reloads++;version++;});version=2;assert.throws(check);fail=false;assert.equal(check(),true);assert.equal(check(),true);assert.equal(reloads,2);
 });
});
