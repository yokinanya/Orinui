# Orinui 产品说明

## 背景与定位

Orinui 是作为 MONKNOW 替代方案开发的 Chrome 新标签页扩展，计划公开发布到 Chrome Web Store。开发者已有 Chrome 开发者账号。

产品强调精致设计、本地优先、离线可用、无广告与推广、无追踪。**设计美观是第一优先级。** 不强制注册 Orinui 账号；可选同步使用用户自己的外部存储账号或服务器。

参考方向：MONKNOW 启发的网站与文件夹管理、Bonjourr 的留白、Tabliss 的背景与布局、nightTab 的自定义能力。已确认采用沉浸留白主页，不重复进行初始视觉方案选择。

## 产品范围

1. 时钟、搜索、主页网站和一层文件夹管理：同一网格平铺，文件夹与网站分别排序；无分组标签、主页导航栏或侧栏。
2. 主题、背景、图标、动态配色和固定区域布局设置。
3. 克制的动效、键盘可用性、响应式布局与可读性。
4. 本地持久化，打开新标签页时先读取本机数据和资源。
5. ZIP-only 完整备份导入、导出与本地重置；首个 Beta 不兼容开发期 JSON 备份。
6. 可选跨设备同步文件夹、网站、设置、完整壁纸素材库、图标及动态媒体原件，端到端加密；提供 WebDAV 和首个 S3/R2 适配器，Google Drive appDataFolder 适配器延后。

2026-10-19 搜索升级包含独立外观/结果设置、单次引擎关键词、本地全拼/首拼、显式 gh 命令和颜色/日期时间单行工具。2026-10-20 所有多列设置卡片改为左右独立堆叠，预置搜索引擎名称与 HTTPS 模板可编辑并恢复默认。输入期间不联网、不保存查询、不自动读取剪贴板；行为与迁移见 [SEARCH-DESIGN.md](./SEARCH-DESIGN.md)，运行验证另见验证记录。

用户于 2026-10-13 确认主页图标外框固定 48px、内部图案占比可调（50–100%）；2026-10-14 将默认占比调整为 75%。编辑预览使用透明底与边框；并要求 SVG 图标可安全下载及单色调节。占比修正、自动回归与真实扩展审计记录见 [TASKS.md](./TASKS.md) 与 [VERIFICATION.md](./VERIFICATION.md)。

安全静态 SVG 图标经白名单校验后规范化为矢量资源并支持可选单色调节；照片背景 SVG 仍栅格化。动态壁纸支持 MP4、WebM、GIF 和动画 WebP 本地上传，视频静音循环；网站图标继续限静态图片格式。相关检查与验收范围见 [TASKS.md](./TASKS.md) 和 [VERIFICATION.md](./VERIFICATION.md)。

MVP 默认使用中性渐变，不随包提供第三方摄影图片，不提供联网搜索建议。用户仍可上传照片或主动下载图片直链。范围依据集中在 [DECISIONS.md](./DECISIONS.md)，同步高层规则见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)。

## 当前技术栈

| 职责 | 实际采用 |
|---|---|
| 扩展与构建 | WXT + Vite，Chrome Manifest V3 |
| 界面 | React + TypeScript |
| 样式与组件 | Tailwind CSS v4、shadcn/ui（Base UI / luma）、语义颜色令牌 |
| 动效 | CSS transition、tw-animate-css，遵从减少动态效果 |
| 界面状态 | React Context 与 hooks |
| 本地存储 | IndexedDB / Dexie |
| 拖动排序 | dnd-kit |
| 动态色 | Material color utilities，在本机计算 |
| 验证 | TypeScript、Vitest、fake-indexeddb、Playwright Chrome 网页预览 |

早期建议中的 Motion 和 Zustand 未采用。目录、依赖边界与实现注意事项见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 开发边界

- 新标签页显示不等待网络；静态与动态媒体资源渲染只读取本机 Blob 和 poster 缓存。
- 图片直链下载由用户主动操作，按具体来源申请权限；不自动抓取 favicon。
- 不引入 Orinui 账号、广告、追踪、自营同步存储或后台下载代理。
- 外部提供方授权只服务于用户主动启用的同步功能。
- 使用稳定实体标识、领域校验与跨表事务；失败明确显示。
- 视觉与交互遵循 [VISUAL-SPEC.md](./VISUAL-SPEC.md)，数据规则遵循 [DATA-CONTRACT.md](./DATA-CONTRACT.md)。

## 阶段与进度入口

GitHub `v0.1.0-beta.1` Release 和附件已于 2026-10-16 撤下，源码与签名标签保留。2026-10-18 的一层文件夹模型与 MONKNOW 启发的设置/编辑界面已实现，类型检查、466 项单元测试、构建与 117 项普通网页回归通过，尚待本轮用户及真实扩展环境验收；本轮优先桌面和横屏，竖屏专项适配按用户决定暂缓；此前主页布局与界面统一批次的验证范围见 [TASKS.md](./TASKS.md) 与 [VERIFICATION.md](./VERIFICATION.md)。任何公开发布都必须获得用户对具体候选包的单独明确确认。真实窗口失焦/恢复、Cloudflare R2 服务和新增全库媒体在真实 WebDAV 服务上的组合仍待验收。当前格式为 Dexie 13、ZIP `formatVersion: 10`、同步快照 `schemaVersion: 12`，显式接收并升级上一版本的 Dexie 12、ZIP 9 和同步 11，以及当前 Beta 2 的 Dexie 11、ZIP 8 和同步 10（见 [搜索设计](./SEARCH-DESIGN.md)）。旧分组数据库、含 `groups`/`groupId` 的旧 ZIP 和同步快照明确拒绝，不自动转换、重编号或清空本地数据、同步身份及远端库。用户接受旧分组版本通过主动卸载重装重新开始；这不是自动迁移或远端删除授权。协调器支持完整壁纸素材库；Google Drive 按用户决定延期。

[根目录 README](../README.md)提供项目概览；[TASKS.md](./TASKS.md)是实现及验收进度的主记录；[VERIFICATION.md](./VERIFICATION.md)记录检查结果和环境。产品决策定稿、代码实现、自动检查通过和真实环境验收是不同状态。
