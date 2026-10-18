# 文档索引

文档分工如下。进度、规则、决策和检查证据分别维护，避免把计划写成已经完成。

| 文档 | 职责 |
|---|---|
| [根目录 README](../README.md) | 项目概览、当前状态摘要、开发命令 |
| [Beta 发布记录](./BETA-0.1.0.md) | 首个 Beta 实现清单、验证范围、性能观测与发布状态 |
| [Beta 2 候选说明](./BETA-0.1.0-beta.2.md) | Beta 2 的功能、安装、数据兼容、权限与已知限制；本地候选尚未发布 |
| [Beta 发布说明](./RELEASE-NOTES-v0.1.0-beta.1.md) | GitHub Release 的功能摘要、安装说明和已知限制 |
| [PROJECT.md](./PROJECT.md) | 产品定位、范围、实际技术栈和开发边界 |
| [TASKS.md](./TASKS.md) | 实现与验收进度、下一阶段顺序与完成标准、延期项的主记录 |
| [VERIFICATION.md](./VERIFICATION.md) | 用户验收确认、当前/历史检查结果、执行环境及验证范围 |
| [UI-REVIEW.md](./UI-REVIEW.md) | UI 实测、修复前后截图、对比度与当前复验边界 |
| [DECISIONS.md](./DECISIONS.md) | 已定产品取舍与依据 |
| [VISUAL-SPEC.md](./VISUAL-SPEC.md) | 已确认的视觉、交互和可访问性目标 |
| [DATA-CONTRACT.md](./DATA-CONTRACT.md) | 领域模型、校验、生命周期、资源及备份规则 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 当前实现的工具链、目录、平台/数据边界和工程注意事项 |
| [SYNC-DESIGN.md](./SYNC-DESIGN.md) | 已定同步方向、当前实现边界和外部存储验收要求 |
| [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md) | 同步 schema 10 文件夹字段、旧分组格式拒绝、永久墓碑和加密事务协议 |
| [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md) | 公共对象端口、手动协调顺序、并发/失败状态及当前验证边界 |
| [SYNC-WEBDAV.md](./SYNC-WEBDAV.md) | HTTPS WebDAV 对象格式、连接流程、安全边界和受控真实扩展审计范围 |
| [SYNC-S3.md](./SYNC-S3.md) | S3/R2 配置、条件操作、容量、删除边界及真实服务验收要求 |
| [AGENTS.md](../AGENTS.md) | 开发代理的项目规则和必读入口 |

## 阅读顺序

1. 读 PROJECT.md 和根目录 README，确认产品与当前阶段。
2. 读 TASKS.md 和 VERIFICATION.md，确认未完成项及最近验证范围。
3. 修改界面前读 VISUAL-SPEC.md；修改领域/持久化/备份前读 DATA-CONTRACT.md。
4. 修改工程和模块边界前读 ARCHITECTURE.md。
5. 实施同步前读 DECISIONS.md、SYNC-DESIGN.md、SYNC-PROTOCOL.md 和 SYNC-COORDINATOR.md；按提供方再读 SYNC-WEBDAV.md 或 SYNC-S3.md，区分实现、受控审计和真实服务验收。

## 状态约定

- **规范已确认**：实施需遵循该规则，不能据此宣称功能已完成。
- **代码已实现**：源码存在；检查与真实环境验收状态另记。
- **自动检查通过**：只证明记录中的命令和范围，区分当前检查与历史检查。
- **真实扩展验收通过**：需记录 `chrome-extension://` 环境；普通网页预览不代替扩展 API。
- **用户验收完成**：记录用户直接确认的日期与范围；没有提供浏览器版本、截图或分项结果时不补写，也不等同于自动检查通过。
- **MVP 排除项**：属于已定取舍，不作为待实现任务。
- **延期**：按用户决定保留方案并延后实施，不作为当前阶段阻塞项；不标记为已实现。
- **计划/待细化**：尚无实现或协议细节未齐全，显式保留状态。

修改功能时更新 TASKS.md，修改规则时更新对应规格/设计，完成检查后更新 VERIFICATION.md。README 保留摘要和链接，不重复维护详细清单或历史日志。
