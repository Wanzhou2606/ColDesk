const {spawnSync}=require('node:child_process');
const {localDevelopment,root}=require('./local-development.cjs');
const script=localDevelopment()?'scripts/build-installer.cjs':'node_modules/electron-vite/bin/electron-vite.js';
const result=spawnSync(process.execPath,[script,...(localDevelopment()?[]:['build'])],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status??1);
