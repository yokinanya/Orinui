# 已定产品范围

决策日期：2026-10-11。本文件记录产品范围与高层设计取舍；实现进度见 [TASKS.md](./TASKS.md)，验证证据见 [VERIFICATION.md](./VERIFICATION.md)。

## 默认背景：使用本地中性渐变

MVP 不随包提供第三方摄影图片。主页仍支持本地照片上传和用户主动下载图片直链，初始背景使用现有中性渐变。

依据：Unsplash 许可限制把图片集合用于类似或竞争服务；Pexels 限制将图片作为独立壁纸内容再分发，并要求壁纸类 API 用例审查；NASA 图像需要来源标注、检查版权例外，且不能暗示 NASA 背书。[Unsplash 许可](https://unsplash.com/license)、[Pexels 许可](https://www.pexels.com/license)、[Pexels 壁纸 API 说明](https://help.pexels.com/hc/en-us/articles/4405588861721-Can-I-use-the-API-as-a-wallpaper-app)、[NASA 媒体指南](https://www.nasa.gov/nasa-brand-center/images-and-media/)。首版不把这些许可和素材维护风险放进扩展包。用户自行选择并保存的照片仍属于已支持功能。

## 联网搜索建议：不包含在 MVP

搜索建议会把用户正在输入的内容发送给外部服务，当前没有与无需账号、无密钥、无追踪的定位相符且已经核验的服务。Brave Autosuggest 要求 API 密钥；Brave 明确要求不要将密钥放在客户端，建议查询最长保留 90 天，账户还需付款信息。[Autosuggest 接口](https://api-dashboard.search.brave.com/documentation/services/suggest)、[认证规则](https://api-dashboard.search.brave.com/documentation/guides/authentication)、[隐私说明](https://api-dashboard.search.brave.com/documentation/resources/privacy-notice)。MVP 只执行用户提交的搜索，不在输入过程中发送请求。

如未来重新引入建议服务，需先展示发送内容和接收方，取得用户明确启用，并使用安全的密钥持有方案；不在扩展包中嵌入 API 密钥。

## 跨设备同步：使用外部存储并强制端到端加密

用户确认同步照片和图标，并接受外部存储。提供方选择 Google Drive appDataFolder（默认推荐）或 WebDAV；一个同步库一次使用一个提供方。不创建 Orinui 账号或自营后端，也不使用 Chrome storage.sync 承载数据。

同步数据使用每设备独立快照和字段级逻辑版本，避免设备争写同一文件；相同字段冲突按逻辑时钟和设备 ID 确定结果，删除通过墓碑传播。快照与图片使用 AES-256-GCM 端到端加密，恢复密钥由用户保存，不上传或写入普通备份。首次连接先合并数据，不静默覆盖本地状态。

同步是可选功能：用户启用后，数据变更及扩展打开时异步同步，并可手动触发；不做定时轮询。详细规则见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)。范围与高层规则已定，基础协议及本地合并/加密/接收已实现；提供方、连接界面和真实服务端验证尚未完成。基础细节见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)。

## 真实扩展验证

已记录的网页预览检查覆盖本地图片和 IndexedDB 流程；单元测试覆盖图片/URL 等领域校验。它们没有验证 Chrome 权限对话框或真实屏幕取色。图片来源权限、拒绝路径、屏幕吸管与扩展自身信息仍需真实扩展验收，详见 [VERIFICATION.md](./VERIFICATION.md)。
