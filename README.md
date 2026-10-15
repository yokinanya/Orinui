# Orinui

设计精致、轻量、本地优先的 Chrome 新标签页扩展。无 Orinui 账号、无广告、无追踪。

## 当前状态

进度整理日期：2026-10-15。首个 GitHub Beta 版本为 `0.1.0-beta.1`，包含动态壁纸、ZIP 备份和媒体加密同步；实现及验证证据见 [Beta 发布记录](./docs/BETA-0.1.0.md)，公开版本和附件以 [GitHub Releases](https://github.com/yokinanya/Orinui/releases) 为准。

主页支持时钟、页面、网站和搜索偏好。用户已确认既有 UI、扩展权限、屏幕吸管及真实 WebDAV 服务验收。本轮新增动态媒体的受控扩展同步与离线 ZIP 恢复已验证；真实后台可见性事件专项仍未验收。

## GitHub Beta 安装

从 [GitHub Releases](https://github.com/yokinanya/Orinui/releases) 下载 `orinui-0.1.0-beta.1-chrome.zip` 及其 SHA-256 文件。GitHub 页面自动生成的 **Source code** 压缩包是源码，不可直接加载到 Chrome。

1. 将安装 ZIP 解压到一个固定位置，例如 `Documents/Orinui`。
2. 打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，并选中解压出的扩展目录。
3. 后续更新前先用扩展内的 ZIP 备份功能导出数据；把新包解压并覆盖同一个目录，再回到扩展管理页点击“重新加载”。不要移动扩展目录，否则 Chrome 可能会将其识别为另一个扩展。
4. 可先核对发布页提供的 SHA-256：Windows PowerShell 执行 `Get-FileHash .\orinui-0.1.0-beta.1-chrome.zip -Algorithm SHA256`，并与发布页值比较。

Beta 通过 Chrome 开发者模式加载，Chrome 会显示开发者模式提示。安装包不是 Chrome Web Store 版本；正式版计划通过 Chrome Web Store 发布。

| 范围 | 当前状态 |
|---|---|
| 主页与本地数据 | 固定图标外框、占比默认 75%、安全 SVG 矢量/单色及右下角编辑入口已实现 |
| 自动检查 | 类型检查、413 项限时单元/集成测试、87 项完整网页回归、生产构建及 ZIP 打包通过；干净副本验证通过 |
| Chrome 网页预览 | 覆盖动态素材、ZIP 恢复、照片/视频对比度、设置和已有功能；与真实扩展审计分开记录 |
| 真实扩展环境 | 三个隔离配置完成 WebM/GIF/1080p MP4 同步与离线 ZIP 恢复；后台可见性专项未验收，审计状态 partial |
| 跨设备同步 | 原始媒体逐文件端到端加密，封面本机重建；受控服务检查不代表新增媒体在所有第三方服务上均已兼容 |
| MVP 排除项 | 随包第三方摄影背景、联网搜索建议 |

完整进度和未完成项统一维护在 [docs/TASKS.md](./docs/TASKS.md)。产品取舍见 [docs/DECISIONS.md](./docs/DECISIONS.md)。

## 已实现功能

- **WebDAV 远端删除**：已连接面板支持删除整个远端同步库，保留本机数据并断开；留空恢复密钥检查出已有库时，可通过“忘记恢复密钥？”二次确认删除云端库后重新建库。删除不可撤销，需先停止其他设备同步；真实服务删除兼容性待验收。

- **主页与管理**：时钟、搜索、分组和网站网格；最多列数可选 4/6/8，窄屏按宽度减少。右键菜单、编辑模式、拖动及键盘排序、跨组移动、分组改名与删除。网站名称可隐藏并保留可访问名称，网站链接可在当前页或新标签页打开。
- **外观**：系统/浅色/深色主题，中性渐变、纯色、渐变、照片背景，照片遮罩，本机动态配色，自建取色面板与屏幕吸管入口。
- **图片**：本地照片和图标上传、严格白名单 SVG 处理与尺寸/体积校验；照片 SVG 栅格化，安全图标 SVG 规范化后保留矢量并可选单色；主页图标外框固定 48px，可调内容占比 50–100%（默认 75%）；图片链接回填后可手动更新，同来源重定向继续、跨来源再次确认；内置图标使用图形选择器，透明底预览带边框。页面只读本地图片，不自动抓取 favicon。
- **搜索、时钟与布局**：内置和自定义搜索引擎、可选搜索宽度/首次加载自动聚焦/新标签页打开；时钟可设置大小、秒数、日期与星期格式和显隐；页面宽度、区域间距及三个主页区域的显示与排序均可配置。
- **本地数据**：Dexie 数据库版本 5、跨表事务、资源引用清理及导入预览与覆盖确认。原开发期备份为 JSON；首个 Beta 的 ZIP-only 备份正在实施，见下节。

## 首个 Beta 新增内容（实施中，检查待补）

- 动态壁纸支持 MP4、WebM、GIF 和动画 WebP，通过本地文件上传；视频静音循环播放。新标签页仍先显示本地主页，不等待媒体解码，渲染不发起网络请求。
- 完整备份采用 ZIP：`manifest.json` 保存配置和资源元数据，`assets/` 保存原始媒体。ZIP 默认不加密，且不会导入开发期 JSON 格式。
- WebDAV 对动态媒体按文件端到端加密。新版同步格式不兼容开发期快照；格式错误需明确显示，不自动清除数据。
- 上述 Beta 新增功能尚未完成最终检查与真实扩展验收；通过项及限制会在发布前补入验证记录。

新标签页初始化和渲染只读取本地数据与资源，不等待动态媒体开始播放。用户连接 WebDAV 并启用同步后，扩展打开和本地变更会触发异步同步，用户也可手动同步。连接凭据保存在当前 Chrome 配置文件的本地扩展存储；远端配置、照片、图标及动态媒体由端到端加密保护。此 Beta 不兼容开发期同步快照格式，遇到旧格式会明确报错，不自动清除本地或远端数据。Google Drive 按用户决定延后。对象接口与执行顺序见 [docs/SYNC-COORDINATOR.md](./docs/SYNC-COORDINATOR.md)。

## 隐私与权限

Orinui 不要求 Orinui 账号，不投放广告、不植入追踪或统计代码。网站、分组、设置及媒体保存在本机浏览器数据库。搜索只在用户提交时发给当前选择的搜索引擎；选择在线图片直链下载时，只为用户确认的来源请求权限。WebDAV 仅在用户主动配置并启用后连接指定服务器，云端同步对象端到端加密。

在设置的数据管理页选择“导出 ZIP”保存完整备份；恢复时选择“导入 ZIP”，检查预览后再确认替换本机数据。导入 ZIP 前应确保选中了正确文件。旧开发期 JSON 备份不受首个 Beta 支持。

ZIP 备份保存在用户选择的位置，默认**不加密**，其中包含网站、设置以及照片、图标和动态媒体原件。请自行妥善保管备份。ZIP 不包含 WebDAV 登录凭据、恢复密钥或同步运行状态；WebDAV 凭据保存在当前 Chrome 配置文件的扩展本地存储。

基础安装权限用于扩展本地存储。网站来源权限为可选项，会在用户发起图片下载或 WebDAV 连接操作时请求；`webRequest` 只用于用户主动发起的图片直链下载。打开新标签页不会为了渲染背景请求网络。实际权限以发布包 manifest 和 Chrome 的授权提示为准。

Orinui 源码依照 [GNU GPL v3](./LICENSE) 发布；生产依赖的许可证和版权声明随扩展文件提供：[THIRD_PARTY_NOTICES.txt](./public/THIRD_PARTY_NOTICES.txt)。

WebDAV 表单默认使用坚果云，提供 Koofr、Nextcloud 与自定义模板；坚果云预填官方地址但仍可编辑，并使用 SHA-256 回读兼容模式，其他服务按配置使用强 ETag 条件模式。模板和受控本机审计本身不是服务兼容验收；既有真实 WebDAV 服务验收已由用户确认，新增动态媒体组合单独跟踪。地址与连接边界见 [docs/SYNC-WEBDAV.md](./docs/SYNC-WEBDAV.md)。

## 尚未完成

- 本批颜色令牌与对比度回归已通过；历史批次的其他失败与超时仍按当时结果保留。最新 SVG 兼容批次的扩展 CDN 下载专项尚未补充。
- 用户已确认既有真实 WebDAV 服务验收；新增动态媒体通过受控 localhost 双配置检查，真实第三方服务及用户设备的新增媒体组合仍需单独记录。
- 设备集合、远端媒体清理和完整密钥轮换尚待细化 MVP 边界；Google Drive 适配器和 OAuth 延后。
- 后台可见性专项、完整读屏器、触摸设备及更多背景组合仍待补充；已有本机性能采样不能替代完整性能验收。Chrome Web Store 提交/发布尚未进行。

下一阶段顺序和完成标准统一见 [docs/TASKS.md](./docs/TASKS.md)；用户验收依据见 [docs/VERIFICATION.md](./docs/VERIFICATION.md)，WebDAV 边界见 [docs/SYNC-WEBDAV.md](./docs/SYNC-WEBDAV.md)。

## 开发环境与命令

采用 WXT、React、TypeScript、Tailwind CSS v4、shadcn/ui 和 Dexie。开发机使用 Node.js v24；依赖要求以 `package.json`、锁文件和所用工具的运行要求为准。

```bash
pnpm install
pnpm dev
```

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动开发模式并加载 Chrome 扩展 |
| `pnpm compile` | TypeScript 类型检查 |
| `pnpm test` | Vitest 单元与集成测试，整个进程限时 60 秒 |
| `pnpm build` | 生产构建到 `.output/chrome-mv3` |
| `pnpm test:browser` | 构建后运行 Chrome 普通网页预览测试 |
| `pnpm zip` | 生成发布压缩包；打包成功不等同于已发布 |

真实扩展验收：在 `chrome://extensions` 开启开发者模式，加载 `.output/chrome-mv3`，从 `chrome-extension://` 页面检查权限、吸管和扩展自身信息。普通网页预览不能替代这些检查；测试范围与 Windows 执行环境问题见验证记录。

## 目录与文档

```text
src/entrypoints/      新标签页入口
src/app/              页面组合、主题和 React 数据桥
src/features/         时钟、搜索、分组、网站、外观与设置
src/domain/           领域类型、校验与纯规则
src/storage/          Dexie 仓储、事务与排序
src/platform/         扩展 API、图片处理、网络与备份文件
src/components/ui/    shadcn/ui 组件
src/styles/           语义令牌与全局样式
tests/                领域、存储、平台和网页预览测试
```

[文档索引](./docs/README.md)明确各文档的职责和阅读顺序；开发规则见 [AGENTS.md](./AGENTS.md)。
