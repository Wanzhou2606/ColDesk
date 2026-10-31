/** Resolve an already installed pnpm without changing system PATH or downloading packages. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function packageManagerEnvironment(root){
  const probe=spawnSync('pnpm --version',{cwd:root,shell:true,windowsHide:true,timeout:5000,encoding:'utf8'});
  if(probe.status===0&&/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/m.test(probe.stdout?.trim()??''))return process.env;
  const home=process.env.USERPROFILE??'';
  const candidates=[process.env.PNPM_CLI_JS,path.join(path.dirname(process.execPath),'node_modules/pnpm/bin/pnpm.cjs'),path.join(home,'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs')].filter(Boolean);
  const script=candidates.find(file=>fs.existsSync(file));
  if(!script)throw Error('未找到可用的 pnpm。请安装 pnpm 或设置 PNPM_CLI_JS 指向已有的 pnpm 入口。');
  const folder=path.join(root,'build/package-manager');fs.mkdirSync(folder,{recursive:true});
  const escape=value=>value.replaceAll('%','%%').replaceAll('"','');
  fs.writeFileSync(path.join(folder,'pnpm.cmd'),'@echo off\r\n"'+escape(process.execPath)+'" "'+escape(script)+'" %*\r\n');
  return {...process.env,PATH:folder+path.delimiter+(process.env.PATH??'')};
}
module.exports={packageManagerEnvironment};
