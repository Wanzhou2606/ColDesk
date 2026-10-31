const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),workspace=path.dirname(root),toolRoot=path.join(workspace,'.android-tools'),metadata=JSON.parse(fs.readFileSync(path.join(root,'mobile/version.json'),'utf8').replace(/^\uFEFF/,''));
const tools=JSON.parse(fs.readFileSync(path.join(toolRoot,'toolchain.json'),'utf8').replace(/^\uFEFF/,''));
const qa=process.argv.includes('--qa'),env={...process.env,JAVA_HOME:tools.java,ANDROID_HOME:tools.sdk,ANDROID_SDK_ROOT:tools.sdk,GRADLE_USER_HOME:path.join(toolRoot,'gradle-home'),JAVA_TOOL_OPTIONS:'-Djava.net.preferIPv4Stack=true'};
function run(command,args,cwd=root){const result=spawnSync(command,args,{cwd,env,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error('安卓构建步骤失败：'+path.basename(command));}
run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','-p','mobile/tsconfig.json']);
run(process.execPath,['node_modules/vite/bin/vite.js','build','--config','mobile/vite.config.ts']);
run(process.execPath,['node_modules/@capacitor/cli/bin/capacitor','sync','android']);
const escapeProperties=s=>s.replaceAll('\\','/').replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
fs.writeFileSync(path.join(root,'android/local.properties'),'sdk.dir='+escapeProperties(tools.sdk)+'\n');
const appGradle=path.join(root,'android/app/build.gradle');fs.writeFileSync(appGradle,fs.readFileSync(appGradle,'utf8').replace(/versionCode \d+/,`versionCode ${metadata.versionCode}`).replace(/versionName "[^"]+"/,`versionName "${metadata.version}"`));
const nativeEnv={...env,COLDESK_GRADLE_PATH:tools.gradle,COLDESK_GRADLE_TASK:qa?'assembleDebug':'assembleRelease'};
const nativeResult=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command','if($env:COLDESK_GRADLE_INIT){& $env:COLDESK_GRADLE_PATH --no-daemon --console=plain -I $env:COLDESK_GRADLE_INIT $env:COLDESK_GRADLE_TASK}else{& $env:COLDESK_GRADLE_PATH --no-daemon --console=plain $env:COLDESK_GRADLE_TASK}; exit $LASTEXITCODE'],{cwd:path.join(root,'android'),env:nativeEnv,stdio:'inherit',windowsHide:true});if(nativeResult.error)throw nativeResult.error;if(nativeResult.status!==0)throw new Error('安卓编译未完成');
const release=path.join(root,'release');fs.mkdirSync(release,{recursive:true});
const output=path.join(release,`ColDesk-Android-${metadata.version}${qa?'-QA':''}.apk`);
if(qa)fs.copyFileSync(path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),output);
else{
 const signing=path.join(toolRoot,'signing');fs.mkdirSync(signing,{recursive:true});const passwordFile=path.join(signing,'key.pass'),keyStore=path.join(signing,'coldesk-android.jks');
 if(!fs.existsSync(passwordFile))fs.writeFileSync(passwordFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
 if(!fs.existsSync(keyStore))run(path.join(tools.java,'bin/keytool.exe'),['-genkeypair','-keystore',keyStore,'-storepass:file',passwordFile,'-keypass:file',passwordFile,'-alias','coldesk','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=ColDesk, OU=Android, O=ColDesk']);
 const buildTools=path.join(tools.sdk,'build-tools/36.0.0'),aligned=path.join(release,`ColDesk-Android-${metadata.version}-aligned.apk`);
 run(path.join(buildTools,'zipalign.exe'),['-f','-p','4',path.join(root,'android/app/build/outputs/apk/release/app-release-unsigned.apk'),aligned]);
 run(path.join(tools.java,'bin/java.exe'),['-jar',path.join(buildTools,'lib/apksigner.jar'),'sign','--ks',keyStore,'--ks-key-alias','coldesk','--ks-pass','file:'+passwordFile,'--out',output,aligned]);
 run(path.join(tools.java,'bin/java.exe'),['-jar',path.join(buildTools,'lib/apksigner.jar'),'verify','--verbose',output]);
}
const digest=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');fs.writeFileSync(output+'.sha256',digest+'  '+path.basename(output)+'\n');
fs.writeFileSync(path.join(release,qa?'android-qa-build-report.json':'android-build-report.json'),JSON.stringify({version:metadata.version,versionCode:metadata.versionCode,minAndroid:metadata.minAndroid,file:output,sha256:digest,signed:true,qa},null,2));
console.log('安卓安装包已就绪：'+output);
