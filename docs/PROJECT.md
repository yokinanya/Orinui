# Orinui 产品说明

## 背景与定位

Orinui 是作为 MONKNOW 替代方案开发的 Chrome 新标签页扩展，计划公开发布到 Chrome Web Store。开发者已有 Chrome 开发者账号。

产品强调精致设计、本地优先、离线可用、无广告与推广、无追踪。**设计美观是第一优先级。** 不强制注册 Orinui 账号；可选同步使用用户自己的外部存储账号或服务器。

参考方向：MONKNOW 的网站分组管理、Bonjourr 的留白、Tabliss 的背景与布局、nightTab 的自定义能力。已确认采用沉浸留白主页，不重复进行初始视觉方案选择。

## 产品范围

1. 时钟、搜索、常用网站和分组管理。
2. 主题、背景、图标、动态配色和固定区域布局设置。
3. 克制的动效、键盘可用性、响应式布局与可读性。
4. 本地持久化，打开新标签页时先读取本机数据和资源。
5. 自包含图片的 JSON 导入、导出与本地重置。
6. 可选跨设备同步分组、网站、设置、照片和图标；Google Drive appDataFolder 或 WebDAV，端到端加密。

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

- 新标签页显示不等待网络；图片资源渲染只使用本机 Blob。
- 图片直链下载由用户主动操作，按具体来源申请权限；不自动抓取 favicon。
- 不引入 Orinui 账号、广告、追踪、自营同步存储或后台下载代理。
- 外部提供方授权只服务于用户主动启用的同步功能。
- 使用稳定实体标识、领域校验与跨表事务；失败明确显示。
- 视觉与交互遵循 [VISUAL-SPEC.md](./VISUAL-SPEC.md)，数据规则遵循 [DATA-CONTRACT.md](./DATA-CONTRACT.md)。

## 阶段与进度入口

项目处于 MVP 开发阶段。本地核心功能与首轮 UI 修复已实现；完整真实扩展和发布检查尚未完成。同步基础协议、本地版本捕获、合并、加密、事务接收及手动协调层已实现，提供方、连接界面与自动调度待接入。

[根目录 README](../README.md)提供项目概览；[TASKS.md](./TASKS.md)是实现及验收进度的主记录；[VERIFICATION.md](./VERIFICATION.md)记录检查结果和环境。产品决策定稿、代码实现、自动检查通过和真实环境验收是不同状态。
