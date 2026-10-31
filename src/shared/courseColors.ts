/** Muted colors for course accents; surfaces mix these with the active theme. */
export const COURSE_COLORS=['#a9c7e8','#a9d7c0','#c3b6e7','#e7b8c9','#edc5a5','#a5d4d9','#c3d1aa','#e7d595','#b0bce6','#d9b9dc'] as const;
export function courseColorAt(index:number):string{
 if(index<COURSE_COLORS.length)return COURSE_COLORS[index];
 const hue=((index-COURSE_COLORS.length)*137.508+24)%360,s=.43,l=.78;
 const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hue/60)%2-1)),m=l-c/2;
 const [r,g,b]=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];
 return '#'+[r,g,b].map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('');
}
export function nextCourseColor(used:Iterable<string>){const taken=new Set([...used].map(color=>color.toLowerCase()));let index=0;while(taken.has(courseColorAt(index)))index++;return courseColorAt(index);}
export function softCourseColor(value:unknown){
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Error('请选择有效的课程颜色');
 const rgb=[1,3,5].map(start=>parseInt(value.slice(start,start+2),16)),minimum=Math.min(...rgb),mix=minimum<155?(155-minimum)/(255-minimum):0;
 return '#'+rgb.map(channel=>Math.round(channel+(255-channel)*mix).toString(16).padStart(2,'0')).join('');
}
