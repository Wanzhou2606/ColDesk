const {strict:assert}=require('node:assert'),{test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {deployAssistant,discoverAssistantTargets}=require('../assistant-deployment.cjs');
const old=Buffer.from('old reader'),fresh=Buffer.from('shared reader');
function cleanup(home){const target=path.resolve(home),parent=path.resolve(os.tmpdir());if(path.dirname(target)!==parent||!path.basename(target).startsWith('coldesk-deployment-'))throw Error('Unsafe fixture path');fs.rmSync(target,{recursive:true,force:true});}
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'coldesk-deployment-'));
 const source=path.join(home,'.dsh/vendor/dsh-qq-tools/scripts/desk.js');
 const dir=path.join(home,'.dsh/profiles/desktop/node_modules/dsh-qq-tools'),active=path.join(dir,'scripts/desk.js');
 fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,fresh);
 fs.mkdirSync(path.dirname(active),{recursive:true});fs.writeFileSync(active,old);
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'dsh-qq-tools',main:'index.js'}));fs.writeFileSync(path.join(dir,'index.js'),'');
 fs.writeFileSync(path.join(home,'.dsh/profiles/desktop/package.json'),'{}');
 return {home,source,active,backupDir:path.join(home,'backup'),replacement:fresh,originalHash:crypto.createHash('sha256').update(old).digest('hex')};
}
test('源码已经更新时仍修复实际运行的安装副本，重复运行保持幂等',()=>{
 const f=fixture();try{
  const targets=discoverAssistantTargets(f.home);assert.equal(targets.length,2);assert.ok(targets.some(t=>t.kind==='profile:desktop'));
  const result=deployAssistant(f);assert.equal(result.filter(t=>t.updated).length,1);assert.deepEqual(fs.readFileSync(f.active),fresh);assert.deepEqual(fs.readFileSync(result.find(t=>t.updated).backup),old);
  assert.equal(deployAssistant(f).filter(t=>t.updated).length,0);
 }finally{cleanup(f.home);}
});
test('任意副本存在未知修改时，在改变其他位置之前停止',()=>{
 const f=fixture();try{fs.writeFileSync(f.source,old);fs.writeFileSync(f.active,'unreviewed change');assert.throws(()=>deployAssistant(f),/其他修改/);assert.deepEqual(fs.readFileSync(f.source),old);assert.equal(fs.existsSync(f.backupDir),false);}finally{cleanup(f.home);}
});
test('原子替换不修改 pnpm 的硬链接来源',()=>{
 const f=fixture();try{const store=path.join(f.home,'store.js');fs.linkSync(f.active,store);deployAssistant(f);assert.deepEqual(fs.readFileSync(store),old);assert.deepEqual(fs.readFileSync(f.active),fresh);}finally{cleanup(f.home);}
});
