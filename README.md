# Orinui

设计精致、轻量、本地优先的 Chrome 新标签页扩展。无 Orinui 账号、无广告、无追踪。

## 当前状态

进度整理日期：2026-10-14。项目处于 MVP 开发阶段，尚未完成全部真实扩展验收和发布验证。

本地核心功能与 WebDAV 接入已实现。2026-10-14 用户确认当前 UI、扩展权限和屏幕吸管验收完成；自动检查、受控服务审计与用户验收分开记录。

| 范围 | 当前状态 |
|---|---|
| 主页与本地数据 | 固定图标外框、占比默认 75%、安全 SVG 矢量/单色及右下角编辑入口已实现 |
| 自动检查 | 本地备份行布局、坚果云默认及恢复密钥格式批次 compile/build 通过，未运行测试；此前单测 353/358 通过，5 项失败待核对，见 [验证记录](./docs/VERIFICATION.md) |
| Chrome 网页预览 | 背景批次 4 项纯色对比检查通过；分组布局失败，全套及照片专项有超时；最新备份/WebDAV 界面未运行网页回归 |
| 真实扩展环境 | 模板新增前的 UI、现有功能扩展权限和屏幕吸管由用户确认验收；新版备份面板、WebDAV 默认模板、合并预览及恢复密钥首字符待验收，图标占比与 SVG 另有历史审计 |
| 跨设备同步 | WebDAV 适配器、连接界面、服务模板及事件触发已实现；受控双配置文件审计通过，真实服务和用户设备待验收；Google Drive 延后 |
| MVP 排除项 | 随包第三方摄影背景、联网搜索建议 |

完整进度和未完成项统一维护在 [docs/TASKS.md](./docs/TASKS.md)。产品取舍见 [docs/DECISIONS.md](./docs/DECISIONS.md)。

## 已实现功能

- **主页与管理**：时钟、搜索、分组和网站网格；宽屏最多 6 列、窄屏自适应。右键菜单、编辑模式、拖动及键盘排序、跨组移动、分组改名与删除。网站删除可在当前会话内撤销。
- **外观**：系统/浅色/深色主题，中性渐变、纯色、渐变、照片背景，照片遮罩，本机动态配色，自建取色面板与屏幕吸管入口。
- **图片**：本地照片和图标上传、严格白名单 SVG 处理与尺寸/体积校验；照片 SVG 栅格化，安全图标 SVG 规范化后保留矢量并可选单色；主页图标外框固定 48px，可调内容占比 50–100%（默认 75%）；图片链接回填后可手动更新，同来源重定向继续、跨来源再次确认；内置图标使用图形选择器，透明底预览带边框。页面仍只读本地图片，不自动抓取 favicon。
- **搜索、时钟与布局**：内置和自定义搜索引擎、12/24 小时制、三个主页区域的显示与排序，以及全部隐藏后的恢复入口。
- **本地数据**：Dexie 数据库版本 4、跨表事务、资源引用清理、自包含图片的 JSON 备份版本 1、导入预览与覆盖确认、本地重置。

新标签页初始化和渲染只读取本地数据与资源。用户连接 WebDAV 并启用同步后，扩展打开和本地变更会触发异步同步，页面先显示本地数据；用户也可手动同步。连接凭据存于当前 Chrome 配置文件的本机扩展存储，云端对象端到端加密。Google Drive 尚未接入，按用户决定延后，不作为当前 WebDAV 阶段的阻塞项。对象接口与执行顺序见 [docs/SYNC-COORDINATOR.md](./docs/SYNC-COORDINATOR.md)。

WebDAV 表单默认使用坚果云，提供 Koofr、Nextcloud 与自定义模板；坚果云预填官方地址但仍可编辑，并使用 SHA-256 回读兼容模式，其他服务按配置使用强 ETag 条件模式。官方设置指引保留，模板和本地受控审计不代表真实服务兼容验收。地址与连接边界见 [docs/SYNC-WEBDAV.md](./docs/SYNC-WEBDAV.md)。

## 尚未完成

- 自动回归仍有已记录的失败与超时；用户自行执行后续测试，人工验收不把这些结果改为通过。最新 SVG 兼容批次的扩展 CDN 下载专项也尚未补充。
- 真实第三方 HTTPS WebDAV 服务、该服务上的来源权限与同步组合、双配置文件恢复及真实设备并发/离线/删除场景尚未验收。受控 localhost 审计不能替代这些结果。
- 设备集合、远端媒体清理和完整密钥轮换尚待细化 MVP 边界；Google Drive 适配器和 OAuth 延后。
- 完整读屏器、触摸设备与照片组合检查、首屏性能、发布压缩包和 Chrome Web Store 提交/发布尚未完成。

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
