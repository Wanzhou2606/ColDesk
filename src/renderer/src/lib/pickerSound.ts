let context:AudioContext|undefined,lastTick=0;
const preference='coldesk.time-picker-sound';
export function pickerSoundEnabled(){try{return localStorage.getItem(preference)!=='off';}catch{return true;}}
export function setPickerSoundEnabled(enabled:boolean){try{localStorage.setItem(preference,enabled?'on':'off');}catch{}}
export function unlockPickerSound(){
 try{context??=new AudioContext();if(context.state==='suspended')void context.resume().catch(()=>undefined);}catch{}
}
/** A short, quiet mechanical tick synthesized locally; no media download. */
export function playPickerTick(){
 if(!pickerSoundEnabled()||!context||context.state!=='running'||performance.now()-lastTick<32)return;
 lastTick=performance.now();
 try{const at=context.currentTime,osc=context.createOscillator(),gain=context.createGain();osc.type='triangle';osc.frequency.setValueAtTime(1100,at);osc.frequency.exponentialRampToValueAtTime(520,at+.018);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.035,at+.002);gain.gain.exponentialRampToValueAtTime(.0001,at+.025);osc.connect(gain);gain.connect(context.destination);osc.start(at);osc.stop(at+.03);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{}
}
