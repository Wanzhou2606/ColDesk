# Third-party notices

ColDesk code and original calendar/leaf artwork are licensed under the project MIT license. Dependencies keep their own licenses; the project license does not replace them.

This inventory includes direct runtime libraries and their declared runtime dependencies. Some entries are used only by the experimental mobile client or at build/runtime boundaries. License texts are preserved in THIRD_PARTY_LICENSES/.

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @capacitor/android | 8.5.3 | MIT | [upstream](https://github.com/ionic-team/capacitor) |
| @capacitor/core | 8.5.3 | MIT | [upstream](https://github.com/ionic-team/capacitor) |
| @electron/get | 5.1.0 | MIT | [upstream](https://github.com/electron/get) |
| core-util-is | 1.0.3 | MIT | [upstream](https://github.com/isaacs/core-util-is) |
| debug | 4.4.3 | MIT | [upstream](https://github.com/debug-js/debug) |
| docx | 9.6.1 | MIT | [upstream](https://github.com/dolanmiu/docx) |
| electron | 44.7.0 | MIT | [upstream](https://github.com/electron/electron) |
| env-paths | 3.0.0 | MIT | [upstream](sindresorhus/env-paths) |
| fflate | 0.8.2 | MIT | [upstream](https://github.com/101arrowz/fflate) |
| graceful-fs | 4.2.11 | ISC | [upstream](https://github.com/isaacs/node-graceful-fs) |
| hash.js | 1.1.7 | MIT | [upstream](https://github.com/indutny/hash.js) |
| ical.js | 2.2.1 | MPL-2.0 | [upstream](https://github.com/kewisch/ical.js) |
| immediate | 3.0.6 | MIT | [upstream](https://github.com/calvinmetcalf/immediate) |
| inherits | 2.0.4 | ISC | [upstream](https://github.com/isaacs/inherits) |
| isarray | 1.0.0 | MIT | [upstream](https://github.com/juliangruber/isarray) |
| js-tokens | 4.0.0 | MIT | [upstream](lydell/js-tokens) |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | [upstream](https://github.com/Stuk/jszip) |
| lie | 3.3.0 | MIT | [upstream](https://github.com/calvinmetcalf/lie) |
| loose-envify | 1.4.0 | MIT | [upstream](https://github.com/zertosh/loose-envify) |
| minimalistic-assert | 1.0.1 | ISC | [upstream](https://github.com/calvinmetcalf/minimalistic-assert) |
| ms | 2.1.3 | MIT | [upstream](vercel/ms) |
| nanoid | 5.1.16 | MIT | [upstream](ai/nanoid) |
| pako | 1.0.11 | (MIT AND Zlib) | [upstream](nodeca/pako) |
| process-nextick-args | 2.0.1 | MIT | [upstream](https://github.com/calvinmetcalf/process-nextick-args) |
| progress | 2.0.3 | MIT | [upstream](https://github.com/visionmedia/node-progress) |
| react | 18.3.1 | MIT | [upstream](https://github.com/facebook/react) |
| react-dom | 18.3.1 | MIT | [upstream](https://github.com/facebook/react) |
| readable-stream | 2.3.8 | MIT | [upstream](https://github.com/nodejs/readable-stream) |
| safe-buffer | 5.1.2 | MIT | [upstream](https://github.com/feross/safe-buffer) |
| sax | 1.6.1 | BlueOak-1.0.0 | [upstream](ssh://git@github.com/isaacs/sax-js) |
| scheduler | 0.23.2 | MIT | [upstream](https://github.com/facebook/react) |
| semver | 7.8.5 | ISC | [upstream](https://github.com/npm/node-semver) |
| setimmediate | 1.0.5 | MIT | [upstream](YuzuJS/setImmediate) |
| string_decoder | 1.1.1 | MIT | [upstream](https://github.com/nodejs/string_decoder) |
| sumchecker | 3.0.1 | Apache-2.0 | [upstream](https://github.com/malept/sumchecker) |
| tslib | 2.8.1 | 0BSD | [upstream](https://github.com/Microsoft/tslib) |
| util-deprecate | 1.0.2 | MIT | [upstream](https://github.com/TooTallNate/util-deprecate) |
| xml | 1.0.1 | MIT | [upstream](http://github.com/dylang/node-xml) |
| xml-js | 1.6.11 | MIT | [upstream](https://github.com/nashwaan/xml-js) |

## ical.js (MPL-2.0)

The unmodified ical.js library retains its MPL-2.0 license. The exact source distribution is available at https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz and from the upstream repository listed above. Its license text accompanies the application. The MPL applies to the library; ColDesk’s own code uses MIT.

## JSZip

For JSZip’s dual license (MIT OR GPL-3.0-or-later), this distribution uses the MIT option. The upstream license document is preserved.

## Electron and Chromium

Electron ships additional notices for Chromium and bundled components. Preserve the LICENSE.electron.txt and LICENSES.chromium.html files produced in the Windows distribution.

## Gradle wrapper

The experimental Android project contains the standard Gradle wrapper. It is distributed under Apache-2.0; see https://github.com/gradle/gradle and the notices included in the wrapper distribution.

## Artwork and fonts

The calendar/leaf icon source (assets/icons/app-icon.svg), derived PNG/ICO files and generated installer artwork are original ColDesk assets under MIT. Earlier personal character artwork is excluded from this repository. Desktop fonts are resolved from the user’s system. The experimental mobile client bundles the unmodified Ma Shan Zheng font: Copyright 2018 The MaShanZheng Project Authors (https://github.com/googlefonts/mashanzheng), licensed under SIL Open Font License 1.1; its full notice is in mobile/public/OFL-MaShanZheng.txt.

The Electron npm installation helper @electron-internal/extract-zip is a build-only dependency, not included in the ColDesk application distribution.
