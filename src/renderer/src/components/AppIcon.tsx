export type AppIconName = 'home' | 'schedule' | 'study' | 'life' | 'expenses' | 'habits' | 'goals' | 'settings' | 'more';
const paths: Record<AppIconName, string[]> = {
  home: ['M12 21V10', 'M12 14C4 14 3 7 3 4c6 0 9 3 9 10Z', 'M12 11c0-6 3-8 9-8 0 6-3 8-9 8'],
  schedule: ['M7 3v4M17 3v4M3 10h18', 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M8 14h3M8 17h7'],
  study: ['M3 5c4-1 6-1 9 1 3-2 5-2 9-1v14c-4-1-6-1-9 1-3-2-5-2-9-1Z', 'M12 6v14'],
  life: ['m3 11 9-8 9 8', 'M5 10v10h14V10M9 20v-7h6v7'],
  expenses: ['M20 7H5a2 2 0 0 1 0-4h13v4', 'M3 5v14a2 2 0 0 0 2 2h15V7', 'M20 11h-5v6h5M16 14h1'],
  habits: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm8 12 3 3 5-6'],
  goals: ['M5 21V4','M5 4c5-5 9 5 15 0v10c-6 5-10-5-15 0'],
  more: ['M5 3h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M16 3h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M5 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z','M16 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'm9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1Z']
};
export function AppIcon({ name }: { name: AppIconName }) {
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((d, i) => <path key={i} d={d} />)}</svg>;
}
