const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const keys=JSON.parse(fs.readFileSync(path.join(__dirname,'i18n-keys.json'),'utf8'));
const dictionaries={en:{},ja:{}},seen=new Set();
for(const row of fs.readFileSync(path.join(__dirname,'translations.tsv'),'utf8').trimEnd().split(/\r?\n/)){
 const[index,en,ja]=row.split('\t'),key=keys[Number(index)];
 if(!key||!en||!ja||seen.has(index))throw Error('Invalid translation row: '+index);
 seen.add(index);dictionaries.en[key]=en;dictionaries.ja[key]=ja;
}
if(seen.size!==keys.length)throw Error('Missing translations');
for(const[language,values]of Object.entries(dictionaries))fs.writeFileSync(path.join(root,'src/shared/locales',language+'.json'),JSON.stringify(values,null,2)+'\n');
console.log(keys.length+' interface labels generated in English and Japanese.');
