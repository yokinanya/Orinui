# 跨设备同步设计

决策日期：2026-10-11；进度更新于 2026-10-18。Beta 2 新增本地壁纸素材库、完整素材同步、S3/R2 提供方、容量预览和操作反馈；本轮一层文件夹模型与新界面实施、验证中，未验收。既有 WebDAV 实现与真实服务验收保留；Beta 2 全素材组合、Cloudflare R2 真实服务及真实用户设备验证待完成。Google Drive 适配器与 OAuth 继续延期。

当前 Dexie schema 为 11、ZIP formatVersion 为 8、同步快照 schema 为 10。仅接受当前文件夹格式；旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不自动转换或清理本机数据、同步身份、密钥及远端库。用户可主动卸载重装旧分组版本，这不是自动清库授权。静态图片和动态媒体原件逐文件端到端加密；poster 仅为本机可重建缓存。WebDAV 与 S3 凭据分开保存在当前配置文件的 `chrome.storage.local`。基础协议见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)，协调流程见 [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md)，提供方说明见 [SYNC-WEBDAV.md](./SYNC-WEBDAV.md) 和 [SYNC-S3.md](./SYNC-S3.md)。

## 目标与范围

- 跨设备同步文件夹、网站、设置、壁纸素材库中的全部静态照片、动态媒体和网站图标。动态媒体只由用户本地上传。
- Dexie 仍是各设备的本地工作数据源；新标签页先读本地数据，网络同步异步运行，不阻塞页面渲染。
- 同步是可选功能。用户明确启用并配置提供方后，扩展在本地修改后及扩展打开时同步；同时提供手动同步入口。不启用定时轮询。
- 不创建 Orinui 账号或自营同步后端。用户使用自己的 WebDAV 或 S3 账号和存储桶；Google Drive 按用户决定延期。
- 不使用 Chrome `storage.sync` 保存正文或通知标记。图片和数据都由所选外部提供方承载。
- 一个同步库一次选择一个提供方；不双写。更换提供方需要用户断开后主动连接新位置，不自动搬迁或删除旧库。Cloudflare R2 为首个 S3 真实验收目标；其他 S3-compatible 服务仅在实际验证后声明兼容。

## 提供方决策

当前提供方及阶段取舍：

1. **WebDAV**：供 NAS、Nextcloud 等服务使用。只接受 HTTPS；用户输入服务器 URL 与账号/应用密码，不把凭据写入 URL。仅请求用户配置的精确来源权限。凭据只存于当前 Chrome 配置文件的受信扩展本地存储，不进入 Dexie 同步快照或 ZIP 备份。RFC 4918 不要求服务器支持 LOCK，因此协议不依赖 LOCK。
2. **S3-compatible**：用户提供 endpoint、预先存在的 bucket、专用 prefix、region 和访问密钥。Cloudflare R2 使用官方 endpoint 与 `region=auto`；允许自定义 HTTPS endpoint，但首版兼容声明仅覆盖实际通过验收的 Cloudflare R2。权限按用户配置的 endpoint 精确申请。凭据只存本机，不进入 ZIP、日志或加密同步正文；不自动修改 bucket CORS/权限。
3. **Google Drive appDataFolder**：适配器与 OAuth 延期，不阻塞当前 Beta。

提供方实现相同的对象存取接口：列出、读取设备快照，按 revision 条件发布本设备快照，读写媒体对象并报告元数据与传输进度。每台设备只写自己的快照路径，设备间不争写同一份清单；同一配置文件内的同步任务串行执行。远端媒体 GC 与完整密钥轮换仍未实施。

