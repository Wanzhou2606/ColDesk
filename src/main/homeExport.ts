import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, ExternalHyperlink } from 'docx';
import { homeEntryTxt, validHomeDate, type HomeEntry, type HomeAsset, type HomeExportOptions } from '@shared/home';

export function safeHomeName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'').slice(0,80);
  return !clean ? '未命名' : /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(clean) ? '_' + clean : clean;
}
export function homeExportFormat(entries: HomeEntry[], options?: Pick<HomeExportOptions,'format'|'mode'>): 'txt'|'word' {
  return options?.mode === 'overview' || options?.format === 'word' || entries.some(e => e.attachments?.some(a => a.kind === 'photo')) ? 'word' : 'txt';
}
async function word(entries: HomeEntry[], assets: Map<string,HomeAsset>, links: Map<string,string>, overview: boolean): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];
  const text = (value: string, heading?: typeof HeadingLevel[keyof typeof HeadingLevel]) => new Paragraph({ heading, children:[new TextRun({text:value})], spacing:{after:160} });
  if (overview) paragraphs.push(text('心灵日记总览',HeadingLevel.TITLE),text(`${entries[0].date} 至 ${entries.at(-1)!.date} · ${entries.length} 天`));
  entries.forEach((entry,index) => {
    paragraphs.push(new Paragraph({text:entry.date + (entry.title?.trim() ? ' ' + entry.title.trim() : ''),heading:overview?HeadingLevel.HEADING_1:HeadingLevel.TITLE,pageBreakBefore:overview&&index>0,spacing:{after:240}}));
    paragraphs.push(text(`天气：${entry.weather || '未记录'}    心情：${entry.mood || '未记录'}`));
    if(entry.cover.trim()) { paragraphs.push(text('封面',HeadingLevel.HEADING_2)); for(const line of entry.cover.split(/\r?\n/)) paragraphs.push(text(line)); }
    if(entry.body.trim()) { paragraphs.push(text('这一天的故事',HeadingLevel.HEADING_2)); for(const line of entry.body.split(/\r?\n/)) paragraphs.push(text(line)); }
    for(const attachment of entry.attachments ?? []) {
      const asset=assets.get(attachment.id); if(!asset) throw new Error('附件未能读取，导出已停止');
      if(asset.kind==='photo'&&asset.image) {
        const ratio=Math.min(560/asset.image.width,620/asset.image.height,1);
        paragraphs.push(new Paragraph({children:[new ImageRun({type:'png',data:Buffer.from(asset.image.data,'base64'),transformation:{width:Math.max(1,Math.round(asset.image.width*ratio)),height:Math.max(1,Math.round(asset.image.height*ratio))},altText:{title:asset.name,description:asset.name,name:asset.name}})],spacing:{before:160,after:100}}));
        paragraphs.push(text(asset.name));
      } else paragraphs.push(new Paragraph({children:[new ExternalHyperlink({link:links.get(asset.id)!,children:[new TextRun({text:'附件：'+asset.name,style:'Hyperlink'})]})],spacing:{after:160}}));
    }
  });
  return Packer.toBuffer(new Document({creator:'ColDesk',title:overview?'心灵日记总览':entries[0].date+(entries[0].title?' '+entries[0].title:''),styles:{default:{document:{run:{font:'Microsoft YaHei',size:22},paragraph:{spacing:{line:320}}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},children:paragraphs}]}));
}

/** 每次导出独立新文件夹；不覆盖用户已有文件。 */
export async function writeHomeExport(parent: string, entries: HomeEntry[], options?: HomeExportOptions, loadAsset?: (date:string,id:string)=>HomeAsset): Promise<string> {
  if (!entries.length) throw new Error('所选范围还没有日记可以导出');
  if (entries.some(entry => !validHomeDate(entry.date)) || new Set(entries.map(entry => entry.date)).size !== entries.length) throw new Error('日记日期异常，请保留备份后重试');
  const folder = join(parent, `ColDesk日记-${entries[0].date}-${entries.at(-1)!.date}-${randomUUID().slice(0,8)}`);
  await mkdir(folder);
  try {
    const format=homeExportFormat(entries,options),overview=options?.mode==='overview';
    const assets=new Map<string,HomeAsset>(),links=new Map<string,string>();
    for(const entry of entries) for(const a of entry.attachments??[]) {
      if(!loadAsset) throw new Error('附件暂时无法导出');
      const asset=loadAsset(entry.date,a.id); assets.set(a.id,asset);
      if(asset.kind==='file'||format==='txt') {
        const relative=entry.date+'-附件'; await mkdir(join(folder,relative),{recursive:true});
        const extension=extname(asset.name),stem=extension?asset.name.slice(0,-extension.length):asset.name;
        const name=asset.id.slice(0,8)+'-'+safeHomeName(stem)+extension.replace(/[<>:"/\\|?*\x00-\x1f]/g,'').slice(0,20);
        await writeFile(join(folder,relative,name),Buffer.from(asset.data,'base64'),{flag:'wx',mode:0o600}); links.set(a.id,relative+'/'+name);
      }
    }
    if(overview) await writeFile(join(folder,'心灵日记总览.docx'),await word(entries,assets,links,true),{flag:'wx',mode:0o600});
    else for (const entry of entries) {
      const name=entry.date+(entry.title?.trim()?' '+safeHomeName(entry.title):'');
      await writeFile(join(folder,format==='word'?name+'.docx':entry.date+'.txt'),format==='word'?await word([entry],assets,links,false):homeEntryTxt(entry),{flag:'wx',mode:0o600});
    }
    return folder;
  } catch (error) {
    // 只清理本次成功新建的专用目录，不涉及原有文件。
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
