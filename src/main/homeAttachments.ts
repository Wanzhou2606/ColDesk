import { dialog, nativeImage } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homeVault } from './home';
import { getWindow } from './windows';
import type { HomeAsset } from '@shared/home';

let importing=false;
export async function addHomeAttachments(sender:number,input:{date?:unknown;kind?:unknown}) {
  const entry=homeVault.get(sender,input?.date),main=getWindow('main');
  if(!main||importing) throw new Error('正在添加附件，请稍候');
  if(homeVault.hasDraft(sender)) throw new Error('请先保存日记');
  const photo=input?.kind==='photo'; importing=true;
  try {
    const result=await dialog.showOpenDialog(main,{title:photo?'添加照片':'添加文件',properties:['openFile','multiSelections'],...(photo?{filters:[{name:'照片',extensions:['jpg','jpeg','png','webp','gif','bmp']}]}:{})});
    if(result.canceled) return entry;
    if(result.filePaths.length>20) throw new Error('每次最多添加 20 个附件');
    const sizes=await Promise.all(result.filePaths.map(p=>stat(p)));
    if(sizes.some(s=>!s.isFile()||s.size>25*1024*1024)||sizes.reduce((sum,s)=>sum+s.size,0)>100*1024*1024) throw new Error('单个附件不能超过 25 MB，每次合计不能超过 100 MB');
    const assets:HomeAsset[]=[];
    for(const path of result.filePaths) {
      const data=await readFile(path); if(data.length>25*1024*1024) throw new Error('附件超过 25 MB');
      const image=nativeImage.createFromBuffer(data);
      if(photo&&image.isEmpty()) throw new Error(`无法读取照片“${basename(path)}”，请使用 JPG 或 PNG`);
      const asset:HomeAsset={id:randomUUID(),date:entry.date,name:basename(path),kind:image.isEmpty()?'file':'photo',size:data.length,data:data.toString('base64')};
      if(!image.isEmpty()) {const size=image.getSize(),ratio=Math.min(2400/size.width,2400/size.height,1);const resized=image.resize({width:Math.max(1,Math.round(size.width*ratio)),height:Math.max(1,Math.round(size.height*ratio))});asset.image={data:resized.toPNG().toString('base64'),...resized.getSize()};}
      assets.push(asset);
    }
    if(homeVault.hasDraft(sender)) throw new Error('日记正在编辑，请保存后重试');
    return homeVault.addAssets(sender,entry.date,assets);
  }finally{importing=false;}
}
export function previewHomeAttachment(sender:number,input:{date?:unknown;id?:unknown}) {
  const asset=homeVault.asset(sender,input?.date,input?.id);
  if(!asset.image)return {name:asset.name};
  const image=nativeImage.createFromBuffer(Buffer.from(asset.image.data,'base64')),size=image.getSize(),ratio=Math.min(900/size.width,900/size.height,1);
  return {name:asset.name,url:image.resize({width:Math.max(1,Math.round(size.width*ratio)),height:Math.max(1,Math.round(size.height*ratio))}).toDataURL()};
}
export async function exportHomeAttachment(sender:number,input:{date?:unknown;id?:unknown}) {
  const asset=homeVault.asset(sender,input?.date,input?.id),main=getWindow('main');if(!main)throw new Error('请在 home 中导出');
  const chosen=await dialog.showSaveDialog(main,{title:'导出原始照片或文件',defaultPath:asset.name});if(chosen.canceled||!chosen.filePath)return {canceled:true};
  const checked=homeVault.asset(sender,input?.date,input?.id);
  await writeFile(chosen.filePath,Buffer.from(checked.data,'base64'),{mode:0o600});return {canceled:false};
}
