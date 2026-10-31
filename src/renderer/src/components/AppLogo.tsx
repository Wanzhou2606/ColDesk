import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { getApi } from '../lib/api';
export function AppLogo(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [url,setUrl]=useState('./app-icon.png');
  useEffect(()=>{let alive=true;const receive=(value:unknown)=>{const choice=value as {url?:string}|null;if(alive&&choice?.url)setUrl(choice.url);};const off=getApi().on('appearance:iconChanged',receive);void getApi().invoke('appearance:iconGet').then(receive).catch(()=>{});return()=>{alive=false;off();};},[]);
  return <img {...props} src={url} draggable={false}/>;
}
