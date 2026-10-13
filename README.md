# Orinui

设计精致、轻量、本地优先的 Chrome 新标签页扩展。无 Orinui 账号、无广告、无追踪。

## 当前状态

进度整理日期：2026-10-14。项目处于 MVP 开发阶段，尚未完成全部真实扩展验收和发布验证。

本地核心功能与 WebDAV 接入已实现，整体视觉与交互尚待用户确认；自动检查、受控服务审计与用户验收分开记录。

| 范围 | 当前状态 |
|---|---|
| 主页与本地数据 | 固定图标外框、占比默认 75%、安全 SVG 矢量/单色及右下角编辑入口已实现 |
| 自动检查 | 最新主页控件色调与设置选中态 compile/build 通过；本轮未运行测试，详见 [验证记录](./docs/VERIFICATION.md) |
| Chrome 网页预览 | 最近 SVG 批次 30 项/3 文件定向回归通过；最新主页控件颜色尚未复测 |
| 真实扩展环境 | 图标占比与 SVG CDN/单色在真实扩展审计通过；来源权限弹窗、拒绝/撤销、吸管和整体 UI 验收仍待完成 |
| 跨设备同步 | WebDAV 适配器、连接界面及事件触发已实现；双配置文件受控扩展审计通过，第三方服务和权限弹窗仍待验收 |
| MVP 排除项 | 随包第三方摄影背景、联网搜索建议 |

完整进度和未完成项统一维护在 [docs/TASKS.md](./docs/TASKS.md)。产品取舍见 [docs/DECISIONS.md](./docs/DECISIONS.md)。

## 已实现功能

- **主页与管理**：时钟、搜索、分组和网站网格；宽屏最多 6 列、窄屏自适应。右键菜单、编辑模式、拖动及键盘排序、跨组移动、分组改名与删除。网站删除可在当前会话内撤销。
- **外观**：系统/浅色/深色主题，中性渐变、纯色、渐变、照片背景，照片遮罩，本机动态配色，自建取色面板与屏幕吸管入口。
- **图片**：本地照片和图标上传、严格白名单 SVG 处理与尺寸/体积校验；照片 SVG 栅格化，安全图标 SVG 规范化后保留矢量并可选单色；主页图标外框固定 48px，可调内容占比 50–100%（默认 75%）；图片链接回填后可手动更新，同来源重定向继续、跨来源再次确认；内置图标使用图形选择器，透明底预览带边框。页面仍只读本地图片，不自动抓取 favicon。
- **搜索、时钟与布局**：内置和自定义搜索引擎、12/24 小时制、三个主页区域的显示与排序，以及全部隐藏后的恢复入口。
- **本地数据**：Dexie 数据库版本 4、跨表事务、资源引用清理、自包含图片的 JSON 备份版本 1、导入预览与覆盖确认、本地重置。

新标签页初始化和渲染只读取本地数据与资源。用户连接 WebDAV 并启用同步后，扩展打开和本地变更会触发异步同步，页面先显示本地数据；用户也可手动同步。连接凭据存于当前 Chrome 配置文件的本机扩展存储，云端对象端到端加密。Google Drive 尚未接入。对象接口与执行顺序见 [docs/SYNC-COORDINATOR.md](./docs/SYNC-COORDINATOR.md)。

## 尚未完成

图标编辑中的 Dashboard Icons 链接、仅清除图片来源信息、主页进入与分组内容切换动效已实现。[UI 检查与复验](./docs/UI-REVIEW.md)中的背景对比、窄屏设置布局、关闭文案和过渡问题已修复；完整视觉验收和首屏性能仍未完成。

图标占比调节（固定 48px 外框，50–100%）及网站编辑图标/图片 URL 控件已实现；本轮完整网页回归和真实扩展定向审计记录见 [docs/TASKS.md](./docs/TASKS.md)。

SVG 兼容处理已扩展到安全内联样式、简单内嵌 CSS、静态渐变/裁剪/蒙版/平铺及内部 use 引用，并按 viewBox 归一化相对尺寸。未知或危险内容明确拒绝；本批验证是网页预览，真实扩展 CDN 下载尚未重验。支持边界见 [数据契约](./docs/DATA-CONTRACT.md)。

同步包含分组、网站、设置、照片和图标，设计支持 Google Drive `appDataFolder` 与 HTTPS WebDAV，云端强制端到端加密。WebDAV 已接入并在预授权的受控 localhost HTTPS 服务上通过两个独立扩展配置文件审计；真实第三方服务兼容性、权限弹窗/拒绝/撤销和 Google Drive 尚待验收或实施。基础协议见 [docs/SYNC-PROTOCOL.md](./docs/SYNC-PROTOCOL.md)，WebDAV 边界与审计范围见 [docs/SYNC-WEBDAV.md](./docs/SYNC-WEBDAV.md)，完整进度见任务清单。

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
