const {spawnSync,spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {localDevelopment,root}=require('./local-development.cjs');
const config=localDevelopment();if(!config){console.log('本机未启用自动安装，安装包已保留。');process.exit(0);}
const version=require('../package.json').version,installer=path.join(root,'release',`ColDesk-${version}-Windows-x64-Setup.exe`),target=path.join(config.installDirectory,'ColDesk.exe');
if(!fs.existsSync(installer))throw new Error('请先生成最新版安装包');
const environment={...process.env};
for(const key of ['ELECTRON_RUN_AS_NODE','COLDESK_PROFILE_DIR','COLDESK_SEED_SAMPLE','COLDESK_DISABLE_SCHEDULER','COLDESK_DB_FACTORY','ELECTRON_RENDERER_URL'])delete environment[key];
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
function run(command,args,timeout=60000){const result=spawnSync(command,args,{cwd:root,env:environment,windowsHide:true,stdio:'inherit',timeout});if(result.error)throw result.error;if(result.status!==0)throw new Error('自动安装步骤未完成，退出码：'+result.status);}
if(fs.existsSync(target))run(target,['--quit-for-update']);
// 只检查本项目和安装目录的实例，不影响其他 Electron 应用。
const waitScript=`$deadline=(Get-Date).AddSeconds(30)
do {
  $running=@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'ColDesk.exe' -and $_.ExecutablePath -eq $env:COLDESK_UPDATE_TARGET) -or ($_.Name -eq 'electron.exe' -and $_.CommandLine -like ('*'+$env:COLDESK_UPDATE_PROJECT+'*')) })
  if($running.Count -eq 0){exit 0}
  Start-Sleep -Milliseconds 250
} while((Get-Date) -lt $deadline)
Write-Error '旧版尚未正常退出，自动安装已停止，请保存内容后从托盘退出。'
exit 1`;
const checked=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',waitScript],{cwd:root,windowsHide:true,stdio:'inherit',env:{...environment,COLDESK_UPDATE_TARGET:target,COLDESK_UPDATE_PROJECT:root},timeout:35000});
if(checked.error)throw checked.error;if(checked.status!==0)throw new Error('未能安全退出旧版，保留安装包并停止安装');
run(installer,['/S','/D='+config.installDirectory],120000);
if(!fs.existsSync(target))throw new Error('安装后没有找到 ColDesk.exe');
const installed=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command','(Get-Item -LiteralPath $env:COLDESK_UPDATE_TARGET).VersionInfo.ProductVersion'],{windowsHide:true,env:{...environment,COLDESK_UPDATE_TARGET:target},encoding:'utf8'});
const installedProductVersion=installed.stdout?.trim();
const installedVersion=installedProductVersion?.replace(/^(\d+\.\d+\.\d+)\.0$/,'$1');
if(installed.status!==0||installedVersion!==version)throw new Error(`安装版本校验失败：预期 ${version}，实际 ${installedProductVersion}`);
const child=spawn(target,[],{cwd:config.installDirectory,env:environment,windowsHide:true,detached:true,stdio:'ignore'});child.unref();
const health=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',`Start-Sleep -Seconds 4
$running=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ColDesk.exe' -and $_.ExecutablePath -eq $env:COLDESK_UPDATE_TARGET })
if($running.Count -lt 1){Write-Error '最新版启动后未保持运行';exit 1}
exit 0`],{windowsHide:true,stdio:'inherit',env:{...environment,COLDESK_UPDATE_TARGET:target},timeout:15000});
if(health.error)throw health.error;if(health.status!==0)throw new Error('最新版已安装，但启动检查未通过');
// Optional assistant integration must not invalidate a successful application install.
// Unknown external edits remain protected by the deployment preflight.
const integration=spawnSync(process.execPath,['scripts/update-local-assistant.cjs'],{cwd:root,env:environment,windowsHide:true,encoding:'utf8',timeout:60000});
const integrationSync={ok:!integration.error&&integration.status===0,reason:integration.status===0?'checked':'manual-review'};
if(!integrationSync.ok)console.warn('应用已安装；本机助手适配器需要单独检查，已保留现有脚本，没有覆盖或重启助手。');
fs.writeFileSync(path.join(root,'release/local-install-report.json'),JSON.stringify({version,installedVersion,installedProductVersion,executable:target,startedPid:child.pid,installedAt:new Date().toISOString(),integrationSync},null,2));
console.log(`已自动安装并启动 ColDesk ${version}：${target}`);
