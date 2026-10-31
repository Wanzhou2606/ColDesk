/** 审计实际发行归档与隔离启动生成的数据库。 */
const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const packageDir=path.resolve(process.argv[2]||path.join(root,'release/win-unpacked'));
const requireBuilder=createRequire(require.resolve('electron-builder'));
const requireLib=createRequire(requireBuilder.resolve('app-builder-lib'));
const asar=requireLib('@electron/asar');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const archive=path.join(packageDir,'resources/app.asar');
const files=asar.listPackage(archive).map(file=>file.replaceAll('\\','/'));
assert(!files.some(f=>/\.db(?:-|$)|\.log$|[/\\](?:preview|scripts|src|node_modules)[/\\]/.test(f)),'发行归档混入数据库、日志或开发文件');
assert(!files.some(f=>/assistant\.local\.json|developer\.local\.json/.test(f)),'发行归档混入个人连接配置');
for(const file of ['out/main/index.cjs','out/preload/index.cjs','out/renderer/main.html','out/renderer/widget.html','out/renderer/assets','out/main/icons/app-icon-256.png'])assert(files.includes('/'+file),'归档缺少 '+file);
const metadata=JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));
const main=asar.extractFile(archive,path.join('out','main','index.cjs')).toString('utf8');
assert(!/Bearer [A-Za-z0-9_-]{8,}/.test(main),'发行包仍有写死的助手凭证');
assert(metadata.version===require('../package.json').version&&!metadata.dependencies&&!metadata.optionalDependencies,'发行元数据或独立运行依赖不正确');
assert(fs.existsSync(path.join(packageDir,'resources/app-icon.ico')),'缺少归档外的 Windows 图标');
assert(fs.existsSync(path.join(packageDir,'resources/assistant-reader.cjs')),'缺少助手课表读取器');
const reader=fs.readFileSync(path.join(packageDir,'resources/assistant-reader.cjs'),'utf8');
assert(!/Bearer |coldesk\.db|[A-Z]:\\Users\\[^\\\s]+/.test(reader),'助手读取器混入本机配置');
const pe=fs.readFileSync(path.join(packageDir,'ColDesk.exe'));const offset=pe.readUInt32LE(0x3c);assert(pe.readUInt16LE(offset+4)===0x8664,'应用不是 Windows x64 程序');
const report={ok:true,version:metadata.version,arch:'x64',fileCount:files.length,personalDataExcluded:true,externalDependencies:0};
if(process.argv[3]){
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(path.join(path.resolve(process.argv[3]),'coldesk.db'),{readOnly:true});
  report.tables=db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
  for(const table of ['goal_node','goal_event','goal_progress','goal_preference','calendar_event'])assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),'安装启动缺少 '+table);
  assert(report.tables>=26,'安装启动没有建齐数据表');
  for(const table of ['task','course','expense_entry','habit','home_entry','home_asset','goal_node','goal_event','goal_progress','goal_preference','calendar_event'])assert(db.prepare('SELECT count(*) AS n FROM '+table).get().n===0,'新用户带有其他人的 '+table);
  report.freshUser=true;db.close();
}
const reportPath=path.join(root,'preview/installer-check');fs.mkdirSync(reportPath,{recursive:true});fs.writeFileSync(path.join(reportPath,'distribution-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
