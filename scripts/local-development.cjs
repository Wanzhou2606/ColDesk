const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
function localDevelopment(){
  const file=path.join(root,'developer.local.json');
  if(!fs.existsSync(file))return null;
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(process.platform!=='win32'||value.machine?.toLowerCase()!==os.hostname().toLowerCase()||value.autoInstall!==true)return null;
  if(typeof value.installDirectory!=='string'||!path.isAbsolute(value.installDirectory))throw new Error('本机安装目录无效');
  return value;
}
module.exports={localDevelopment,root};
