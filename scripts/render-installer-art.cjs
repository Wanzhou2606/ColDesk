/** 使用应用自身的画布渲染品牌插图，生成 NSIS 所需的 24 位 BMP。 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');const path=require('node:path');
const output=path.resolve(__dirname,'../build/installer');
const icon=fs.readFileSync(path.resolve(__dirname,'../assets/icons/app-icon-256.png')).toString('base64');
function bmp(width,height,rgba){
  const stride=Math.ceil(width*3/4)*4, pixels=stride*height;
  const data=Buffer.alloc(54+pixels);data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(54,10);data.writeUInt32LE(40,14);data.writeInt32LE(width,18);data.writeInt32LE(height,22);data.writeUInt16LE(1,26);data.writeUInt16LE(24,28);data.writeUInt32LE(pixels,34);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const src=(y*width+x)*4,dst=54+(height-1-y)*stride+x*3;data[dst]=rgba[src+2];data[dst+1]=rgba[src+1];data[dst+2]=rgba[src];}
  return data;
}
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:360,height:680,webPreferences:{sandbox:true}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body></body></html>'));
  const images=await win.webContents.executeJavaScript(`(async()=>{
    const image=new Image();image.src='data:image/png;base64,${icon}';await image.decode();
    function draw(w,h,header=false){
      const c=document.createElement('canvas');c.width=w*3;c.height=h*3;const ctx=c.getContext('2d');ctx.scale(3,3);
      const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#f7f8ef');bg.addColorStop(.45,'#eaf2ff');bg.addColorStop(1,'#f1edf8');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
      function cloud(x,y,r,color){const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,color.slice(0,7)+'00');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
      cloud(w*.85,h*.2,w*.8,'#cde5ffb0');cloud(w*.1,h*.8,w*.7,'#f8e8c49a');
      const ink='#344866',muted='#8192aa';
      if(header){ctx.drawImage(image,7,8,42,42);ctx.fillStyle=ink;ctx.font='600 18px Segoe UI';ctx.fillText('ColDesk',54,29);ctx.font='9px Microsoft YaHei';ctx.fillStyle=muted;ctx.fillText('日常，轻一点',55,43);}
      else{
        ctx.fillStyle='#ffffffa6';ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(24,31,116,118,30);ctx.fill();ctx.stroke();ctx.drawImage(image,38,42,88,88);
        ctx.textAlign='center';ctx.fillStyle=ink;ctx.font='600 25px Segoe UI';ctx.fillText('ColDesk',w/2,180);ctx.fillStyle=muted;ctx.font='10px Microsoft YaHei';ctx.fillText('把日常，慢慢安放',w/2,201);
        ctx.fillStyle='#ffffffb0';ctx.strokeStyle='#ffffff';ctx.beginPath();ctx.roundRect(19,218,126,59,17);ctx.fill();ctx.stroke();
        for(let i=0;i<3;i++){ctx.fillStyle=['#82a6dd','#a1b58e','#c2b0d9'][i];ctx.beginPath();ctx.roundRect(32+i*37,230,26,5,2.5);ctx.fill();ctx.fillStyle='#e4ebf5';ctx.beginPath();ctx.roundRect(32+i*37,242,26,4,2);ctx.roundRect(32+i*37,253,17,4,2);ctx.fill();}
        ctx.fillStyle=muted;ctx.font='9px Microsoft YaHei';ctx.fillText('日程 · 日记 · 打卡',w/2,300);
      }
      const small=document.createElement('canvas');small.width=w;small.height=h;small.getContext('2d').drawImage(c,0,0,w,h);
      return {width:w,height:h,rgba:Array.from(small.getContext('2d').getImageData(0,0,w,h).data),png:small.toDataURL('image/png').split(',')[1]};
    }
    return {sidebar:draw(164,314),header:draw(150,57,true)};
  })()`);
  fs.mkdirSync(output,{recursive:true});for(const [name,data]of Object.entries(images)){fs.writeFileSync(path.join(output,name+'.bmp'),bmp(data.width,data.height,data.rgba));fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data.png,'base64'));}
  console.log('安装向导品牌插图已生成');app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
