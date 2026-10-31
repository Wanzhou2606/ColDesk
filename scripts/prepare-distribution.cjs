const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'build/app');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.mkdirSync(appDir, {recursive:true});
// 专用暂存目录，只复制正式产物。个人数据库、日志、测试库、源码和开发依赖均不进入发行包。
const builtDir=path.resolve(appDir,'out');
if(!builtDir.startsWith(root+path.sep)||builtDir!==path.join(root,'build/app/out'))throw new Error('发行暂存目录异常');
fs.rmSync(builtDir,{recursive:true,force:true});
fs.cpSync(path.join(root,'out'),path.join(appDir,'out'),{recursive:true});
fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'coldesk',productName:'ColDesk',version:metadata.version,description:'日程、日记与习惯，记录自己的日常。',author:'ColDesk',private:true,main:'out/main/index.cjs'},null,2));
console.log('发行产物准备完成；数据库使用 Electron 内置 SQLite，无需原生模块或额外运行环境。');
