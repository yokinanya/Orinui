# 同步基础协议 v1

状态：已实现并自动验证领域合并、本地版本捕获、加密对象、事务接收及手动同步协调层。WebDAV 适配器、连接界面和事件触发已接入，并通过受控服务真实扩展审计；真实第三方 WebDAV 服务及用户设备仍待验收。现有功能扩展权限已有用户确认，Google Drive 适配器与 OAuth 延期，详见 [VERIFICATION.md](./VERIFICATION.md)。本文不把受控审计等同于发布可用性。

## 版本与身份

Dexie schema 4 保存本机数据和同步元数据，JSON 备份仍是版本 1；同步快照 schemaVersion 为 1，加密对象格式为 ORINUI01。这四套版本独立升级，未知同步/加密版本明确拒绝。

vaultId 标识一个同步库，deviceId 标识一个 Chrome 配置文件。实体标识沿用已有稳定 ID，新实体使用 UUID。协议接受既有非空字符串标识，但拒绝首尾空白和控制字符；不能用永久删除的标识重新创建实体。

每个冲突字段是 `{ value, clock, deviceId }`。clock 为非负安全整数，先按数值比较，再按 deviceId 字典序比较；同一个 clock/deviceId 对应不同内容视为损坏/冲突，不依赖输入顺序选值。

generation 是每设备快照代次，不跨设备比较。实际本地变更和合并内容变化才递增，重复导出不递增。观察到的最大逻辑时钟用于下一次本机写入，计数器不能溢出安全整数。

## 原子字段与资源

| 实体 | 寄存器/不可分割更新单元 |
|---|---|
| 分组 | name、colorRole、position 各自独立 |
| 网站 | title、url 独立；groupId 与 order 合为 placement；icon 引用为一个寄存器 |
| 设置 | appearance、layout、clock 各为一个单元；defaultEngineId 独立；自定义引擎按 ID 保存 |
| 默认组 | vault 级 defaultGroupId 寄存器，isDefault 从它派生 |
| 图片 | id、kind、MIME、尺寸、byteLength、SHA-256 不可变；sourceUrl 单独版本化 |

图片来源 URL 随完整快照加密同步，包括已保存的查询参数；它也仍随普通 JSON 备份导出。清除来源会同步清空资源及相关网站的来源字段，保留 Blob 和引用。凭据、恢复密钥和 CryptoKey 不进入快照或普通备份。

排序合并后按位置、字段版本、设备 ID 和实体 ID 确定顺序，本机物化为连续 order。重编号不伪造用户修改；随后只改名称/标题时，未改动的位置寄存器仍保留原版本。

## 本地捕获与删除

数据库迁移只新增 sync_state、sync_records、sync_keys，不自动启用同步，不改变用户 ID。initializeSyncVault 建立状态和密钥后，全量 seed 已有实体。

DBCore 中间件只在本机已配置同步状态时捕获业务写入，并把版本记录与领域写入放在同一事务。事务回滚也回滚元数据；接收远端时 suspended 标记在同一事务中暂停本机捕获，避免回声更新。

网站删除立即从本机可见列表移除，撤销仍限当前页面会话 5 秒。同步记录先保留活版本及 pendingDeleteUntil；期限内导出仍保留该网站及必要图片，撤销清掉待删除状态。到期再生成永久墓碑，不复活同 ID。

pending 图片已从当前 assets 回收时，仅在本地同步记录中暂存撤销所需 Blob；共享图片只保留一份。finalizePendingDeletes 在导出前推进到期删除并释放缓存。WebDAV 事件调度在最近一个撤销期限到达时使用单次 timer 触发；扩展页关闭可能中断，下一次扩展页打开或手动同步恢复，不使用周期轮询或自动重试。

删除分组永久生效并给当时组内网站生成墓碑。合并时，仍指向已删组的网站也产生级联墓碑；已有网站墓碑优先于并发移组。没有自身墓碑且最新 placement 已移到存活组的网站保留。

自定义引擎删除使用独立墓碑。普通本地图片 prune 只清理本地无引用 Blob，不为媒体制造永久墓碑；远端媒体垃圾回收需在提供方协调协议完成后实施。

## 首次连接与本地替换

planSyncJoin 是无写入的首次合并计划。新设备使用独立 deviceId 和相同 vaultId：

- 精确的初始空状态（唯一“常用”组、默认设置、无网站/图片/墓碑）使用远端基线，不留下重复初始组。
- 有本机数据时保留其实体，远端默认组仍作为库的默认身份，本机额外默认组成为普通组。
- 首次合并时，本机已有字段被视为一次新设备提交，其版本高于已观察远端版本；同 ID 的图片内容冲突仍拒绝，不丢弃本机数据。

