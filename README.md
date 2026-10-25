# Orinui

设计精致、本地优先的 Chrome 新标签页扩展。**无 Orinui 账号、无广告、无追踪。**

## 功能

- **Niagara 风格主页**：顶部时钟与搜索、左侧双列网站与一层文件夹；便签和待办小组件支持多行高度、拖放与键盘整理。
- **外观与壁纸**：浅色/深色主题、动态配色、纯色与渐变、本地照片及 MP4/WebM/GIF/动态 WebP；素材库先查看、再明确应用。
- **本地搜索与工具**：网站/文件夹拼音检索、自定义搜索引擎、关键词切换、计算、单位换算、颜色、日期时间和 `gh` 导航命令。
- **完整备份与可选同步**：ZIP 包含网站、文件夹、小组件、设置与媒体原件；WebDAV/S3 同步使用逐文件端到端加密。

首页渲染只读本地资源；不自动抓取 favicon、不提供联网搜索建议。联网图片下载与同步由用户主动启用，并请求具体来源权限。**ZIP 备份默认不加密**，不含同步凭据或恢复密钥。

## 当前状态

当前为未发布的 Beta 2 开发源码。旧 `v0.1.0-beta.1` Release 与附件已撤下，源码和签名标签保留；后续发布须经用户对具体候选版本单独明确确认，正式版通过 Chrome Web Store 发布。

以桌面和横屏为当前重点；竖屏专项、真实 R2、新小组件/全库媒体在真实 WebDAV 服务上的组合及焦点暂停仍有独立验收项。已记录的自动测试失败不因历史用户验收而忽略。实现进度见 [TASKS](./docs/TASKS.md)，命令结果、已知失败与验收范围见 [VERIFICATION](./docs/VERIFICATION.md)。

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
src/features/         时钟、搜索、文件夹、网站、小组件与设置
src/domain/           领域类型、校验与纯规则
src/storage/          Dexie 仓储、事务与排序
src/platform/         扩展 API、图片处理、网络与备份文件
src/components/ui/    shadcn/ui 组件
src/styles/           语义令牌与全局样式
tests/                领域、存储、平台和网页预览测试
```

[产品说明](./docs/PROJECT.md)明确各文档的职责和阅读顺序；开发规则见 [AGENTS.md](./AGENTS.md)。
