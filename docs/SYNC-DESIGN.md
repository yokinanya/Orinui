# 跨设备同步设计

决策日期：2026-10-11；进度与优先级更新于 2026-10-14。同步范围、提供方与安全策略已定；基础层、手动协调器、WebDAV 适配器、连接界面与事件调度已实现。WebDAV 通过受控 localhost HTTPS 服务的真实扩展双配置文件审计；真实第三方服务和用户设备仍待验收。现有功能扩展权限已由用户确认，记录见 VERIFICATION.md；Google Drive 适配器与 OAuth 延后，不阻塞当前 WebDAV 阶段。

当前数据库为版本 4，保留四张领域表和三张同步表。已有公共对象端口、手动协调及本机运行记录；WebDAV 已接入，Google OAuth/Drive 尚未接入且已延期。WebDAV 凭据配置保存在当前配置文件 `chrome.storage.local`，不在 Dexie 同步状态中。基础协议见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)，协调顺序/边界见 [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md)，WebDAV 细节见 [SYNC-WEBDAV.md](./SYNC-WEBDAV.md)。实施进度见 [TASKS.md](./TASKS.md)，真实检查结果见 [VERIFICATION.md](./VERIFICATION.md)。

## 目标与范围

- 跨设备同步分组、网站、设置、照片和图标。
- Dexie 仍是各设备的本地工作数据源；新标签页先读本地数据，网络同步异步运行，不阻塞页面渲染。
- 同步是可选功能。用户明确启用并配置提供方后，扩展在本地修改后及扩展打开时同步；同时提供手动同步入口。不启用定时轮询。
- 不创建 Orinui 账号或自营同步后端。用户使用自己的 Google Drive 或 WebDAV 服务账号。
- 不使用 Chrome `storage.sync` 保存正文或通知标记。图片和数据都由所选外部提供方承载。
- 一个同步库一次选择一个提供方；不双写。更换提供方需要用户发起迁移。当前仅 WebDAV 已接入，Drive 方案保留但实施延后。

## 提供方决策

长期方案包含两个提供方，原设计推荐 Google Drive `appDataFolder`；当前阶段按用户决定先推进 WebDAV，Drive 适配器与授权验收延期：

1. **Google Drive appDataFolder**：使用 Chrome Identity OAuth 和 `drive.appdata` scope。文件仅由 Orinui 应用访问，Drive 界面中隐藏。启用授权必须由设置页的清晰按钮发起；不得在扩展首次启动时弹授权。Drive 账号是用户自己的第三方账号，不是 Orinui 账号。用户在 Drive 侧删除应用数据后，云端同步副本可能被删除，本地数据与 JSON 备份不受影响。
2. **WebDAV**：供 NAS、Nextcloud 等自托管服务使用。只接受 HTTPS；用户输入服务器 URL 与账号/应用密码，不把凭据写入 URL。仅请求用户配置的精确源权限。凭据只存于当前 Chrome 配置文件的本地扩展存储，不进入 Dexie 同步快照或 JSON 备份。RFC 4918 不要求 WebDAV 服务器支持锁，因此协议不依赖 LOCK。

两个适配器实现相同的对象存取接口：列出设备快照、读取快照、写入本设备快照、读写媒体对象和删除不再引用的对象。每台设备只写自己的快照路径，设备间不争写同一份清单；同一配置文件内的同步任务串行执行。

