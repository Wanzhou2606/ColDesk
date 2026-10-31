const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const {packageManagerEnvironment}=require('./package-manager.cjs');
const root = path.resolve(__dirname,'..');
const runtime=path.join(root,'node_modules/electron/dist/electron.exe');
function run(command,args,env=process.env){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
if(!fs.existsSync(runtime))run(process.execPath,['node_modules/electron/install.js']);
run(process.execPath,['scripts/typecheck.mjs']);
run(process.execPath,['node_modules/electron-vite/bin/electron-vite.js','build']);
run(process.execPath,['scripts/build-assistant-reader.cjs']);
const guiEnv={...process.env};delete guiEnv.ELECTRON_RUN_AS_NODE;
run(runtime,['scripts/render-installer-art.cjs'],guiEnv);
run(process.execPath,['scripts/prepare-distribution.cjs']);
// 新版 pnpm 默认会在 exec 前重新安装依赖。这里已使用完成检查的专用发行目录，
// 包管理器只用于读取工作区信息；不让打包步骤修改开发依赖或等待网络。
run(process.execPath,['node_modules/electron-builder/cli.js','--config','electron-builder.cjs','--win','nsis','--x64'],{...packageManagerEnvironment(root),pnpm_config_verify_deps_before_run:'false'});
run(process.execPath,['scripts/verify-distribution.cjs']);
const crypto=require('node:crypto');const version=require('../package.json').version;
const installer=path.join(root,'release',`ColDesk-${version}-Windows-x64-Setup.exe`);
const digest=crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
fs.writeFileSync(installer+'.sha256',`${digest}  ${path.basename(installer)}\n`);
console.log('Windows 安装包已就绪：'+installer);
if(!process.argv.includes('--no-install'))run(process.execPath,['scripts/install-local.cjs']);
