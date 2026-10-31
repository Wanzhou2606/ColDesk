/** Explicitly authorized one-time local migration. Never output or package a credential. */
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {localDevelopment}=require('./local-development.cjs');
const local=localDevelopment();if(!local)throw Error('仅允许在指定开发机迁移本机助手配置');
const target=path.join(process.env.APPDATA,'coldesk','assistant.local.json');
if(fs.existsSync(target)){console.log('已有本机助手配置，保留原配置。');process.exit(0);}
const requireBuilder=createRequire(require.resolve('electron-builder'));
const requireLib=createRequire(requireBuilder.resolve('app-builder-lib'));
const asar=requireLib('@electron/asar');
const archive=path.join(local.installDirectory,'resources','app.asar');
const previous=asar.extractFile(archive,path.join('out','main','index.cjs')).toString('utf8');
const tokens=[...new Set([...previous.matchAll(/Bearer ([A-Za-z0-9_-]{8,200})/g)].map(match=>match[1]))];
if(tokens.length!==1)throw Error('无法唯一确定旧版本机凭证，已停止迁移');
fs.writeFileSync(target,JSON.stringify({httpPort:3000,token:tokens[0],reconnectTask:'NapCat-Relogin'},null,2),{flag:'wx'});
console.log('旧版连接信息已迁移到本机私有配置，未输出凭证。');
