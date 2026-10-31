const path = require('node:path');
const version = require('./package.json').version;
module.exports = {
  appId: 'com.coldesk.app',
  productName: 'ColDesk',
  copyright: 'ColDesk',
  directories: { app: 'build/app', output: 'release', buildResources: 'build/installer' },
  files: ['out/**/*', 'package.json', '!out/assistant-reader.cjs', '!node_modules{,/**/*}'],
  extraResources: [{ from: 'assets/icons/app-icon.ico', to: 'app-icon.ico' }, { from: 'out/assistant-reader.cjs', to: 'assistant-reader.cjs' }, { from: 'LICENSE', to: 'licenses/ColDesk-MIT.txt' }, { from: 'THIRD_PARTY_NOTICES.md', to: 'licenses/THIRD_PARTY_NOTICES.md' }, { from: 'THIRD_PARTY_LICENSES', to: 'licenses/third-party' }],
  asar: true,
  npmRebuild: false,
  electronDist: path.resolve('node_modules/electron/dist'),
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'assets/icons/app-icon.ico', artifactName: 'ColDesk-' + version + '-Windows-x64-Setup.${ext}', signAndEditExecutable: true },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    installerLanguages: ['zh_CN'],
    language: '2052',
    displayLanguageSelector: false,
    installerIcon: 'assets/icons/app-icon.ico',
    uninstallerIcon: 'assets/icons/app-icon.ico',
    installerSidebar: 'build/installer/sidebar.bmp',
    uninstallerSidebar: 'build/installer/sidebar.bmp',
    installerHeader: 'build/installer/header.bmp',
    include: 'build/installer/custom.nsh',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'ColDesk',
    uninstallDisplayName: 'ColDesk',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    packElevateHelper: false
  }
};
