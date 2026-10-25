请先阅读 docs/PROJECT.md 与 README.md，并结合 docs/TASKS.md、docs/VERIFICATION.md 确认实际进度和最近验证范围。

Orinui 是本地优先、无 Orinui 账号、无广告、无追踪的 Chrome 新标签页扩展，当前处于后续 Beta 功能实施阶段，允许继续编写代码。

发布规则：GitHub `v0.1.0-beta.1` Release 已撤下，源码和签名标签保留。后续发布必须在候选构建、验证和发布材料可审阅后，获得用户对该具体版本的单独明确确认。实施授权、测试/构建通过、提交或标签签名均不构成发布授权。未经该确认不得创建/更新 GitHub Release、上传发布附件、推送发布标签或提交 Chrome Web Store。正式版通过 Chrome Web Store 发布。

已确认的设计与数据规则分别见 docs/VISUAL-SPEC.md 和 docs/DATA-CONTRACT.md；工程边界见 docs/ARCHITECTURE.md。实施前阅读对应文档，不重新推翻已确认的方向。

沿用 WXT + React + TypeScript、Tailwind CSS v4、shadcn/ui 与 Dexie。主页采用 Niagara 双列沉浸留白设计，包含时钟、搜索、网站、一层文件夹和便签/待办；内容在主页整理，居中设置面板负责外观、布局和数据管理。

优先补齐已确认的 MVP 功能。新标签页渲染只读取本地数据和资源；联网下载必须由用户主动操作并按数据契约请求具体来源权限。不自动抓取 favicon，不引入 Orinui 账号、广告、追踪或后台代理。用户可选择外部存储启用跨设备同步；同步规则见 docs/SYNC-DESIGN.md。

MVP 范围取舍见 docs/PROJECT.md。默认中性渐变、不含联网建议；支持本地照片、MP4/WebM/GIF/动画 WebP 动态壁纸及 ZIP-only 完整备份。本轮 Beta 2 明确不兼容 Beta 1 ZIP/sync wire format，但不得自动清空本地或远端数据。用户已确认跨设备同步照片和图标；动态媒体原件也须云端逐文件端到端加密，poster 仅为本地可重建缓存。基础层、手动协调器、WebDAV 适配器、连接界面及启用后的事件调度已实现。真实 WebDAV 服务验收由用户确认完成；动态素材库、R2 和焦点暂停组合须分别验收。后续按 docs/SYNC-DESIGN.md 中的协议、协调器与提供方章节实施。协调器须显式注入提供方，测试内存对象服务不能成为运行时替代。不得把设计定稿、代码存在、自动检查通过或受控 fixture 验收混为一谈。

2026-10-14 用户确认当前 UI、既有功能扩展权限和屏幕吸管验收完成；之后用户另行确认真实 WebDAV 服务验收完成。记录依据和范围见 docs/VERIFICATION.md。下一阶段顺序与延期项见 docs/TASKS.md。用户验收不替代已记录的自动测试失败或超时；本轮新增动态媒体同步仍须独立验证。

数据校验放在领域层，跨表写入使用事务，浏览器 API 集中在 src/platform。失败明确显示，不静默降级或伪造成功。

改动后更新相关规范、docs/TASKS.md 和 docs/VERIFICATION.md，执行 pnpm compile、pnpm test、pnpm build。测试进程设置 60 秒超时。浏览器验证必须区分普通网页与真实扩展环境，不把构建成功等同于功能验证。
