# 开发与发布

## 环境与常规工作

桌面端使用 Node.js 24、pnpm 11.28.5、Electron、React、TypeScript 和 SQLite，优先在 Windows x64 验证。

```powershell
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm dev
pnpm typecheck
pnpm test
pnpm build:only
```

`pnpm-workspace.yaml` 允许 Electron/esbuild 的安装脚本；可选的 better-sqlite3 不执行原生编译，Node/Electron 内置 SQLite 为后备。镜像配置在 `.npmrc`，可按网络环境调整。

开发示例只供独立预览，正式用户首次运行仅创建基础配置与记账分类。界面检查使用独立 `userData` 目录；可通过绝对路径环境变量 `COLDESK_PROFILE_DIR` 指定测试配置，避免触碰正常安装的数据。

## 可选的本机自动安装

默认不启用。维护者可将 `developer.example.json` 复制为 `developer.local.json`，填写机器名、绝对安装目录，并明确把 `autoInstall` 设置为 `true`。该配置被 Git 忽略。

启用后，`pnpm build` 会完成检查、打包、正常退出旧版、覆盖安装并启动新版。退出时等待日记草稿保存和数据库关闭，保存或退出失败则停止，不强制结束用户应用。仅测试构建请用 `pnpm build:only`。

## Windows 安装包

```powershell
pnpm dist:win
# 只生成安装包，不触发本机自动安装：
node scripts/build-installer.cjs --no-install
```

输出 `release/ColDesk-<version>-Windows-x64-Setup.exe` 和 `.sha256`。发行脚本核对安装归档，排除数据库、日志和个人配置。默认安装到当前用户，卸载保留业务数据。

发布前检查版本、类型、测试、公开源码审计和隔离启动；截图使用虚构数据。创建版本标签和发布说明，将安装包与 SHA-256 作为 Release 附件，源码归档由 GitHub 根据标签生成。不要在普通提交中加入安装包、数据库或 `node_modules`。

## 原创图标

源文件 `assets/icons/app-icon.svg` 采用项目 MIT 许可证。运行 `pnpm icons:generate` 可用隐藏的 Electron 窗口生成各尺寸 PNG 和 ICO；安装向导插图在打包时生成。个人自选图标保存在自己的数据目录，不提交仓库。

## 移动端

`mobile/` 与 `android/` 为实验工程。工具链描述和签名位于仓库外的 `.android-tools`，不随源码发布，开发者需自行配置 Java、Android SDK、Gradle 和签名。当前桌面 CI 不验证 Android 发布。
