const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};

/** A file: dependency may be copied into node_modules; resolve the installed entry too. */
function discoverAssistantTargets(home){
 const root=path.resolve(home,'.dsh'),found=[];
 if(!fs.existsSync(root))return [];
 const vendor=path.join(root,'vendor/dsh-qq-tools/scripts/desk.js');
 if(fs.existsSync(vendor))found.push({kind:'source',file:vendor});
 for(const profile of ['desktop','qqbot','sdk']){
  const metadata=path.join(root,'profiles',profile,'package.json');
  if(!fs.existsSync(metadata))continue;
  let entry;try{entry=createRequire(metadata).resolve('dsh-qq-tools');}catch{continue;}
  const file=path.join(path.dirname(entry),'scripts/desk.js');
  if(!fs.existsSync(file))throw Error('助手模块缺少读取入口：'+file);
  found.push({kind:'profile:'+profile,file,entry});
 }
 const seen=new Set();
 return found.flatMap(target=>{
  const file=fs.realpathSync(target.file),identity=process.platform==='win32'?file.toLowerCase():file;
  if(!inside(fs.realpathSync(root),file))throw Error('助手入口不在指定配置目录内：'+file);
  if(seen.has(identity))return [];seen.add(identity);return [{...target,file}];
 });
}

function deployAssistant({home,replacement,originalHash,backupDir}){
 const targets=discoverAssistantTargets(home),replacementHash=hash(replacement);
 // Validate all destinations before changing any of them.
 const plans=targets.map(target=>{
  const current=fs.readFileSync(target.file),currentHash=hash(current);
  if(currentHash!==replacementHash&&currentHash!==originalHash)throw Error('助手入口存在其他修改，已停止覆盖：'+target.file);
  return {...target,current,changed:currentHash!==replacementHash};
 });
 const results=[];
 for(const plan of plans){
  let backup;
  if(plan.changed){
   fs.mkdirSync(backupDir,{recursive:true});
   backup=path.join(backupDir,'desk-'+Date.now()+'-'+hash(Buffer.from(plan.file)).slice(0,10)+'.js');
   fs.writeFileSync(backup,plan.current,{flag:'wx'});
   const temporary=plan.file+'.'+process.pid+'.coldesk.tmp';
   fs.writeFileSync(temporary,replacement,{flag:'wx'});
   // Replace the entry rather than modifying a pnpm store hard link in place.
   try{fs.renameSync(temporary,plan.file);}catch(error){fs.unlinkSync(temporary);throw error;}
  }
  if(hash(fs.readFileSync(plan.file))!==replacementHash)throw Error('助手入口更新校验失败：'+plan.file);
  results.push({kind:plan.kind,file:plan.file,entry:plan.entry,updated:plan.changed,backup});
 }
 return results;
}
module.exports={discoverAssistantTargets,deployAssistant};
