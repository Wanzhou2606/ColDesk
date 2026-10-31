import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig={appId:'com.coldesk.mobile',appName:'ColDesk',webDir:'mobile/dist',loggingBehavior:'none',includePlugins:['@capacitor/app','@capacitor/browser','@capacitor/clipboard','@capacitor/local-notifications'],android:{allowMixedContent:false},plugins:{CapacitorHttp:{enabled:false},LocalNotifications:{smallIcon:'ic_stat_coldesk',iconColor:'#527ad7'}}};
export default config;
