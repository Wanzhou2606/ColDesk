import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import {uiLanguagePlugin} from './scripts/ui-language-plugin';

const r = (p: string) => resolve(process.cwd(), p);

/** 主进程、预加载、渲染层共用同一套路径别名 */
const alias = {
  '@shared': r('src/shared'),
  '@renderer': r('src/renderer/src')
};

/**
 * 主进程与 preload 输出 CJS（.cjs）：
 * Electron 主进程模块本身是 CJS，把它打进 ESM 会拿不到命名导出，
 * 且默认导入在运行时是 undefined，因此这里固定为 CJS 产物最稳妥。
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), {
      name: 'coldesk-app-icons',
      buildStart() {
        this.emitFile({type:'asset',fileName:'licenses/ical-js-LICENSE.txt',source:readFileSync(r('node_modules/ical.js/LICENSE'))});
        for (const name of ['app-icon-16.png', 'app-icon-32.png', 'app-icon-64.png', 'app-icon-256.png', 'app-icon.ico']) {
          this.emitFile({ type: 'asset', fileName: `icons/${name}`, source: readFileSync(r(`assets/icons/${name}`)) });
        }
      }
    }],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: r('src/main/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: r('src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: r('src/renderer'),
    plugins: [uiLanguagePlugin(),react()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          main: r('src/renderer/main.html'),
          widget: r('src/renderer/widget.html'),
          toast: r('src/renderer/toast.html')
        }
      }
    }
  }
});
