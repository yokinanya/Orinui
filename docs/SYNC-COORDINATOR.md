# 手动同步协调层

实施与验证日期：2026-10-13。公共对象接口、手动协调器、本机运行状态和集成检查已实现。WebDAV 适配器、连接界面与启用后的事件触发已接入；未启用同步时应用不会连接外部服务。Drive 适配器尚未接入。

本层沿用 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md) 的快照、合并、图片身份与加密格式，不改变提供方决策。

## 模块与入口

- `src/sync`：对象端口、`createSyncCoordinator`、分阶段协调与可识别失败。存储、锁、加密、编解码、合并策略、时间和运行 ID 生成器全部通过参数注入，没有默认模拟提供方。
- `src/domain/sync/object-types.ts` 与 `object-validation.ts`：对象/回执边界校验，拒绝重复设备、非法身份/版本、缺失字节和无效回执；复制接收字节。
- `src/storage/sync/local-store.ts`：将协调端口绑定到已有导出/接收 API，使用短事务保存运行状态，数据库由参数注入。
- `src/platform/sync-lock.ts`：委托注入的原生 Web Locks。调用方为同一配置文件使用同源、同数据库 scope 的锁，缺少管理器时明确失败。
- `src/platform/webdav-*` 与 `src/sync/webdav-*`：HTTPS WebDAV 对象存取、连接流程及配置文件级触发调度。默认使用强 ETag 条件发布；坚果云兼容模式改用 SHA-256 revision、写前读取比较和写后回读校验。适配器依然由运行时显式注入协调器。

构造协调器不执行同步；显式调用 `syncNow()` 才调用对象端口。入口返回本轮结果或拒绝 Promise，不把传输失败转成成功。

## 对象契约

地址为 `{ vaultId, objectId }`；具体适配器负责库隔离和路径段编码，不直接把标识解释成路径。

| 方法 | 必须实现的语义 |
|---|---|
| listSnapshots | 每设备一个快照及不透明 revision，重复设备拒绝 |
| readSnapshot | 读取恰好观察到的 revision；变化明确失败 |
| readAsset | 返回实际加密对象，或明确的 null（不存在） |
| createAsset | 创建媒体并返回实际 created/revision；条件模式保证不覆盖，坚果云模式先读后写并回读核对 |
| publishSnapshot | 按 expectedRevision 检查并发布完整快照；强 ETag 模式为原子条件写，坚果云模式为 SHA-256 写前比较与写后核验，不具备原子比较写入 |

创建媒体后重新读取实际对象，核对回执版本、解密、长度和 SHA-256；创建竞争返回已有对象也需验证内容。坚果云兼容模式只能检测发布前已出现的冲突，并核对写入后的字节，不能阻止两份使用相同 deviceId 的配置并发覆盖；不同配置文件各自使用不同 deviceId，本机同配置文件继续由 Web Locks 串行化。此模式仅由坚果云模板显式选择，其他服务仍要求强 ETag 条件写入。

## 执行顺序与本机状态

1. 取得独占锁，生成新的唯一 runId，原子读取身份/密钥并记录开始。
2. 导出本机一致快照、推进到期删除，读取并校验全部远端快照。
3. 尚无本机基线且无自身远端快照时使用首次加入计划，否则正常合并；备齐并校验引用媒体。
4. 按 expectedGeneration、库/设备身份和 runId 原子提交完整本机候选，保存代次、观察时钟与基线标记。
5. 上传缺失媒体、验证写入结果，再按观察到的自身 revision 发布加密快照。提供方条件能力及本机选择的 WebDAV 一致性模式决定 revision 与发布保护方式。
6. 收到合法回执后记录成功时间/已发布代次。本机有更高代次时返回 pending，否则 synced。

接收先本机提交、后远端发布，使上传期间的新编辑取得更高代次和逻辑版本，避免与尚未提交的候选争用同一版本。网络、加解密、哈希和图像解码都在事务外，事务只检查当前状态并原子写入。[Dexie 事务说明](https://dexie.org/docs/Tutorial/Best-Practices)

当前 Dexie schema 为 4；同步表及索引在版本 3 引入，版本 4 不改表/索引，只迁移规范化图标占比和对应同步寄存器。`sync_state` 可选保存 hasAcceptedSnapshot、lastSync 和 lastSuccessfulSync，记录本机基线、运行身份/阶段/发布状态/时间/错误及成功代次/revision，不进入快照或普通 JSON 备份。

基线在完整接收事务中保存：首次接收后发布失败，再次运行不会重新提升已收到的字段、覆盖其他设备后续修改。空设备首次接收有变化时，代次也递增。旧 runId 在断开并用同一库/设备重连后，不能修改新连接状态。

## 结果与失败

`SyncRunResult` 返回已发布/本机代次、revision、上传/接收数量和 repairedAssetIds。后者显式报告远端缺媒体且本机有验证副本时的补传；存在但损坏的对象直接失败，不覆盖或绕过。

`SyncCoordinatorError` 保留 cause、phase、publication 与 statusRecorded：not-started 表示尚未发起快照发布；unconfirmed 表示未收到合法回执，不能推断远端未写入；confirmed 表示发布已确认，后续本机记录仍可能失败。

准备期间本机变更会拒绝旧候选并保留用户编辑。接收事务本身整体成功或回滚；随后网络失败保留完整合并结果并标失败/待同步，不能跨本机和远端伪造回滚。已发起请求可能产生远端副作用，断开不假称撤销远端写入。

回执丢失、条件冲突或上传中断后，下次手动同步重新读取并合并，没有后台重试/轮询。正确媒体复用，不重复创建；未被快照引用的上传对象暂时保留，GC 尚未实施。撤销窗口在准备期间到期时，旧候选明确失败，下次导出推进墓碑，不复活网站。

## 验证与边界

- **历史协调层批次（2026-10-12）**：编译、34 文件/278 项单元测试、MV3 构建和 44 项网页回归通过。该记录对应当时的代码，不代表当前源码状态；后续批次结果见 [VERIFICATION.md](./VERIFICATION.md)。
- 集成检查使用真实领域规则、Dexie/fake-indexeddb、Web Crypto 与 PNG 字节。测试对象服务实际存取密文、执行创建条件/revision/CAS 和失败注入；只位于 tests，不证明真实 HTTP 或提供方授权。
- 覆盖首次加入/基线、并发字段、图片还原、媒体顺序/复用/修复、坏密文与缺失/冲突媒体、条件发布与回执丢失、部分上传恢复、编辑竞态、任务串行、同身份重连和撤销到期。
- 独立 Chromium 153.0.8010.12 的真实扩展审计副本验证原生锁：第一页持锁时第二页等待，第一页抛错后第二页取得锁。[Web Locks 同源协作](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- 原生锁审计编译实际适配器源码；脚本/结果在忽略的 `.output/sync-lock-audit.mjs` 与 `.output/sync-lock-audit-result.json`。生产产物及用户配置未改，临时配置已关闭并清理。

设备集合、远端媒体清理、密钥轮换的协议与 MVP 边界及第三方 WebDAV 服务验收仍待完成；Google Drive 适配器与 OAuth 延期。受控本机 HTTPS 服务上的双配置文件真实扩展审计通过，但该审计预授权来源，未验证权限弹窗、拒绝与撤销。2026-10-14 现有功能扩展权限另获用户确认；真实 WebDAV 服务及该来源上的权限与同步组合仍需记录，见 [TASKS.md](./TASKS.md)、[VERIFICATION.md](./VERIFICATION.md) 与 [SYNC-WEBDAV.md](./SYNC-WEBDAV.md)。
