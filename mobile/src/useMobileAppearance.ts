import {useEffect} from 'react';
import type {TodayView} from '@shared/view';
import type {MobileCore} from './core';
import {importedFontFamily,mobileFontFamily,type MobileFontTarget} from './personalization';
import {mobileIconShortcut} from './platform';
import {applyGlassAppearance} from '../../src/renderer/src/lib/glassAppearance';

/** Font files remain on this device and are included in its explicit backups. */
export function useMobileAppearance(state:TodayView|null,core:MobileCore){
 const appearance=core.data.appearance;
 useEffect(()=>{
  const scheme=window.matchMedia('(prefers-color-scheme: dark)'),apply=()=>applyGlassAppearance(state?.settings.glassOpacity??.62,{dark:scheme.matches});
  apply();scheme.addEventListener('change',apply);return()=>scheme.removeEventListener('change',apply);
 },[state?.settings.glassOpacity]);
 useEffect(()=>{void mobileIconShortcut(appearance?.icon?.data).catch(()=>{});},[appearance?.icon?.data]);
 useEffect(()=>{
  const loaded:FontFace[]=[];let active=true;
  for(const target of ['uiFont','homeCoverFont'] as MobileFontTarget[]){
   const font=appearance?.fonts?.[target];if(!font)continue;
   const face=new FontFace(importedFontFamily(target),Uint8Array.from(atob(font.data),c=>c.charCodeAt(0)).buffer,{display:'swap'});
   void face.load().then(()=>{if(active){document.fonts.add(face);loaded.push(face);}}).catch(()=>{});
  }
  return()=>{active=false;loaded.forEach(face=>document.fonts.delete(face));};
 },[appearance]);
 useEffect(()=>{
  document.documentElement.style.setProperty('--font-ui',mobileFontFamily(state?.settings.uiFont,'uiFont'));
  document.documentElement.style.setProperty('--font-home-cover',mobileFontFamily(state?.settings.homeCoverFont,'homeCoverFont'));
 },[state?.settings.uiFont,state?.settings.homeCoverFont]);
}
