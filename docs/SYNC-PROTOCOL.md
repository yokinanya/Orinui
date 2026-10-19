# 同步基础协议（快照 schema 11）

状态：当前 schema 11 使用一层文件夹与网站 placement，新增独立 searchCustomization 寄存器；仅对 schema 10 提供严格校验后的显式升级，新寄存器补默认值和零逻辑时钟，既有配置不被覆盖。旧分组格式拒绝且不清库。完整背景素材库逐文件加密，poster 在本地重建。WebDAV/R2 验收范围见 [VERIFICATION.md](./VERIFICATION.md)，实现、fixture 和构建均不等同于真实服务验收。

## 版本与身份

当前 Dexie schema 为 12、ZIP formatVersion 为 9、同步快照 schema 为 11；显式升级 Dexie 11、ZIP 8 和同步 10，规则见 [SEARCH-DESIGN.md](./SEARCH-DESIGN.md)。旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不清理本机数据、同步身份、密钥或远端库。加密 envelope 魔数仍为 ORINUI01，AAD 的固定 `schemaVersion` 仍为 1；这些版本各自独立。旧客户端不支持 schema 11。

vaultId 标识一个同步库，deviceId 标识一个 Chrome 配置文件。实体标识沿用已有稳定 ID，新实体使用 UUID。协议接受既有非空字符串标识，但拒绝首尾空白和控制字符；不能用永久删除的标识重新创建实体。

每个冲突字段是 `{ value, clock, deviceId }`。clock 为非负安全整数，先按数值比较，再按 deviceId 字典序比较；同一个 clock/deviceId 对应不同内容视为损坏/冲突，不依赖输入顺序选值。

generation 是每设备快照代次，不跨设备比较。实际本地变更和合并内容变化才递增，重复导出不递增。观察到的最大逻辑时钟用于下一次本机写入，计数器不能溢出安全整数。

## 原子字段与资源

| 实体 | 寄存器/不可分割更新单元 |
|---|---|
| 文件夹 | name、position 各自独立；不含父文件夹引用 |
| 网站 | title、url 独立；folderId（null 表示主页）与 order 合为 placement；icon 引用为一个寄存器 |
| 设置 | appearance、layout、clock、searchPreferences、searchCustomization、shortcutPreferences 各为一个单元；defaultEngineId 独立；自定义引擎按 ID 保存 |
| 媒体 | id、kind、MIME、尺寸、byteLength、SHA-256、动态类型与时长不可变；sourceUrl 单独版本化。所有背景素材均在库中同步，图标仍需网站引用且为静态图片 |

资源来源 URL 随完整快照加密同步，包括已保存的查询参数；它也随 ZIP manifest 导出。动态媒体仅本地上传，因此 sourceUrl 必须为空。清除静态图片来源会同步清空资源及相关网站的来源字段，保留媒体 Blob 和引用。凭据、恢复密钥和 CryptoKey 不进入快照或 ZIP。

静态照片与图标保留既有图片校验规则。动态背景接受本地 MP4、WebM、GIF 和动画 WebP；快照记录原始字节长度、摘要、媒体类型和视频时长。上传、备份恢复和同步接收都校验媒体签名与浏览器解码能力，不自动转码。媒体原件逐文件 AES-256-GCM 加密并同步；从首帧生成的 PNG poster 只是本地缓存，不进入快照或远端对象，在同步接收时由通过校验的原件重建。

排序合并后按位置、字段版本、设备 ID 和实体 ID 确定顺序，本机物化为连续 order。重编号不伪造用户修改；随后只改名称/标题时，未改动的位置寄存器仍保留原版本。

## 本地捕获与删除

数据库版本 2 → 3 新增 sync_state、sync_records、sync_keys，不自动启用同步，不改变用户 ID。版本 4 → 5 为设置增加个性化字段与同步寄存器；旧字段的逻辑版本保留，新寄存器初始化为零。initializeSyncVault 建立状态和密钥后，全量 seed 已有实体。

DBCore 中间件只在本机已配置同步状态时捕获业务写入，并把版本记录与领域写入放在同一事务。布局和时钟各自原子捕获；搜索偏好及网站偏好使用独立寄存器。事务回滚也回滚元数据；接收远端时 suspended 标记在同一事务中暂停本机捕获，避免回声更新。

网站删除立即从本机可见列表移除，撤销仍限当前页面会话 5 秒。同步记录先保留活版本及 pendingDeleteUntil；期限内导出仍保留该网站及必要图片，撤销清掉待删除状态。到期再生成永久墓碑，不复活同 ID。

pending 图片已从当前 assets 回收时，仅在本地同步记录中暂存撤销所需 Blob；共享图片只保留一份。finalizePendingDeletes 在导出前推进到期删除并释放缓存。WebDAV 事件调度在最近一个撤销期限到达时使用单次 timer 触发；扩展页关闭可能中断，下一次扩展页打开或手动同步恢复，不使用周期轮询或自动重试。

文件夹删除产生永久文件夹墓碑，不级联产生网站墓碑。本地显式删除文件夹时事务化把网站移回主页；合并时，未被自身墓碑删除且仍指向已删文件夹的网站派生显示在主页，不改写 placement 寄存器、clock 或 deviceId。后续并发移入存活文件夹可按原寄存器正常决胜，不能被物化产生的伪编辑覆盖。所有实体删除墓碑永久保留，不因快照压缩、时间或设备离线而移除。

自定义引擎删除使用独立墓碑。若并发搜索配置仍引用被删除引擎的关键词，合并裁剪该关键词，并使用本机 deviceId 与高于所有已观察时钟的新 register clock；不能修改值却沿用旧逻辑版本。网站图标 prune 只清理本地无引用 Blob，不为图标制造永久墓碑；壁纸素材显式删除会产生 asset tombstone，并从所有设备素材库移除，远端对象 GC 仍延期。

