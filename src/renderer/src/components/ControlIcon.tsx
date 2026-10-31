import type {SVGProps} from 'react';

type ControlIconName = 'plus' | 'minus' | 'left' | 'right' | 'down' | 'calendar' | 'grip' | 'more' | 'close' | 'refresh';
const paths: Partial<Record<ControlIconName, string>> = {
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  left: 'm14.5 5-7 7 7 7',
  right: 'm9.5 5 7 7-7 7',
  down: 'm5 9 7 7 7-7',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 3v6h-6',
  calendar: 'M8 3v4m8-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 9h2m4 0h2m-8 3h2',
  close: 'm6 6 12 12M6 18 18 6'
};

/** Small controls use the same strokes at every font and display scale. */
export function ControlIcon({name, className = '', ...props}: SVGProps<SVGSVGElement> & {name: ControlIconName}) {
  return <svg className={`control-icon ${className}`.trim()} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    {paths[name] && <path d={paths[name]}/>}
    {name === 'more' && [5, 12, 19].map(cx => <circle key={cx} cx={cx} cy="12" r="1.65" fill="currentColor" stroke="none"/>)}
    {name === 'grip' && [5, 12, 19].flatMap(cy => [8, 16].map(cx => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="currentColor" stroke="none"/>))}
  </svg>;
}