Chrome `storage.sync` 的配额约为总计 100 KiB、单项 8 KiB，且无法承载本项目图片；同步正文统一放在外部提供方。[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 本地数据结构

现有 `groups`、`shortcuts`、`settings`、`assets` 保留。已有 Group、Shortcut 和 ImageAsset UUID 不整体重编号；图片 Blob 继续留在本机 Dexie。

已在 `src/storage/db.ts` 增加三张 Dexie 表；升级不自动启用同步：

- `sync_state`：vaultId、deviceId、时钟/代次、默认组、本机基线及运行/成功记录。WebDAV 凭据不复制到这张表；连接配置单独保存在 `chrome.storage.local`。OAuth token 及 Drive 配置尚未接入。
- WebDAV 的 `chrome.storage.local` 配置访问级别为 `TRUSTED_CONTEXTS`，包含 HTTPS URL、用户名和应用密码，并在当前配置文件保存 vault/device 身份。`storage` 是扩展权限；来源权限保持 optional，仅在用户操作时申请配置 URL 的精确 origin。凭据不进入 Dexie、JSON 备份、vault 描述或数据快照。
- `sync_records`：实体类型、实体 ID、字段路径、逻辑版本、修改设备，以及删除墓碑。同步元数据不混入用户可见领域字段。
- `sync_keys`：只保存非可导出的 Web Crypto `CryptoKey`，供本机后续加解密；恢复密钥正文不持久化。

字段级版本用于避免无关字段互相覆盖：例如一台设备改网站标题、另一台改网址时，两项修改都保留。每次本地变更使用 Lamport 逻辑时钟；接收远端时钟后，本机下次写入先递增到大于已观察值。相同字段并发修改时，先比较 logicalClock 数值，再按 deviceId 字典序确定胜者。删除墓碑对同 ID 的修改优先；永久删除的 UUID 不复用，用户重新添加会获得新 ID。本地删除先保留 5 秒待删除记录，到期才生成墓碑；窗口内撤销不传播永久删除，规则见 SYNC-PROTOCOL.md。

Settings 按设置分区/自定义引擎 ID 版本化。分组和快捷方式的位置仍使用现有整数 `order`；合并后按位置、版本、设备 ID 和实体 ID 稳定排序，再重新编号为连续整数。删除分组会同时为组内快捷方式写入墓碑。导入或跨设备合并出现多个默认分组时，保留同步库中默认组身份；本机已有的额外默认组转为普通分组并保留其名称和网站。

## 云端对象和合并

- 每台设备在 `devices/<deviceId>/snapshot.enc` 写一份完整的加密数据快照，含字段版本、墓碑和媒体引用。其它设备读取所有快照，合并后只写自己的快照。
- 图片单独存为 `assets/<assetId>.enc`。Asset UUID 是随机标识，不用图片哈希作为公开文件名。
- 先上传新增媒体，再发布引用它们的快照。失败必须显示错误；接收设备先解密并校验全部引用，再在一个 Dexie 事务中应用快照与图片。
- 远端图片只在所有已登记设备快照都不再引用它时清理。墓碑保留在快照中，防止长期离线设备重新连接后复活旧记录；同步库重置会显式清空整份远端数据。
- 首次连接已有同步库时合并而不是覆盖本地数据。空白初始化状态不产生重复默认组；本地有内容时保留其实体，并按上述冲突规则合并。

## 加密与密钥恢复

云端正文强制端到端加密，不提供明文同步模式。使用 Web Crypto AES-256-GCM 加密快照和媒体；每次加密使用新的随机 IV，并把格式版本和对象身份作为认证附加数据。云端提供方不会取得密钥。对象数量、大小、访问时间和同步频率仍可能被提供方观察到。

首次设置时生成 256-bit 随机恢复密钥，以 Base64url 展示一次；用户在启用同步前需要保存它。密钥导入设备后转成不可导出的 CryptoKey，保存在该设备 IndexedDB。新设备通过同一恢复密钥解锁。恢复密钥不放入云端、Chrome Sync、普通扩展设置或 JSON 备份。

恢复密钥遗失且所有已解锁设备都不可用时，云端内容无法恢复；现存设备上的本地数据与用户导出的 JSON 备份仍可用。恢复密钥遗失但仍有可解锁设备时，可从该设备重新生成恢复密钥并重新加密 vault。加密保护提供方一侧的数据，不防护已解锁设备、恶意扩展代码或本机恶意软件。

WebDAV 的 `vault.json` 外壳公开 schemaVersion、vaultId 和描述密文；描述明文只含 schemaVersion 与 vaultId，按 `kind=snapshot`、`objectId=vaultId` 加密。对象路径为 `vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 和 `vaults/<vaultId>/assets/<assetId>.enc`。WebDAV 密码或应用密码只保存在使用该提供方的本机 Chrome 配置文件中；它不随设备快照或 JSON 备份同步。连接 WebDAV 必须使用 HTTPS。

## 同步与失败行为

- Chrome Identity 的交互式授权从解释用途的设置按钮发起，不在启动时弹窗。[Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- 同步仅在用户启用后访问外部服务。设置页提供手动同步；启用后扩展页打开、本机 generation 写入和撤销截止时间的单次 timeout 会触发异步同步，不等待其完成再渲染主页。无定时轮询或自动重试；页面关闭可能中断运行，下次扩展页打开或用户手动操作恢复。
- 网络中断、授权取消、权限拒绝、校验/解密错误或提供方失败时，保留本机已有数据和未同步编辑，明确显示失败或待同步。远端数据未通过完整校验时不得部分应用；不得跳过媒体、覆盖较新快照或伪报成功。
- 远端格式包含独立 schemaVersion。未知未来版本拒绝应用并说明原因；不降级或静默重写。

## 基础协议与剩余实施

字段版本、耦合寄存器、严格格式、墓碑/撤销、首次合并、来源 URL 和本地导入/重置规则已经落实，详见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)。

公共对象接口、提供方条件发布契约、同配置文件串行、显式发布状态及下一次手动恢复已实现。WebDAV 默认使用强 ETag 条件发布；坚果云模板使用单独的 SHA-256 读回兼容模式，其非原子并发边界会在确认界面说明。预览只展示本地/远端数量，不冻结合并候选；用户确认时重新读取远端并重新计算计划。连接确认取得本机锁后再次校验 vault/device 身份，等待期间身份变化会丢弃旧准备数据和界面计划。所有 HTTP 重定向一律拒绝，避免把 Basic 认证转发到其他 origin。设备集合、远端媒体回收与密钥轮换尚待细化协议及 MVP 边界，之后再安排实现；Drive 授权/适配器延期。下一阶段计划见 TASKS.md。

## 验收状态

- 已有基础层自动检查覆盖：不同字段并发修改、同字段决胜、删除/撤销、跨组移动、排序、首次合并与事务回滚。
- 已有加密检查覆盖恢复密钥导入、不可导出密钥持久化、错误密钥、密文/对象身份篡改、未知版本及媒体校验；完整密钥轮换尚未实现。
- WebDAV 已在受控本机 HTTPS 服务的真实扩展双配置文件中验证新建库、恢复密钥确认/导入、首次合并、图片还原、修改发布、手动接收、503 失败恢复及断开保留本地数据；该 fixture 不代表第三方服务兼容。
- 待真实服务和设备：第三方 HTTPS WebDAV 兼容性、该服务来源上的权限与同步流程、真实用户服务器双配置文件还原及真实设备并发/离线/删除。现有功能扩展权限的用户确认不代表该服务已验收；普通网页预览也不替代这些检查。Google OAuth/appDataFolder 及其验收延期。

### 依据

- [Chrome Storage API 配额](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [WebDAV RFC 4918：锁支持可选](https://datatracker.ietf.org/doc/html/rfc4918)
- [Web Crypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