## 首次连接与本地替换

planSyncJoin 是无写入的首次合并计划。新设备使用独立 deviceId 和相同 vaultId：

- 精确的初始空状态（默认设置、无文件夹/网站/图片/墓碑）使用远端基线，不创建默认组或示例实体。
- 有本机数据时保留其实体，文件夹与主页网站按同一当前格式合并，不合成默认文件夹。
- 首次合并时，本机已有字段被视为一次新设备提交，其版本高于已观察远端版本；同 ID 的图片内容冲突仍拒绝，不丢弃本机数据。

ZIP 导入是用户确认的完整替换。已被该库登记过的导入 ID 会换成新 ID，并一起更新文件夹、网站、媒体和引擎及关键词引用；被替换实体通过墓碑传播，避免旧删除身份复活。没有配置同步时，备份 ID 继续原样恢复。当前显式验证并升级文件夹 ZIP 8；旧分组 ZIP、Beta 1 ZIP 和开发期 JSON 继续拒绝。

本地重置仍恢复空默认数据；已配置同步时，其删除进入版本记录，不生成默认组。断开本机同步只清理本机同步状态/密钥，不删除本地网站或任何外部文件。

## 接收与冲突

接收先严格校验字段、schema 10/11（10 经显式升级；旧分组格式不迁移）、域内规则及全部引用，再验证每项媒体的 MIME、长度、SHA-256、静态图片规则或动态媒体签名和实际浏览器解码。poster 在验证通过后重建。校验在事务外完成，不静默重新编码/降质；失败时不修改本机数据。

最终事务检查 vaultId、deviceId 与 expectedGeneration。准备期间本机发生新修改会明确失败并保留本机数据；不能直接应用未合并的其他设备快照。

应用一次性替换领域数据和同步记录，保留本机密钥。尚在撤销期的网站保持本地隐藏和缓存；远端最终墓碑会取消待撤销状态。本机已有墓碑不能从接收结果中丢失。

引用与永久删除发生冲突时抛出 SyncMergeConflictError，携带 code 和 entityId：

- custom-engine-deleted-while-default：被选中的自定义引擎同时被删除。
- asset-deleted-while-referenced：仍被网站/背景引用的媒体被永久删除。

本地数据不因此部分应用。提供方界面需说明冲突并让用户重新选择/处理，不自动切换引擎或背景；已删文件夹的网站按上述明确规则派生回主页。

## 加密字节格式

恢复密钥是 32 字节随机值，以规范 Base64url 编码为 43 字符且无 padding。新生成密钥会重新取随机值，直到首字符为 ASCII 字母或数字；导入仍接受全部规范 Base64url 编码，以兼容既有密钥。导入后为不可导出的 AES-256-GCM CryptoKey；密钥只留本机 IndexedDB，不写到云端、普通配置或 ZIP 备份。

加密对象为：

```text
8 字节 UTF-8 魔数 ORINUI01 | 12 字节随机 IV | 密文及 16 字节认证 tag
```

AAD 是按固定字段顺序 JSON 编码的 `{ schemaVersion: 1, vaultId, kind, objectId }`；kind 为 snapshot 或 asset。每次加密产生新随机 IV。快照正文是 UTF-8 JSON；媒体正文是已保存的原始静态图片或动态媒体字节。

快照 objectId 是 deviceId，媒体 objectId 是 assetId。解密后的快照身份必须与 AAD 相同；媒体必须匹配已验证快照中的长度和 SHA-256。错误密钥、身份置换、篡改、未知格式和无效 UTF-8/JSON 都明确失败。

恢复密钥和全部已解锁设备同时遗失时无法恢复加密副本；仍有本地数据时可用 ZIP 备份恢复。ZIP 本身默认不加密，且不包含恢复密钥或 poster。跨设备密钥轮换尚需提供方原子发布和旧设备处理协议，本批没有宣称已经支持。

## 已实现 API 与边界

- storage/sync：initialize/disconnect、seed、捕获、finalize、export、seal、first join plan、apply。
- domain/sync：严格快照解析、字段合并、确定性物化、时钟与可识别引用冲突。
- platform/sync-crypto、sync-codec、media：注入的原生 Web Crypto、字节格式、静态图片/动态媒体验证和 poster 重建。
- sync：公共对象端口、分阶段 syncNow、运行身份/失败与发布确认状态；本地适配器保存一次性基线，原生锁保证同源同 scope 串行。顺序与对象契约见 [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md)。
- 自动检查使用独立内存 IndexedDB 模拟设备，真实 Web Crypto 进行密钥和密文验证；不模拟提供方上传成功。

手动协调先完整校验并事务提交本机候选，再逐项上传媒体原件、按提供方一致性策略发布快照；强 ETag 服务使用原子条件发布，坚果云使用 SHA-256 写前比较和写后回读。动态 poster 在接收端本地重建。发布失败保留已完整接收的结果与未同步新编辑，不跨本机和远端伪造回滚。运行记录与基线标记不进入快照或 ZIP 备份。此适配器策略不改变本文件定义的快照/加密 schema。

尚需实施或验收：动态媒体同步组合；设备集合/远端清理、完整密钥轮换的协议与 MVP 边界及真实用户设备验收。真实 WebDAV 服务验收由用户确认完成。Google Drive 适配器及 OAuth 延期，不作为当前阶段阻塞项。受控服务审计范围见 [SYNC-WEBDAV.md](./SYNC-WEBDAV.md)，进度见 [TASKS.md](./TASKS.md)。

依据：[Dexie middleware](https://dexie.org/docs/Dexie/Dexie.use%28%29)、[Web Crypto importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)、[AES-GCM 参数](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)。
