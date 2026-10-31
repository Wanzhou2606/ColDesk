import {Notification} from 'electron';
import {startupDigest} from '@shared/startupDigest';
import {store} from './store';
import {pushToast} from './toastManager';
import {createMainWindow} from './windows';
export function showStartupDigest(){
 const digest=startupDigest(store.getState());
 pushToast({kind:'startup',...digest,strong:false});
 if(Notification.isSupported()){try{const note=new Notification({title:digest.title,body:digest.body});note.on('click',()=>createMainWindow());note.show();}catch{/* 应用内的普通提醒仍然可用。 */}}
}
