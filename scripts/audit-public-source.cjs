/** Inspect exactly what Git will publish; never read personal configuration files. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const result=spawnSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8',windowsHide:true});
if(result.status!==0)throw Error('Run from a Git checkout.');
const files=[...new Set(result.stdout.split('\0').filter(Boolean))];
if(!files.length)throw Error('Stage the intended public files before auditing.');
const issues=[];
const forbidden=/(^|\/)(?:node_modules|preview|output|release|tmp|backup|backups|userData|\.gradle|\.idea)(\/|$)|(?:^|\/)(?:developer\.local\.json|assistant\.local\.json|local\.properties|\.env(?:\..+)?|COLDESK-改动交接\.md)$|\.(?:db(?:-wal|-shm)?|sqlite3?|log|jks|keystore|pfx|p12|pem|key|exe|apk|aab)$/i;
const credential=/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|(?:_authToken|appSecret|access_token)\s*[=:]\s*["']?[A-Za-z0-9_/-]{24,}|Bearer\s+[A-Za-z0-9_-]{30,}/;
for(const file of files){
 if(forbidden.test(file)||/assets\/icons\/character-/.test(file)){issues.push({file,reason:'personal/generated path'});continue;}
 const absolute=path.resolve(root,file);if(!absolute.startsWith(root+path.sep)||!fs.existsSync(absolute)){issues.push({file,reason:'missing or invalid path'});continue;}
 const bytes=fs.readFileSync(absolute);const licensedFont=file==='mobile/public/handwriting.ttf'&&files.includes('mobile/public/OFL-MaShanZheng.txt');if(bytes.length>5*1024*1024&&!licensedFont)issues.push({file,reason:'file exceeds 5 MB; use a Release for distributions'});
 if(!/\.(?:png|ico|jpg|jpeg|webp|gif|jar|pdf|ttf|woff2?)$/i.test(file)){
   const text=bytes.toString('utf8');if(credential.test(text))issues.push({file,reason:'possible access credential'});
   if(/(?:C:\\\\Users\\\\|C:\\Users\\|C:\/Users\/)[A-Za-z0-9_.-]+/.test(text))issues.push({file,reason:'absolute personal profile path'});
   if(/className\s*:\s*["']\d{8}["']|classNo\s*:\s*["']\(\d{4}-\d{4}-\d\)-/.test(text))issues.push({file,reason:'real classroom fixture identity'});
 }
}
for(const file of ['README.md','LICENSE','CONTRIBUTING.md','SECURITY.md','THIRD_PARTY_NOTICES.md','assets/icons/app-icon.svg'])if(!files.includes(file))issues.push({file,reason:'required public file missing'});
if(issues.length){console.error(JSON.stringify({ok:false,checked:files.length,issues},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,checked:files.length,personalPathsExcluded:true,commonCredentialPatternsAbsent:true}));
