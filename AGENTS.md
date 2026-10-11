请先阅读 docs/PROJECT.md 与 README.md，并结合 docs/TASKS.md、docs/VERIFICATION.md 确认实际进度和最近验证范围。

Orinui 是本地优先、无 Orinui 账号、无广告、无追踪的 Chrome 新标签页扩展，当前处于 MVP 开发阶段，允许继续编写代码。

已确认的设计与数据规则分别见 docs/VISUAL-SPEC.md 和 docs/DATA-CONTRACT.md；工程边界见 docs/ARCHITECTURE.md。实施前阅读对应文档，不重新推翻已确认的方向。

沿用 WXT + React + TypeScript、Tailwind CSS v4、shadcn/ui 与 Dexie。主页采用沉浸留白设计，包含时钟、搜索、分组和网站网格；网站与分组在主页编辑，设置抽屉负责外观、布局和后续数据管理。

优先补齐已确认的 MVP 功能。新标签页渲染只读取本地数据和资源；联网下载必须由用户主动操作并按数据契约请求具体来源权限。不自动抓取 favicon，不引入 Orinui 账号、广告、追踪或后台代理。用户可选择外部存储启用跨设备同步；同步规则见 docs/SYNC-DESIGN.md。

MVP 范围取舍见 docs/DECISIONS.md。默认中性渐变、不含联网建议，仍支持本地照片与 JSON 备份。用户已确认跨设备同步照片和图标；提供方为 Google Drive appDataFolder 或 WebDAV，云端强制端到端加密。基础层和手动协调器已实现，提供方与连接界面尚未接入；按 docs/SYNC-DESIGN.md、docs/SYNC-PROTOCOL.md 和 docs/SYNC-COORDINATOR.md 继续实施。协调器须显式注入提供方，测试内存对象服务不能成为运行时替代。不得把设计定稿、代码存在、自动检查通过或真实扩展验收混为一谈。

数据校验放在领域层，跨表写入使用事务，浏览器 API 集中在 src/platform。失败明确显示，不静默降级或伪造成功。

改动后更新相关规范、docs/TASKS.md 和 docs/VERIFICATION.md，执行 pnpm compile、pnpm test、pnpm build。测试进程设置 60 秒超时。浏览器验证必须区分普通网页与真实扩展环境，不把构建成功等同于功能验证。
