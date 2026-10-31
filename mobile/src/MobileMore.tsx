import {AppLogo} from '../../src/renderer/src/components/AppLogo';
import {AppIcon} from '../../src/renderer/src/components/AppIcon';
import {ControlIcon} from '../../src/renderer/src/components/ControlIcon';

export function MobileMore({onOpen}:{onOpen:(page:'expenses'|'goals'|'settings')=>void}){
 const entries=[
  {page:'expenses',title:'记账',description:'记录每一笔生活',icon:'expenses'},
  {page:'goals',title:'长期',description:'把方向，慢慢走成日常',icon:'goals'},
  {page:'settings',title:'设置',description:'主题、字体与个性化',icon:'settings'}
 ] as const;
 return <div className="page mobile-more-page">
  <header className="mobile-page-heading"><h1>更多</h1></header>
  <section className="mobile-more-profile" aria-label="我的 ColDesk">
   <div className="mobile-more-avatar"><AppLogo alt="当前软件图标"/></div>
   <div className="mobile-more-identity"><h2>ColDesk</h2><p>给日常，留一点从容</p></div>
  </section>
  <div className="mobile-more-cards" aria-label="更多功能">{entries.map(entry=><button key={entry.page} className={'mobile-more-card more-'+entry.page} onClick={()=>onOpen(entry.page)}>
   <span className="mobile-more-entry-icon"><AppIcon name={entry.icon}/></span><span className="mobile-more-entry-text"><strong>{entry.title}</strong><small>{entry.description}</small></span><ControlIcon name="right"/>
  </button>)}</div>
 </div>;
}
