const path=require('node:path'),fs=require('node:fs');
const {createRequire}=require('node:module');
const requireVite=createRequire(require.resolve('vite'));
const esbuild=requireVite('esbuild');
const root=path.resolve(__dirname,'..'),output=path.join(root,'out/assistant-reader.cjs');
fs.mkdirSync(path.dirname(output),{recursive:true});
esbuild.buildSync({entryPoints:[path.join(root,'src/main/assistantTimetable.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:output,tsconfig:path.join(root,'tsconfig.node.json')});
console.log('助手课表读取器已构建，使用与应用相同的课程规则。');