JSON 导入仍是用户确认的完整替换。已被该库登记过的导入 ID 会换成新 ID，并一起更新分组、网站、图片和引擎引用；被替换实体通过墓碑传播，避免旧删除身份复活。没有配置同步时，备份 ID 继续原样恢复。

本地重置仍恢复空默认数据；已配置同步时，其删除与新默认组同时进入版本记录。断开本机同步只清理本机同步状态/密钥，不删除本地网站或任何外部文件。

## 接收与冲突

接收先严格校验字段、版本、域内规则、限额及全部引用，再验证媒体 MIME、大小、SHA-256、静态格式和实际解码尺寸。媒体校验在事务外完成，不静默重新编码/降质。

最终事务检查 vaultId、deviceId 与 expectedGeneration。准备期间本机发生新修改会明确失败并保留本机数据；不能直接应用未合并的其他设备快照。

应用一次性替换领域数据和同步记录，保留本机密钥。尚在撤销期的网站保持本地隐藏和缓存；远端最终墓碑会取消待撤销状态。本机已有墓碑不能从接收结果中丢失。

引用与永久删除发生冲突时抛出 SyncMergeConflictError，携带 code 和 entityId：

- default-group-deleted：合并的默认组已被删除。
- custom-engine-deleted-while-default：被选中的自定义引擎同时被删除。
- asset-deleted-while-referenced：仍被网站/背景引用的媒体被永久删除。

本地数据不因此部分应用。提供方界面需说明冲突并让用户重新选择/处理，不自动切换引擎、背景或分组。

## 加密字节格式

恢复密钥是 32 字节随机值，以规范 Base64url 编码为 43 字符且无 padding。新生成密钥会重新取随机值，直到首字符为 ASCII 字母或数字；导入仍接受全部规范 Base64url 编码，以兼容既有密钥。导入后为不可导出的 AES-256-GCM CryptoKey；密钥只留本机 IndexedDB，不写到云端、普通配置或 JSON 备份。

加密对象为：

```text
8 字节 UTF-8 魔数 ORINUI01 | 12 字节随机 IV | 密文及 16 字节认证 tag
```

AAD 是按固定字段顺序 JSON 编码的 `{ schemaVersion: 1, vaultId, kind, objectId }`；kind 为 snapshot 或 asset。每次加密产生新随机 IV。快照正文是 UTF-8 JSON；媒体正文是已保存的原始静态图片字节。

快照 objectId 是 deviceId，媒体 objectId 是 assetId。解密后的快照身份必须与 AAD 相同；媒体必须匹配已验证快照中的长度和 SHA-256。错误密钥、身份置换、篡改、未知格式和无效 UTF-8/JSON 都明确失败。

恢复密钥和全部已解锁设备同时遗失时无法恢复加密副本；仍有本地数据时可继续使用普通 JSON 备份。跨设备密钥轮换尚需提供方原子发布和旧设备处理协议，本批没有宣称已经支持。

## 已实现 API 与边界

- storage/sync：initialize/disconnect、seed、捕获、finalize、export、seal、first join plan、apply。
- domain/sync：严格快照解析、字段合并、确定性物化、时钟与可识别引用冲突。
- platform/sync-crypto、sync-codec、sync-images：注入的原生 Web Crypto、字节格式与真实图片验证器。
- sync：公共对象端口、分阶段 syncNow、运行身份/失败与发布确认状态；本地适配器保存一次性基线，原生锁保证同源同 scope 串行。顺序与对象契约见 [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md)。
- 自动检查使用独立内存 IndexedDB 模拟设备，真实 Web Crypto 进行密钥和密文验证；不模拟提供方上传成功。

手动协调先完整校验并事务提交本机候选，再上传媒体、按提供方一致性策略发布快照；强 ETag 服务使用原子条件发布，坚果云使用 SHA-256 写前比较和写后回读。发布失败保留已完整接收的结果与未同步新编辑，不跨本机和远端伪造回滚。运行记录与基线标记不进入快照或 JSON 备份。此适配器策略不改变本文件定义的快照/加密 schema。

尚需实施或验收：第三方 WebDAV 服务兼容性及该来源上的权限与同步流程；设备集合/远端清理、完整密钥轮换的协议与 MVP 边界及真实用户设备验收。Google Drive 适配器及 OAuth 延期，不作为当前阶段阻塞项。受控服务审计范围见 [SYNC-WEBDAV.md](./SYNC-WEBDAV.md)，进度见 [TASKS.md](./TASKS.md)。

依据：[Dexie middleware](https://dexie.org/docs/Dexie/Dexie.use%28%29)、[Web Crypto importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)、[AES-GCM 参数](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)。
