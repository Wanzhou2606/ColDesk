/** Update the reviewed source and installed CLIs. No bot messages/restarts. */
const fs=require('node:fs'),path=require('node:path');
const {localDevelopment,root}=require('./local-development.cjs');
const {deployAssistant}=require('./assistant-deployment.cjs');
if(!localDevelopment())throw Error('仅在已授权的开发机更新助手适配器');
const replacement=fs.readFileSync(path.join(root,'scripts/integrations/desk.js'));
const results=deployAssistant({home:process.env.USERPROFILE,replacement,originalHash:require('./integrations/deployment.json').originalHash,backupDir:path.join(process.env.APPDATA,'coldesk','backup','integrations')});
const report=path.join(root,'preview/maintenance-audit');fs.mkdirSync(report,{recursive:true});
fs.writeFileSync(path.join(report,'assistant-deployment.json'),JSON.stringify({at:new Date().toISOString(),targets:results},null,2));
console.log(JSON.stringify({ok:true,checked:results.length,updated:results.filter(item=>item.updated).length,activeProfiles:results.filter(item=>item.kind.startsWith('profile:')).map(item=>item.kind)}));
