# 已定产品范围

决策日期：2026-10-11；优先级与验收状态更新于 2026-10-14。本文件记录产品范围与高层设计取舍；实现进度见 [TASKS.md](./TASKS.md)，验证证据见 [VERIFICATION.md](./VERIFICATION.md)。

## 默认背景：使用本地中性渐变

MVP 不随包提供第三方摄影图片。主页仍支持本地照片上传和用户主动下载图片直链，初始背景使用现有中性渐变。

依据：Unsplash 许可限制把图片集合用于类似或竞争服务；Pexels 限制将图片作为独立壁纸内容再分发，并要求壁纸类 API 用例审查；NASA 图像需要来源标注、检查版权例外，且不能暗示 NASA 背书。[Unsplash 许可](https://unsplash.com/license)、[Pexels 许可](https://www.pexels.com/license)、[Pexels 壁纸 API 说明](https://help.pexels.com/hc/en-us/articles/4405588861721-Can-I-use-the-API-as-a-wallpaper-app)、[NASA 媒体指南](https://www.nasa.gov/nasa-brand-center/images-and-media/)。首版不把这些许可和素材维护风险放进扩展包。用户自行选择并保存的照片仍属于已支持功能。

## 联网搜索建议：不包含在 MVP

搜索建议会把用户正在输入的内容发送给外部服务，当前没有与无需账号、无密钥、无追踪的定位相符且已经核验的服务。Brave Autosuggest 要求 API 密钥；Brave 明确要求不要将密钥放在客户端，建议查询最长保留 90 天，账户还需付款信息。[Autosuggest 接口](https://api-dashboard.search.brave.com/documentation/services/suggest)、[认证规则](https://api-dashboard.search.brave.com/documentation/guides/authentication)、[隐私说明](https://api-dashboard.search.brave.com/documentation/resources/privacy-notice)。MVP 只执行用户提交的搜索，不在输入过程中发送请求。

如未来重新引入建议服务，需先展示发送内容和接收方，取得用户明确启用，并使用安全的密钥持有方案；不在扩展包中嵌入 API 密钥。

## 跨设备同步：使用外部存储并强制端到端加密

用户确认同步照片和图标，并接受外部存储。提供方方案为 Google Drive appDataFolder 或 WebDAV；一个同步库一次使用一个提供方。2026-10-14 用户决定 Google Drive 适配器延后，当前推进 WebDAV；Drive 方案保留，不作为当前阶段的阻塞项。不创建 Orinui 账号或自营后端，也不使用 Chrome storage.sync 承载数据。

同步数据使用每设备独立快照和字段级逻辑版本，避免设备争写同一文件；相同字段冲突按逻辑时钟和设备 ID 确定结果，删除通过墓碑传播。快照与图片使用 AES-256-GCM 端到端加密，恢复密钥由用户保存，不上传或写入普通备份。首次连接先合并数据，不静默覆盖本地状态。

同步是可选功能：用户启用后，数据变更及扩展打开时异步同步，并可手动触发；删除撤销期限到达时另设单次计时触发，不做定时轮询或自动重试。页面关闭可能中断任务，下一次打开或手动操作恢复。详细规则见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)。基础协议、本地合并/加密/接收、WebDAV 适配器及连接界面已实现；受控 localhost HTTPS 的真实扩展审计通过。第三方 WebDAV 服务及真实设备仍待验收，Drive 适配器和 OAuth 延期。基础细节见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md) 和 [SYNC-WEBDAV.md](./SYNC-WEBDAV.md)。

## 真实扩展验证

已记录的网页预览检查覆盖本地图片和 IndexedDB 流程；单元测试覆盖图片/URL 等领域校验，不能替代 Chrome 权限对话框或真实屏幕取色。2026-10-14 用户确认当前 UI、现有功能扩展权限和屏幕吸管验收完成；扩展名称/版本另有历史真实扩展检查。用户确认与自动检查、受控审计分别记录，详见 [VERIFICATION.md](./VERIFICATION.md)。

## 网站图标占比与编辑入口（2026-10-13）

初版像素尺寸交互在后续 UI 检查中被用户修正：主页外框固定 48px，图案仅调整框内占比；编辑预览固定 64px、透明底并加细边框。2026-10-14 用户将默认占比从 100% 调整为 75%，范围仍为 50–100%、步长 1%；当前默认值省略序列化字段，缺少字段的图标按 75% 显示。IndexedDB 为版本 4，并把旧 `size` 值按 `round(size / 48 * 100)` 换算、限制在 50–100%；JSON 和快照版本保持 1，读取旧字段时同样转换，新写入只保存偏离默认值的 `occupancy`。高于 48px 的旧值转换为 100%。旧构建遇到新字段时可能按未知字段拒绝，不承诺向下兼容。

图片 URL 编辑改用“自定义图片URL”标签和右侧下载图标按钮；上传图标按钮与首字/内置图标入口同行。删除重复的保存说明，保留必要的跨来源目标确认与明确错误，不新增 cookie/provider 确认弹窗。

## SVG 图标保留与单色覆盖（2026-10-13，已实现）

用户要求支持 SVG 图标及颜色调节，并可主动下载 `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/x.svg`。方向是严格白名单校验后将 SVG 图标以 `image/svg+xml` Blob 保存；背景 SVG 仍转为 PNG。图标可选择 `#rrggbb` 单色覆盖，通过本地 CSS mask 着色；不设置颜色显示源 SVG 原色，清除颜色恢复原色。颜色随图标原子字段保存/同步。已有 PNG 不可变成矢量，且不自动重下载，只有用户主动重选 SVG 才能调色。

允许 SVG namespace 声明与 XML `xml:space="default|preserve"`；其他未显式列出的元素/属性和外部资源仍拒绝。JSON、snapshot、Dexie 版本保持不变，旧构建遇到新字段仍明确拒绝。实现与最终验证状态见 TASKS.md 和 VERIFICATION.md。

## 首个 GitHub Beta 的数据基线（2026-10-15）

- Beta 增加动态壁纸：接受真实可解码的 MP4、WebM、GIF 和动画 WebP；动态媒体只由用户本地上传，视频静音循环且不自动转码。保留现有静态照片/图标单文件 10 MiB 与图片尺寸输出规则；视频不套用静态图片上限，也不设应用级视频文件大小或时长上限。取消 50 MiB 媒体总量限制，实际浏览器文件、解码和 IndexedDB 配额错误明确呈现。
- 动态视频/动图原件作为资源 Blob 保存，静态 poster 只做本地可重建缓存，不备份、不上传 poster。ZIP 备份和 WebDAV 同步都包含动态原件；远端每项媒体继续逐文件 AES-GCM 端到端加密。
- 公开首个 Beta 采用 ZIP-only 完整备份，`formatVersion` 为 1：`manifest.json` 保存配置、媒体元数据和摘要，`assets/<assetId>` 保存原始字节。完整校验和预览通过后，由用户确认事务化替换。ZIP 默认不加密，排除 WebDAV 凭据、恢复密钥、CryptoKey、同步状态和派生 poster。
- 首个 Beta 同步快照采用 schema 3。开发期 JSON 备份和旧同步快照都不兼容，不增加转换或兼容分支；旧格式必须明确拒绝，不自动删除远端或清除本机数据。此前关于开发期 JSON/snapshot 版本的记载描述的是当时实现，以上述 Beta 基线为准。
- 构图编辑器、竖屏专项、计算器和命令面板不纳入本轮；搜索增强仍是候选。正式版渠道为 Chrome Web Store，Beta 通过 GitHub Pre-release 手动发布。