Chrome `storage.sync` 的配额约为总计 100 KiB、单项 8 KiB，且无法承载本项目图片；同步正文统一放在外部提供方。[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 本地数据结构

领域表为 `folders`、`shortcuts`、`settings`、`assets`；网站 `folderId: null` 表示主页，文件夹仅一层。当前格式实体 ID 保持稳定，旧分组数据明确拒绝，不靠清表、重编号或重置同步身份完成升级；静态图片和动态媒体原始 Blob 保存在本机 Dexie，动态 poster 只作为可重建缓存。

已在 `src/storage/db.ts` 增加三张 Dexie 表；升级不自动启用同步：

- `sync_state`：vaultId、deviceId、时钟/代次、本机基线及运行/成功记录。WebDAV 凭据不复制到这张表；连接配置单独保存在 `chrome.storage.local`。OAuth token 及 Drive 配置尚未接入。
- WebDAV 的 `chrome.storage.local` 配置访问级别为 `TRUSTED_CONTEXTS`，包含 HTTPS URL、用户名和应用密码，并在当前配置文件保存 vault/device 身份。`storage` 是扩展权限；来源权限保持 optional，仅在用户操作时申请配置 URL 的精确 origin。凭据不进入 Dexie、ZIP 备份、vault 描述或数据快照。
- `sync_records`：实体类型、实体 ID、字段路径、逻辑版本、修改设备，以及删除墓碑。同步元数据不混入用户可见领域字段。
- `sync_keys`：只保存非可导出的 Web Crypto `CryptoKey`，供本机后续加解密；恢复密钥正文不持久化。

字段级版本用于避免无关字段互相覆盖：例如一台设备改网站标题、另一台改网址时，两项修改都保留。每次本地变更使用 Lamport 逻辑时钟；接收远端时钟后，本机下次写入先递增到大于已观察值。相同字段并发修改时，先比较 logicalClock 数值，再按 deviceId 字典序确定胜者。删除墓碑对同 ID 的修改优先；永久删除的 UUID 不复用，用户重新添加会获得新 ID。本地删除先保留 5 秒待删除记录，到期才生成墓碑；窗口内撤销不传播永久删除，规则见 SYNC-PROTOCOL.md。

Settings 按设置分区/自定义引擎 ID 版本化。文件夹位置与网站 placement 分别版本化，网站 placement 为 `folderId` 与 `order` 原子字段。删除文件夹只永久删除文件夹实体，网站保留；仍指向已删文件夹的网站在物化时派生到主页，不修改 placement 值、时钟或设备标识。主页网站与文件夹在同一网格平铺，文件夹在前、主页网站在后，两类分别排序，不支持跨类型任意排序；各序列合并顺序确定后本机显示连续 order，不伪造同步编辑。

## 云端对象和合并

- 每台设备在 `devices/<deviceId>/snapshot.enc` 写一份完整的加密数据快照，含字段版本、墓碑和媒体引用。其它设备读取所有快照，合并后只写自己的快照。
- 静态图片和动态媒体原件分别存为 `assets/<assetId>.enc`。Asset UUID 是随机标识，不用图片或视频哈希作为公开文件名。
- 先上传新增媒体原件，再发布引用它们的快照。失败必须显示错误；接收设备先解密并校验全部引用，再在一个 Dexie 事务中应用快照与媒体；动态 poster 在本地重建。
- 远端媒体只在所有已登记设备快照都不再引用它时清理。动态 poster 不上传，不参与远端引用清理。墓碑永久保留在快照中，不按设备离线时间或 TTL 回收，防止旧记录复活；整个远端库只有经用户明确二次确认的删除操作才可移除。
- 首次连接已有同步库时合并而不是覆盖本地数据。空白初始化不预置文件夹、网站或默认组；本地有内容时保留其实体，并按上述冲突规则合并。

## 加密与密钥恢复

云端正文强制端到端加密，不提供明文同步模式。使用 Web Crypto AES-256-GCM 加密快照和媒体原件；MP4、WebM、GIF、动画 WebP 与静态图片都逐文件加密，每次加密使用新的随机 IV，并把格式版本和对象身份作为认证附加数据。poster 只在本机缓存，接收端从已验证原件重建后不上传。云端提供方不会取得密钥。对象数量、大小、访问时间和同步频率仍可能被提供方观察到。

首次设置时生成 256-bit 随机恢复密钥，以 Base64url 展示一次；用户在启用同步前需要保存它。密钥导入设备后转成不可导出的 CryptoKey，保存在该设备 IndexedDB。新设备通过同一恢复密钥解锁。恢复密钥不放入云端、Chrome Sync、普通扩展设置或 ZIP 备份。

恢复密钥遗失且所有已解锁设备都不可用时，云端内容无法恢复；现存设备上的本地数据与用户导出的 ZIP 备份仍可用。ZIP 默认不加密且不包含恢复密钥。恢复密钥遗失但仍有可解锁设备时，可从该设备重新生成恢复密钥并重新加密 vault。加密保护提供方一侧的数据，不防护已解锁设备、恶意扩展代码或本机恶意软件。

WebDAV 的 `vault.json` 外壳公开 schemaVersion、vaultId 和描述密文；描述明文只含 schemaVersion 与 vaultId，按 `kind=snapshot`、`objectId=vaultId` 加密。设备快照使用 schema 10；旧 schema 1–9 明确拒绝，不迁移分组数据或触发数据/身份删除。对象路径为 `vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 和 `vaults/<vaultId>/assets/<assetId>.enc`。WebDAV 密码或应用密码只保存在使用该提供方的本机 Chrome 配置文件中；它不随设备快照或 ZIP 备份同步。连接 WebDAV 必须使用 HTTPS。

## 同步与失败行为

- Chrome Identity 的交互式授权从解释用途的设置按钮发起，不在启动时弹窗。[Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- 同步仅在用户启用后访问外部服务。设置页提供手动同步；启用后扩展页打开、本机 generation 写入和撤销截止时间的单次 timeout 会触发异步同步，不等待其完成再渲染主页。无定时轮询或自动重试；页面关闭可能中断运行，下次扩展页打开或用户手动操作恢复。
- 网络中断、授权取消、权限拒绝、校验/解密错误或提供方失败时，保留本机已有数据和未同步编辑，明确显示失败或待同步。远端数据未通过完整校验时不得部分应用；不得跳过媒体、覆盖较新快照或伪报成功。
- 远端格式包含独立 schemaVersion。未知未来版本拒绝应用并说明原因；不降级或静默重写。

## 基础协议与剩余验收

字段版本、耦合寄存器、逐文件加密和首次合并基础层已实施；本轮 schema 10 文件夹、永久墓碑及旧分组拒绝规则正在实施/验证，不据此宣称验收通过。当前 Dexie schema 为 11、ZIP formatVersion 为 8、同步快照 schema 为 10。仅接受当前文件夹格式；旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不自动转换或清理本机数据、同步身份、密钥及远端库。用户可主动卸载重装旧分组版本，这不是自动清库授权。详见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)。

公共对象接口、提供方条件发布契约、同配置文件串行、显式发布状态及下一次手动恢复已实现。WebDAV 默认使用强 ETag 条件发布；坚果云模板使用单独的 SHA-256 读回兼容模式，其非原子并发边界会在确认界面说明。预览只展示本地/远端数量，不冻结合并候选；用户确认时重新读取远端并重新计算计划。连接确认取得本机锁后再次校验 vault/device 身份，等待期间身份变化会丢弃旧准备数据和界面计划。所有 HTTP 重定向一律拒绝，避免把 Basic 认证转发到其他 origin。设备集合、远端媒体回收与密钥轮换尚待细化协议及 MVP 边界，之后再安排实现；Drive 授权/适配器延期。下一阶段计划见 TASKS.md。

## 验收状态

- 已有基础层自动检查覆盖：不同字段并发修改、同字段决胜、删除/撤销、跨容器移动（历史分组覆盖不替代本轮文件夹回归）、排序、首次合并与事务回滚。
- 已有加密检查覆盖恢复密钥导入、不可导出密钥持久化、错误密钥、密文/对象身份篡改、未知版本及媒体校验；完整密钥轮换尚未实现。
- WebDAV 已在受控本机 HTTPS 服务的真实扩展双配置文件中验证新建库、恢复密钥确认/导入、首次合并、图片还原、修改发布、手动接收、503 失败恢复及断开保留本地数据；该 fixture 不代表第三方服务兼容。
- 用户已确认真实 WebDAV 服务验收完成；新增动态媒体同步组合及真实用户设备并发/离线/删除场景仍按各自验证记录跟踪。普通网页预览不能代替扩展环境检查。Google OAuth/appDataFolder 及其验收延期。

### 依据

- [Chrome Storage API 配额](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [WebDAV RFC 4918：锁支持可选](https://datatracker.ietf.org/doc/html/rfc4918)
- [Web Crypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
