/** Render the original, MIT-licensed SVG using Electron; no external image service. */
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const folder=path.resolve(__dirname,'../assets/icons');
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
 await window.loadURL('data:text/html,<body></body>');
 const svg=fs.readFileSync(path.join(folder,'app-icon.svg')).toString('base64');
 const result=await window.webContents.executeJavaScript(`(async()=>{
   const image=new Image();image.src='data:image/svg+xml;base64,${svg}';await image.decode();
   return [16,32,48,64,128,256,512].map(size=>{const c=document.createElement('canvas');c.width=c.height=size;c.getContext('2d').drawImage(image,0,0,size,size);return {size,data:c.toDataURL('image/png').split(',')[1]};});
 })()`);
 for(const item of result)fs.writeFileSync(path.join(folder,`app-icon-${item.size}.png`),Buffer.from(item.data,'base64'));
 for(const directory of ['src/renderer/public','mobile/public']){
   const destination=path.resolve(__dirname,'..',directory);fs.mkdirSync(destination,{recursive:true});
   fs.copyFileSync(path.join(folder,'app-icon-256.png'),path.join(destination,'app-icon.png'));
 }
 const entries=result.filter(item=>item.size<=256),header=Buffer.alloc(6+16*entries.length);header.writeUInt16LE(1,2);header.writeUInt16LE(entries.length,4);let offset=header.length;const bodies=[];
 entries.forEach((item,index)=>{const data=Buffer.from(item.data,'base64'),position=6+index*16;header[position]=header[position+1]=item.size===256?0:item.size;header.writeUInt16LE(1,position+4);header.writeUInt16LE(32,position+6);header.writeUInt32LE(data.length,position+8);header.writeUInt32LE(offset,position+12);offset+=data.length;bodies.push(data);});
 fs.writeFileSync(path.join(folder,'app-icon.ico'),Buffer.concat([header,...bodies]));
 // Keep the experimental Android launcher and splash assets original too.
 const resources=path.resolve(__dirname,'../android/app/src/main/res');
 const visit=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?visit(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
 if(fs.existsSync(resources))for(const file of visit(resources).filter(file=>/^(?:ic_launcher(?:_round|_foreground)?|splash)\.png$/.test(path.basename(file)))){
   const {width,height}=nativeImage.createFromPath(file).getSize();if(!width||!height)throw Error('Invalid image dimensions: '+file);
   const name=path.basename(file),factor=name==='splash.png'?.22:name==='ic_launcher_foreground.png'?.66:1;
   const png=await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src='data:image/svg+xml;base64,${svg}';await image.decode();const c=document.createElement('canvas');c.width=${width};c.height=${height};const ctx=c.getContext('2d');if(${JSON.stringify(name)}==='splash.png'){ctx.fillStyle='#f1f7f6';ctx.fillRect(0,0,c.width,c.height);}if(${JSON.stringify(name)}==='ic_launcher_round.png'){ctx.beginPath();ctx.arc(c.width/2,c.height/2,Math.min(c.width,c.height)/2,0,Math.PI*2);ctx.clip();}const size=Math.min(c.width,c.height)*${factor};ctx.drawImage(image,(c.width-size)/2,(c.height-size)/2,size,size);return c.toDataURL('image/png').split(',')[1];})()`);
   fs.writeFileSync(file,Buffer.from(png,'base64'));
 }
 console.log('Original ColDesk icons generated.');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
