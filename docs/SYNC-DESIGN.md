# 跨设备同步设计

2026-10-25 更新：同步范围增加双列主页格位、多实例纯文本便签与待办。当前 Dexie 14 / ZIP 11 / sync 13，保留 Dexie 11–13、ZIP 8–10 和同步 10–12 的显式升级；旧分组拒绝不变。小组件和格位使用既有加密快照，不另建服务。便签原子文本、待办独立字段、删除和位置收敛见 本文。主页不再限于文件夹在前的网站排序显示，格位允许跨类型放置和留空；order 继续服务迁移与文件夹内部排序。真实 WebDAV/R2 新小组件验收独立待完成。

决策日期：2026-10-11；进度更新于 2026-10-25。Beta 2 已实现本地壁纸素材库、完整素材同步、S3/R2 提供方、容量预览、文件夹及 Niagara 小组件；源码未发布。既有 WebDAV 真实服务验收保留；新小组件与全库媒体在真实 WebDAV 服务上的组合、Cloudflare R2 真实服务及本轮真实用户设备验证待完成。自动检查和受控 fixture 不替代这些验收。Google Drive 适配器与 OAuth 继续延期。

当前 Dexie schema 为 14、ZIP formatVersion 为 11、同步快照 schema 为 13；显式升级 Dexie 11–13、ZIP 8–10、同步 10–12，保留领域数据、逻辑版本、身份和密钥。仅接受当前文件夹格式；旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不自动转换或清理本机数据、同步身份、密钥及远端库。用户可主动卸载重装旧分组版本，这不是自动清库授权。静态图片和动态媒体原件逐文件端到端加密；poster 仅为本机可重建缓存。WebDAV 与 S3 凭据分开保存在当前配置文件的 `chrome.storage.local`。协议、协调流程及提供方要求分别见下文章节。

## 目标与范围

- 跨设备同步文件夹、网站、设置（含双列格位、纯文本便签和待办）、壁纸素材库中的全部静态照片、动态媒体和网站图标。动态媒体只由用户本地上传。
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

字段级版本用于避免无关字段互相覆盖：例如一台设备改网站标题、另一台改网址时，两项修改都保留。每次本地变更使用 Lamport 逻辑时钟；接收远端时钟后，本机下次写入先递增到大于已观察值。相同字段并发修改时，先比较 logicalClock 数值，再按 deviceId 字典序确定胜者。删除墓碑对同 ID 的修改优先；永久删除的 UUID 不复用，用户重新添加会获得新 ID。本地删除先保留 5 秒待删除记录，到期才生成墓碑；窗口内撤销不传播永久删除，规则见 SYNC-DESIGN.md。

Settings 按设置分区/自定义引擎 ID 版本化。文件夹位置与网站 placement 分别版本化，网站 placement 为 `folderId` 与 `order` 原子字段。删除文件夹只永久删除文件夹实体，网站保留；仍指向已删文件夹的网站在物化时派生到主页，不修改 placement 值、时钟或设备标识。主页网站、文件夹与小组件由 settings.home 格位跨类型放置并允许空洞；order 保留给实体序列、旧格式迁移及文件夹内部排序，不再决定主页几何。位置冲突按稳定规则同列下推，并为实际修复写入新逻辑版本；不压缩无冲突空洞或另一列。便签原子文本、待办文本/完成/顺序按字段版本化；详见下文协议与数据格式章节。

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

WebDAV 的 `vault.json` 外壳公开 schemaVersion、vaultId 和描述密文；描述明文只含 schemaVersion 与 vaultId，按 `kind=snapshot`、`objectId=vaultId` 加密。新设备快照使用 schema 12；schema 10/11 经严格验证后显式升级，旧 schema 1–9 明确拒绝，不迁移分组数据或触发数据/身份删除。对象路径为 `vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 和 `vaults/<vaultId>/assets/<assetId>.enc`。WebDAV 密码或应用密码只保存在使用该提供方的本机 Chrome 配置文件中；它不随设备快照或 ZIP 备份同步。连接 WebDAV 必须使用 HTTPS。

## 同步与失败行为

- Chrome Identity 的交互式授权从解释用途的设置按钮发起，不在启动时弹窗。[Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- 同步仅在用户启用后访问外部服务。设置页提供手动同步；启用后扩展页打开、本机 generation 写入和撤销截止时间的单次 timeout 会触发异步同步，不等待其完成再渲染主页。无定时轮询或自动重试；页面关闭可能中断运行，下次扩展页打开或用户手动操作恢复。
- 网络中断、授权取消、权限拒绝、校验/解密错误或提供方失败时，保留本机已有数据和未同步编辑，明确显示失败或待同步。远端数据未通过完整校验时不得部分应用；不得跳过媒体、覆盖较新快照或伪报成功。
- 远端格式包含独立 schemaVersion。未知未来版本拒绝应用并说明原因；不降级或静默重写。

## 基础协议与剩余验收

字段版本、耦合寄存器、逐文件加密、文件夹和永久墓碑规则已实现。当前 Dexie schema 为 14、ZIP formatVersion 为 11、同步快照 schema 为 13；显式升级 Dexie 11–13、ZIP 8–10 和同步 10–12，保留领域数据、逻辑版本、身份和密钥。仅接受当前文件夹格式；旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不自动转换或清理本机数据、同步身份、密钥及远端库。用户可主动卸载重装旧分组版本，这不是自动清库授权。详见 本文。

公共对象接口、提供方条件发布契约、同配置文件串行、显式发布状态及下一次手动恢复已实现。WebDAV 默认使用强 ETag 条件发布；坚果云模板使用单独的 SHA-256 读回兼容模式，其非原子并发边界会在确认界面说明。预览只展示本地/远端数量，不冻结合并候选；用户确认时重新读取远端并重新计算计划。连接确认取得本机锁后再次校验 vault/device 身份，等待期间身份变化会丢弃旧准备数据和界面计划。所有 HTTP 重定向一律拒绝，避免把 Basic 认证转发到其他 origin。设备集合、远端媒体回收与密钥轮换尚待细化协议及 MVP 边界，之后再安排实现；Drive 授权/适配器延期。下一阶段计划见 TASKS.md。

## 验收状态

- 已有基础层自动检查覆盖：不同字段并发修改、同字段决胜、删除/撤销、跨容器移动（历史分组覆盖不替代本轮文件夹回归）、排序、首次合并与事务回滚。
- 已有加密检查覆盖恢复密钥导入、不可导出密钥持久化、错误密钥、密文/对象身份篡改、未知版本及媒体校验；完整密钥轮换尚未实现。
- WebDAV 已在受控本机 HTTPS 服务的真实扩展双配置文件中验证新建库、恢复密钥确认/导入、首次合并、图片还原、修改发布、手动接收、503 失败恢复及断开保留本地数据；该 fixture 不代表第三方服务兼容。
- 用户已确认既有真实 WebDAV 服务验收完成；新小组件与全库媒体的真实 WebDAV 组合、真实 R2 及本轮真实用户设备并发/离线/删除场景仍按各自验证记录跟踪。普通网页预览不能代替扩展环境检查。Google OAuth/appDataFolder 及其验收延期。

### 依据

- [Chrome Storage API 配额](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [WebDAV RFC 4918：锁支持可选](https://datatracker.ietf.org/doc/html/rfc4918)
- [Web Crypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)

## 协议与数据格式

### 主页格位与小组件（2026-10-25）

当前 Dexie 14 / ZIP 11 / sync 13；同步 10–12 经显式升级后接收。旧布局转换为统一默认组合，按原文件夹/网站排序生成初始双列位置；身份、密钥、已有逻辑版本保留，不清空远端。

`settings.home` 是字段路径到 `{value,clock,deviceId}` 的映射，字段路径用 JSON 字符串数组避免分隔符歧义：`[placement,id]` 保存列/行/高度原子值；`[widget,id,kind|text]`；`[todo,widgetId,itemId,text|completed|order]`。便签文本是原子字段，不是协同编辑。删除用 null 寄存器永久保留，组件 kind 与待办 text 的删除优先于同 ID 编辑；重建必须用新 ID。各待办字段独立合并，避免勾选覆盖另一设备的文本修改。

位置冲突按起始行/列/稳定 ID 确定优先级，使用与本地相同的单列碰撞推移算法。修复位置使用本机 deviceId 和高于所有已观察逻辑时钟的新版本；重复合并不再次改写已无冲突的位置。另一列和不相交空洞不压缩。设置捕获与位置/正文原子提交，接收事务依然暂停捕获防回声。ZIP 完整替换会重映射小组件 ID 和对应格位，不复活当前同步库已知的实体身份。

正文与格位通过注入的现有协调器进入 WebDAV/S3 同一加密快照通道；不增加明文对象、第三方服务或运行时内存提供方。受控双数据库测试不代表真实跨设备 WebDAV/R2 验收。

状态：当前 schema 13 使用一层文件夹、网站 placement 与 home 字段寄存器；独立 `searchCustomization` 包含工具开关、关键词和内置引擎覆盖。历史升级中，schema 11 为引擎覆盖补空值并保留原寄存器时钟，schema 10 先补零时钟的搜索寄存器；schema 10–12 再显式生成 home 并规范化旧布局组合。旧分组格式拒绝且不清库。完整背景素材库逐文件加密，poster 在本地重建。源码未发布；既有真实 WebDAV 验收不外推至新小组件与全库媒体组合，真实 R2 尚未验收。具体范围见 [VERIFICATION.md](./VERIFICATION.md)，实现、fixture 和构建均不等同于真实服务验收。

### 版本与身份

当前 Dexie schema 为 14、ZIP formatVersion 为 11、同步快照 schema 为 13；显式升级 Dexie 11–13、ZIP 8–10 和同步 10–12，搜索升级见 [SEARCH-DESIGN.md](./SEARCH-DESIGN.md)，主页规则见 [DATA-CONTRACT.md](./DATA-CONTRACT.md)。旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不清理本机数据、同步身份、密钥或远端库。加密 envelope 魔数仍为 ORINUI01，AAD 的固定 `schemaVersion` 仍为 1；这些版本各自独立。旧客户端不支持 schema 13。

vaultId 标识一个同步库，deviceId 标识一个 Chrome 配置文件。实体标识沿用已有稳定 ID，新实体使用 UUID。协议接受既有非空字符串标识，但拒绝首尾空白和控制字符；不能用永久删除的标识重新创建实体。

每个冲突字段是 `{ value, clock, deviceId }`。clock 为非负安全整数，先按数值比较，再按 deviceId 字典序比较；同一个 clock/deviceId 对应不同内容视为损坏/冲突，不依赖输入顺序选值。

generation 是每设备快照代次，不跨设备比较。实际本地变更和合并内容变化才递增，重复导出不递增。观察到的最大逻辑时钟用于下一次本机写入，计数器不能溢出安全整数。

### 原子字段与资源

| 实体 | 寄存器/不可分割更新单元 |
|---|---|
| 文件夹 | name、position 各自独立；不含父文件夹引用 |
| 网站 | title、url 独立；folderId（null 表示主页）与 order 合为 placement；icon 引用为一个寄存器 |
| 设置 | appearance、layout、clock、searchPreferences、searchCustomization、shortcutPreferences 各为一个单元；defaultEngineId 独立；自定义引擎按 ID 保存；home 按位置、组件类型/文本、待办字段拆分寄存器（见上文） |
| 媒体 | id、kind、MIME、尺寸、byteLength、SHA-256、动态类型与时长不可变；sourceUrl 单独版本化。所有背景素材均在库中同步，图标仍需网站引用且为静态图片 |

资源来源 URL 随完整快照加密同步，包括已保存的查询参数；它也随 ZIP manifest 导出。动态媒体仅本地上传，因此 sourceUrl 必须为空。清除静态图片来源会同步清空资源及相关网站的来源字段，保留媒体 Blob 和引用。凭据、恢复密钥和 CryptoKey 不进入快照或 ZIP。

静态照片与图标保留既有图片校验规则。动态背景接受本地 MP4、WebM、GIF 和动画 WebP；快照记录原始字节长度、摘要、媒体类型和视频时长。上传、备份恢复和同步接收都校验媒体签名与浏览器解码能力，不自动转码。媒体原件逐文件 AES-256-GCM 加密并同步；从首帧生成的 PNG poster 只是本地缓存，不进入快照或远端对象，在同步接收时由通过校验的原件重建。

排序合并后按位置、字段版本、设备 ID 和实体 ID 确定顺序，本机物化为连续 order。重编号不伪造用户修改；随后只改名称/标题时，未改动的位置寄存器仍保留原版本。

### 本地捕获与删除

数据库版本 2 → 3 新增 sync_state、sync_records、sync_keys，不自动启用同步，不改变用户 ID。版本 4 → 5 为设置增加个性化字段与同步寄存器；旧字段的逻辑版本保留，新寄存器初始化为零。initializeSyncVault 建立状态和密钥后，全量 seed 已有实体。

DBCore 中间件只在本机已配置同步状态时捕获业务写入，并把版本记录与领域写入放在同一事务。布局和时钟各自原子捕获；搜索偏好及网站偏好使用独立寄存器。事务回滚也回滚元数据；接收远端时 suspended 标记在同一事务中暂停本机捕获，避免回声更新。

网站删除立即从本机可见列表移除，撤销仍限当前页面会话 5 秒。同步记录先保留活版本及 pendingDeleteUntil；期限内导出仍保留该网站及必要图片，撤销清掉待删除状态。到期再生成永久墓碑，不复活同 ID。

pending 图片已从当前 assets 回收时，仅在本地同步记录中暂存撤销所需 Blob；共享图片只保留一份。finalizePendingDeletes 在导出前推进到期删除并释放缓存。WebDAV 事件调度在最近一个撤销期限到达时使用单次 timer 触发；扩展页关闭可能中断，下一次扩展页打开或手动同步恢复，不使用周期轮询或自动重试。

文件夹删除产生永久文件夹墓碑，不级联产生网站墓碑。本地显式删除文件夹时事务化把网站移回主页；合并时，未被自身墓碑删除且仍指向已删文件夹的网站派生显示在主页，不改写 placement 寄存器、clock 或 deviceId。后续并发移入存活文件夹可按原寄存器正常决胜，不能被物化产生的伪编辑覆盖。所有实体删除墓碑永久保留，不因快照压缩、时间或设备离线而移除。

自定义引擎删除使用独立墓碑。若并发搜索配置仍引用被删除引擎的关键词，合并裁剪该关键词，并使用本机 deviceId 与高于所有已观察时钟的新 register clock；不能修改值却沿用旧逻辑版本。网站图标 prune 只清理本地无引用 Blob，不为图标制造永久墓碑；壁纸素材显式删除会产生 asset tombstone，并从所有设备素材库移除，远端对象 GC 仍延期。

### 首次连接与本地替换

planSyncJoin 是无写入的首次合并计划。新设备使用独立 deviceId 和相同 vaultId：

- 精确的初始空状态（默认设置、无文件夹/网站/小组件/格位/图片/墓碑）使用远端基线，不创建默认组或示例实体。
- 有本机数据时保留其实体，文件夹与主页网站按同一当前格式合并，不合成默认文件夹。
- 首次合并时，本机已有字段被视为一次新设备提交，其版本高于已观察远端版本；同 ID 的图片内容冲突仍拒绝，不丢弃本机数据。

ZIP 导入是用户确认的完整替换。已被该库登记过的导入 ID 会换成新 ID，并一起更新文件夹、网站、媒体和引擎及关键词引用；内置引擎覆盖使用稳定预置 ID，不参与重映射。被替换实体通过墓碑传播，避免旧删除身份复活。没有配置同步时，备份 ID 继续原样恢复。当前显式验证并升级 ZIP 9 和文件夹 ZIP 8；旧分组 ZIP、Beta 1 ZIP 和开发期 JSON 继续拒绝。

本地重置仍恢复空默认数据；已配置同步时，其删除进入版本记录，不生成默认组。断开本机同步只清理本机同步状态/密钥，不删除本地网站或任何外部文件。

### 接收与冲突

接收先严格校验字段、schema 13（10–12 经显式升级；旧分组格式不迁移）、域内规则及全部引用，再验证每项媒体的 MIME、长度、SHA-256、静态图片规则或动态媒体签名和实际浏览器解码。poster 在验证通过后重建。校验在事务外完成，不静默重新编码/降质；失败时不修改本机数据。

最终事务检查 vaultId、deviceId 与 expectedGeneration。准备期间本机发生新修改会明确失败并保留本机数据；不能直接应用未合并的其他设备快照。

应用一次性替换领域数据和同步记录，保留本机密钥。尚在撤销期的网站保持本地隐藏和缓存；远端最终墓碑会取消待撤销状态。本机已有墓碑不能从接收结果中丢失。

引用与永久删除发生冲突时抛出 SyncMergeConflictError，携带 code 和 entityId：

- custom-engine-deleted-while-default：被选中的自定义引擎同时被删除。
- asset-deleted-while-referenced：仍被网站/背景引用的媒体被永久删除。

本地数据不因此部分应用。提供方界面需说明冲突并让用户重新选择/处理，不自动切换引擎或背景；已删文件夹的网站按上述明确规则派生回主页。

### 加密字节格式

恢复密钥是 32 字节随机值，以规范 Base64url 编码为 43 字符且无 padding。新生成密钥会重新取随机值，直到首字符为 ASCII 字母或数字；导入仍接受全部规范 Base64url 编码，以兼容既有密钥。导入后为不可导出的 AES-256-GCM CryptoKey；密钥只留本机 IndexedDB，不写到云端、普通配置或 ZIP 备份。

加密对象为：

```text
8 字节 UTF-8 魔数 ORINUI01 | 12 字节随机 IV | 密文及 16 字节认证 tag
```

AAD 是按固定字段顺序 JSON 编码的 `{ schemaVersion: 1, vaultId, kind, objectId }`；kind 为 snapshot 或 asset。每次加密产生新随机 IV。快照正文是 UTF-8 JSON；媒体正文是已保存的原始静态图片或动态媒体字节。

快照 objectId 是 deviceId，媒体 objectId 是 assetId。解密后的快照身份必须与 AAD 相同；媒体必须匹配已验证快照中的长度和 SHA-256。错误密钥、身份置换、篡改、未知格式和无效 UTF-8/JSON 都明确失败。

恢复密钥和全部已解锁设备同时遗失时无法恢复加密副本；仍有本地数据时可用 ZIP 备份恢复。ZIP 本身默认不加密，且不包含恢复密钥或 poster。跨设备密钥轮换尚需提供方原子发布和旧设备处理协议，本批没有宣称已经支持。

### 已实现 API 与边界

- storage/sync：initialize/disconnect、seed、捕获、finalize、export、seal、first join plan、apply。
- domain/sync：严格快照解析、字段合并、确定性物化、时钟与可识别引用冲突。
- platform/sync-crypto、sync-codec、media：注入的原生 Web Crypto、字节格式、静态图片/动态媒体验证和 poster 重建。
- sync：公共对象端口、分阶段 syncNow、运行身份/失败与发布确认状态；本地适配器保存一次性基线，原生锁保证同源同 scope 串行。顺序与对象契约见 本文。
- 自动检查使用独立内存 IndexedDB 模拟设备，真实 Web Crypto 进行密钥和密文验证；不模拟提供方上传成功。

手动协调先完整校验并事务提交本机候选，再逐项上传媒体原件、按提供方一致性策略发布快照；强 ETag 服务使用原子条件发布，坚果云使用 SHA-256 写前比较和写后回读。动态 poster 在接收端本地重建。发布失败保留已完整接收的结果与未同步新编辑，不跨本机和远端伪造回滚。运行记录与基线标记不进入快照或 ZIP 备份。此适配器策略不改变本文件定义的快照/加密 schema。

尚需验收：新小组件与全库媒体在真实 WebDAV 服务上的组合、真实 R2 及本轮真实用户设备场景。既有真实 WebDAV 服务验收由用户确认完成，不外推至上述新增范围。设备集合/远端清理、完整密钥轮换的协议与 MVP 边界仍待实施。Google Drive 适配器及 OAuth 延期，不作为当前阶段阻塞项。受控服务审计范围见 本文，进度见 [TASKS.md](./TASKS.md)。

依据：[Dexie middleware](https://dexie.org/docs/Dexie/Dexie.use%28%29)、[Web Crypto importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)、[AES-GCM 参数](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)。


## 协调器与对象端口

2026-10-25：当前快照升级为 schema 13，主页格位、便签和待办通过既有 settings 捕获/导出/应用进入同一端到端加密链路。协调器继续显式注入 WebDAV/S3 提供方；首次加入提升本机 home 字段逻辑版本，位置冲突修复产生真实新版本。当前只证明受控本地双数据库交换；新小组件真实多设备 WebDAV/R2 尚未验收，既有服务验收不能外推。版本与字段细节见 本文。

协调层初始实施与验证日期：2026-10-13；当前范围更新于 2026-10-25，源码未发布。公共对象接口、手动协调器、本机运行状态和集成检查已实现。WebDAV/S3 适配器、连接界面与启用后的事件触发已接入；未启用同步时应用不会连接外部服务。既有 WebDAV 真实服务验收保留，新小组件与全库媒体组合须独立验收，真实 R2 尚未验收。Drive 适配器尚未接入。

本层沿用 本文 的 schema 13 快照、合并、媒体身份与加密格式。旧分组快照明确拒绝，不自动迁移、清理本地数据或同步身份，也不重建远端库。静态图片、壁纸库全部背景原件及网站图标都作为独立媒体对象逐文件端到端加密；poster 仅在接收设备本地重建，不上传。

### 模块与入口

- `src/sync`：对象端口、`createSyncCoordinator`、分阶段协调与可识别失败。存储、锁、加密、编解码、合并策略、时间和运行 ID 生成器全部通过参数注入，没有默认模拟提供方。
- `src/domain/sync/object-types.ts` 与 `object-validation.ts`：对象/回执边界校验，拒绝重复设备、非法身份/版本、缺失字节和无效回执；复制接收字节。
- `src/storage/sync/local-store.ts`：将协调端口绑定到已有导出/接收 API，使用短事务保存运行状态，数据库由参数注入。
- `src/platform/sync-lock.ts`：委托注入的原生 Web Locks。调用方为同一配置文件使用同源、同数据库 scope 的锁，缺少管理器时明确失败。
- `src/platform/webdav-*` 与 `src/sync/webdav-*`：HTTPS WebDAV 对象存取、连接流程及配置文件级触发调度。默认使用强 ETag 条件发布；坚果云兼容模式改用 SHA-256 revision、写前读取比较和写后回读校验。适配器依然由运行时显式注入协调器。

构造协调器不执行同步；显式调用 `syncNow()` 才调用对象端口。入口返回本轮结果或拒绝 Promise，不把传输失败转成成功。

### 对象契约

地址为 `{ vaultId, objectId }`；具体适配器负责库隔离和路径段编码，不直接把标识解释成路径。

| 方法 | 必须实现的语义 |
|---|---|
| listSnapshots | 每设备一个快照及不透明 revision，重复设备拒绝 |
| readSnapshot | 读取恰好观察到的 revision；变化明确失败 |
| readAsset | 返回实际加密对象，或明确的 null（不存在） |
| createAsset | 创建媒体并返回实际 created/revision；条件模式保证不覆盖，坚果云模式先读后写并回读核对 |
| publishSnapshot | 按 expectedRevision 检查并发布完整快照；强 ETag 模式为原子条件写，坚果云模式为 SHA-256 写前比较与写后核验，不具备原子比较写入 |

创建媒体后重新读取实际对象，核对回执版本、解密、长度和 SHA-256；创建竞争返回已有对象也需验证内容。坚果云兼容模式只能检测发布前已出现的冲突，并核对写入后的字节，不能阻止两份使用相同 deviceId 的配置并发覆盖；不同配置文件各自使用不同 deviceId，本机同配置文件继续由 Web Locks 串行化。此模式仅由坚果云模板显式选择，其他服务仍要求强 ETag 条件写入。

### 执行顺序与本机状态

1. 取得独占锁，生成新的唯一 runId，原子读取身份/密钥并记录开始。
2. 导出本机一致快照、推进到期删除，读取并校验全部远端快照。
3. 尚无本机基线且无自身远端快照时使用首次加入计划，否则正常合并；备齐并校验引用媒体。
4. 按 expectedGeneration、库/设备身份和 runId 原子提交完整本机候选，保存代次、观察时钟与基线标记。
5. 上传缺失媒体、验证写入结果，再按观察到的自身 revision 发布加密快照。提供方条件能力及本机选择的 WebDAV 一致性模式决定 revision 与发布保护方式。
6. 收到合法回执后记录成功时间/已发布代次。本机有更高代次时返回 pending，否则 synced。

接收先本机提交、后远端发布，使上传期间的新编辑取得更高代次和逻辑版本，避免与尚未提交的候选争用同一版本。网络、加解密、哈希和图像解码都在事务外，事务只检查当前状态并原子写入。[Dexie 事务说明](https://dexie.org/docs/Tutorial/Best-Practices)

当前 Dexie schema 为 14、ZIP formatVersion 为 11、同步快照 schema 为 13；显式升级 Dexie 11–13、ZIP 8–10 和同步 10–12，保留既有数据、寄存器、身份和密钥。仅接受当前文件夹格式；旧分组本地库、ZIP v1–7、同步 schema 1–9 与开发期 JSON 明确拒绝，不自动转换或清理本机数据、同步身份、密钥及远端库。用户可主动卸载重装旧分组版本，这不是自动清库授权。`sync_state` 保存本机基线、运行身份/阶段/发布状态/时间/错误及成功代次/revision，不进入快照或 ZIP 备份。

基线在完整接收事务中保存：首次接收后发布失败，再次运行不会重新提升已收到的字段、覆盖其他设备后续修改。空设备首次接收有变化时，代次也递增。旧 runId 在断开并用同一库/设备重连后，不能修改新连接状态。

### 结果与失败

`SyncRunResult` 返回已发布/本机代次、revision、上传/接收数量和 repairedAssetIds。后者显式报告远端缺媒体且本机有验证副本时的补传；存在但损坏的对象直接失败，不覆盖或绕过。

`SyncCoordinatorError` 保留 cause、phase、publication 与 statusRecorded：not-started 表示尚未发起快照发布；unconfirmed 表示未收到合法回执，不能推断远端未写入；confirmed 表示发布已确认，后续本机记录仍可能失败。

准备期间本机变更会拒绝旧候选并保留用户编辑。接收事务本身整体成功或回滚；随后网络失败保留完整合并结果并标失败/待同步，不能跨本机和远端伪造回滚。已发起请求可能产生远端副作用，断开不假称撤销远端写入。

回执丢失、条件冲突或上传中断后，下次手动同步重新读取并合并，没有后台重试/轮询。正确媒体复用，不重复创建；未被快照引用的上传对象暂时保留，GC 尚未实施。撤销窗口在准备期间到期时，旧候选明确失败，下次导出推进墓碑，不复活网站。永久墓碑不得在协调、发布或接收中丢失；已删文件夹的网站仅派生显示在主页，不改写位置寄存器。

### 验证与边界

- **历史协调层批次（2026-10-12）**：编译、34 文件/278 项单元测试、MV3 构建和 44 项网页回归通过。该记录对应当时的代码，不代表当前源码状态；后续批次结果见 [VERIFICATION.md](./VERIFICATION.md)。
- 集成检查使用真实领域规则、Dexie/fake-indexeddb、Web Crypto 与 PNG 字节。测试对象服务实际存取密文、执行创建条件/revision/CAS 和失败注入；只位于 tests，不证明真实 HTTP 或提供方授权。
- 覆盖首次加入/基线、并发字段、图片还原、媒体顺序/复用/修复、坏密文与缺失/冲突媒体、条件发布与回执丢失、部分上传恢复、编辑竞态、任务串行、同身份重连和撤销到期。
- 独立 Chromium 153.0.8010.12 的真实扩展审计副本验证原生锁：第一页持锁时第二页等待，第一页抛错后第二页取得锁。[Web Locks 同源协作](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- 原生锁审计编译实际适配器源码；脚本/结果在忽略的 `.output/sync-lock-audit.mjs` 与 `.output/sync-lock-audit-result.json`。生产产物及用户配置未改，临时配置已关闭并清理。

设备集合、远端媒体清理与密钥轮换仍待实施，Google Drive 适配器与 OAuth 延期。Beta 2 WebDAV 全素材与 R2 真实服务验收状态记录在 [TASKS.md](./TASKS.md)、[VERIFICATION.md](./VERIFICATION.md)、本文提供方章节。


## WebDAV 提供方

本文件保留 WebDAV 的提供方细节和历史审计记录。截至 2026-10-25，当前为 Dexie 14、ZIP formatVersion 11、快照 schema 13；显式升级 Dexie 11–13 / ZIP 8–10 / schema 10–12。Niagara 双列格位、纯文本便签与待办随既有端到端加密快照同步。旧分组格式明确拒绝，不自动迁移、清理本地数据/同步身份或删除远端库。源码未发布，历史服务结果不外推。当前规则见 本文、本文 与 [TASKS.md](./TASKS.md)。

状态：WebDAV 适配器、连接流程与事件触发已实现，并通过受控本机 HTTPS 服务的真实扩展审计。用户已确认既有真实 WebDAV 服务验收完成；新小组件与全库媒体的真实服务组合仍须独立验收，真实 R2 尚未验收。受控服务使用预授权来源和自签测试证书，不代替新增媒体组合及用户权限弹窗检查。总同步决策见 本文，对象端口顺序见 本文，密文格式见 本文。

2026-10-14 用户已另行确认当前 UI、既有功能扩展权限和屏幕吸管验收；用户于 2026-10-15 确认真实 WebDAV 服务验收完成，依据与范围见 [VERIFICATION.md](./VERIFICATION.md)。本轮新增动态媒体同步与真实用户设备仍需独立验证；Google Drive 适配器与 OAuth 验收延期。下方保留历史受控审计的原始范围。

### 范围

#### 删除远端同步库（2026-10-14）

- 已连接面板提供“删除远端同步库”；二次确认后删除当前 `vaults/<vaultId>/` collection（包括所有设备快照、静态图片、动态媒体原件和诊断对象），再删除 `vault.json`。不删除配置的根目录、`vaults/` 父目录或其他库目录。
- 使用当前连接的来源权限和凭据，取得与同步协调器相同的本机原生锁，重新核对本机连接、远端库身份和密钥。删除后确认目录与描述均不存在，才移除本机连接、密钥和同步元数据；本机网站、文件夹、小组件、设置和媒体保持不变。
- 留空恢复密钥检查连接、发现已有库时，提示后提供“忘记恢复密钥？”。二次确认允许用有效 WebDAV 凭据删除整个远端库，不要求恢复密钥，也不尝试解密或恢复数据。删除目标固定为本次检查的地址、凭据、库 ID 与加密描述；修改输入、取消或重新检查使旧目标失效，确认时远端身份或加密描述变化明确拒绝。成功后可重新检查连接创建新库与恢复密钥，不自动建库。
- 两个确认框均提示永久删除、影响所有设备、保留本机数据，并要求先停止其他设备同步。WebDAV 不提供跨设备删除事务；本机锁不能阻止其他设备写入。强 ETag 模式对描述使用条件 DELETE；坚果云沿用显式回读模式，不承诺原子删除。
- HTTP 错误、207 部分结果、回读仍存在或库被重新写入均明确失败，不吞错。描述最后删除，使目录清理失败后仍可重试；资源已返回 404 时视为已不存在。坚果云描述缺失仍只识别既有 `AncestorsNotFound` 标记。失败保留本机连接或未连接时的检查目标，不自动重试；用户可再次确认继续清理。远端多次请求无法整体回滚，失败可能已删除部分内容。
- 此处描述代码行为；第三方服务的 collection DELETE、删除后检查和真实扩展界面仍待验收。

- 用户选择一个 HTTPS WebDAV 目录承载一个同步库；应用只在用户启用后连接。
- 目录下的 `vault.json` 保存库 ID 和加密库描述（该 descriptor 自身的 schemaVersion 仍为 1）；`vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 保存每设备 schema 13 加密快照，`vaults/<vaultId>/assets/<assetId>.enc` 保存独立加密媒体。整个壁纸素材库和被引用网站图标原件都逐文件使用 AES-256-GCM envelope 加密；动态 poster 作为接收设备本地缓存重建，不上传。不开启明文模式。
- 当前仅显式升级文件夹快照 schema 10–12 至 13、ZIP v8–10 至 v11；旧分组 schema 1–9、ZIP v1–7 与开发期 JSON 均拒绝，不自动删除本机/远端内容。历史分组阶段曾有 schema 4/5/6/7 与 ZIP v2–5 的布局迁移，并补唯一分组名称偏好；该记录不表示当前仍接收这些格式。
- 账号名与应用密码只保存在当前 Chrome 配置文件的 `chrome.storage.local`。不得写入 URL、Dexie 同步表、快照、日志、ZIP 备份或任何其他设备。
- 连接检查和用户手动同步只申请配置 URL 的精确 origin 权限；自动触发只检查已有权限，不弹授权。不得要求所有站点权限。
- 本阶段不处理 Google Drive、远端媒体 GC、设备集合治理或密钥轮换。

### 服务模板（2026-10-14）

连接表单提供以下模板，地址与认证提示依据服务官方文档核实；默认选择坚果云。

| 模板 | 地址填写 | 账号与密码 | 官方依据 |
|---|---|---|---|
| 坚果云 | 预填 `https://dav.jianguoyun.com/dav/`；地址只到 `/dav` 时使用 `/dav/Orinui/` | 账号邮箱、第三方应用密码 | [地址与账号](https://help.jianguoyun.com/?p=3234)、[生成应用密码](https://help.jianguoyun.com/?p=2064) |
| Koofr | 预填 `https://app.koofr.net/dav/Koofr/`，保留路径大小写 | 账号邮箱、为此连接生成的应用密码 | [官方 WebDAV 接入说明](https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/) |
| Nextcloud | 留空，由用户从实例的文件设置复制个人 WebDAV 地址；占位展示 `/remote.php/dav/files/<用户名>/` 形态 | 实例用户名、应用密码 | [官方 WebDAV 说明](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html) |
| 自定义 | 留空，手动填写 HTTPS collection URL | 按服务要求填写账号及密码/应用密码 | 沿用本章地址与条件存取要求 |

各模板均预填示例或官方 WebDAV 地址，地址可编辑。地址规范化后若路径末段正好是 `/dav/`，适配器会在该服务目录下使用 `/Orinui/`，并在确认连接时仅创建这个专用目录（已存在则复用）；用户填写更深的目录时按原地址使用，且要求目标 collection 已存在。该规则覆盖坚果云账户根，可避免直接在其根目录写文件返回 404。切换模板清空账号、密码、恢复密钥及密钥保存确认，并取消旧准备数据、清除旧错误；检查中、加载中或已有合并计划时禁用模板选择。连接配置 schema 2 持久化一致性模式；旧 schema 1 配置迁移为 `strong-etag`，避免升级时隐式降低已有连接的写入保护。

选择模板不联网、不申请权限、不创建目录；官方帮助链接仅在用户点击时导航。用户点击“检查连接”和“确认并启用”后，按模板策略验证所需能力。除坚果云外，预置模板仍要求强 ETag 条件操作。模板不是兼容验收结论。

### WebDAV 目录与对象地址

用户提供 HTTPS collection URL，例如 `https://nas.example/dav/orinui/`。输入校验拒绝非 HTTPS、用户名/密码、查询串和片段；不得通过把凭据嵌进 URL 来支持 Basic Auth。规范化目录后，所有请求地址均由适配器对单个路径段编码并限制在该目录下：

```text
vault.json
vaults/<vaultId>/devices/<deviceId>/snapshot.enc
vaults/<vaultId>/assets/<assetId>.enc
```

`vault.json` 的公开 JSON 外壳只有 schemaVersion、vaultId 与 descriptor ciphertext；解密后的 descriptor 只有 schemaVersion 和 vaultId。descriptor 使用现有加密协议，AAD 为 `{ schemaVersion: 1, vaultId, kind: "snapshot", objectId: vaultId }`。外壳不含恢复密钥或 WebDAV 凭据。

路径段来自已校验的 vault/device/asset ID，使用 URL segment 编码；不可将标识直接解释为可含 `/` 的路径。对象列表只读取该库的 `devices/` 集合，不递归读取目录外内容。通常用户配置的根 collection 必须已存在，并用 `PROPFIND Depth: 0` 确认。唯一例外是 URL 路径末段正好为 `/dav/`：适配器将其映射到同级 `/Orinui/`，并在该应用 collection 不存在时创建；绝不对 DAV endpoint root 发送 `MKCOL`。对应用根和根路径内各目标子目录先执行 PROPFIND；已存在且确为 collection 时直接复用，只有明确返回 404 才发送 MKCOL。MKCOL 返回已存在/冲突状态时再确认目标确实是 collection；其他状态（包括 403）明确失败并附目标路径。适配器不执行目录外的 MKCOL、PUT、GET 或 DELETE。

### HTTP、安全与条件存取

- 扩展保留 `storage` 扩展权限；HTTPS 主机访问为 optional host permission。扩展通过 `chrome.permissions.request` 在用户明确提交连接/测试操作后只请求配置 URL 的精确 origin pattern，含 scheme/host/端口。不得在新标签页初始化、设置打开或后台任务中弹权限请求。
- 请求使用 `Authorization: Basic …`，认证头只在本次请求内生成；不得记录请求头、密码或完整认证 URL。连接测试与同步必须使用同一连接配置。
- 凭据写入 `chrome.storage.local` 前由调用方验证 HTTPS 与字段格式；该存储访问级别限制为 `TRUSTED_CONTEXTS`。凭据不进入 Dexie、同步快照或 ZIP 备份。断开时清除本机凭据和连接状态、密钥及同步状态按现有 disconnect 语义处理；保留本地用户数据。浏览器来源权限是否撤销需显式调用并验证，不能把清除凭据描述为已撤权。
- WebDAV 不假设服务器支持 `LOCK`。所有重定向都拒绝并给出明确错误，避免凭据或对象路径发往未授权目标。
- Koofr、Nextcloud、自定义以及迁移来的旧连接使用强 ETag 条件模式：媒体以 `If-None-Match: *` 创建；快照首次创建使用 `If-None-Match: *`，替换使用 `If-Match: <observed strong ETag>`。缺少写入回执 ETag 时，先查 `PROPFIND Depth: 0` 的 `DAV:getetag`，再查 GET 响应 ETag；取得的版本必须通过 `If-Match` 回读并逐字节核验。版本缺失、内容不符或条件头不生效时明确失败。
- 坚果云模板使用 `readback-only` 兼容模式，不要求 ETag，也不发送写入条件头。对象 revision 为密文字节的 `sha256:<hex>`；快照发布前读取对象并比较 expectedRevision，随后 PUT 并 GET 核对完整字节；媒体先 GET 检查是否已有对象，写入后同样回读；连接能力探测实际执行唯一对象的 PUT、GET、DELETE 和删除后确认。该流程可以识别已发生的变化与读写不一致，但“先读后写”不是原子比较并交换；同一 deviceId 被多个实例同时使用时仍可能互相覆盖。正常的不同设备使用独立快照路径，同配置文件内由 Web Locks 串行化。首次创建 vault descriptor 也使用读前检查和回读确认，因此并发首次创建仍不是原子操作。连接预览会展示此风险。
- `listSnapshots` 在强 ETag 模式返回服务器版本，在坚果云模式通过 GET 内容生成 SHA-256 revision；`readSnapshot` 会对观察到的 revision 复算并比较。所有模式都读取实际字节并校验回执、密文身份和哈希，HTTP 成功本身不能代替内容验证。
- HTTP 401/403、404、409/412、网络错误、格式错误和不支持的条件行为按具体阶段报告；不得吞错、假报成功或自动重试。坚果云读取 `vault.json` 时若返回 HTTP 409，只有响应 XML 的 `<exception>` 为 `AncestorsNotFound` 才按描述不存在处理；其他 409 保持明确失败。该兼容依据是[坚果云缺失文件 409 的已合并修复案例](https://github.com/qixing-jk/all-api-hub/pull/637)。媒体先于快照写入，保持协调器契约。

WebDAV 服务器对条件请求与版本属性的实际行为存在差异，连接检查按已选模式验证能力。坚果云的旧强 ETag 探测已由用户实测确认无法从 PUT、DAV:getetag 或 GET 获得有效强 ETag，因此坚果云模板不再把条件 ETag 作为连接门槛；读写回读失败仍明确报错并显示探测路径。其他服务不因坚果云例外而放宽条件。

该模式设计参考两类 Obsidian 社区插件：Remotely Save 用文件时间、大小及上次同步状态判断变化，并以普通覆盖 PUT 写入，没有 ETag 条件比较；它的行为说明不依赖 ETag 可以换取兼容性，但依赖同步状态和避免并发推送。Cloud WebDAV Sync 使用不可变 SHA-256 Blob 与 Commit，并依据服务能力保护可变 HEAD；其当前策略选择仍要求 HEAD 强 ETag，即使使用 MOVE 排他锁也不直接覆盖完全无 ETag 的情况。Orinui 保留现有每设备独立快照布局，不照搬文件同步或完整仓库格式，只为坚果云采用可识别、可提示的读回模式。[Remotely Save WebDAV 适配器](https://github.com/remotely-save/remotely-save/blob/master/src/fsWebdav.ts)、[Cloud WebDAV Sync 设计](https://github.com/SEVENTEEN-TAN/cloud-webdav-sync/blob/main/README.zh-CN.md)

### 连接与首次合并流程

1. 用户在设置页填写 HTTPS collection、账号和应用密码，点击“检查连接”。该用户操作请求该 origin 权限，然后只读取 `vault.json` descriptor 和现有快照，形成连接/首次合并预览；prepare 阶段不创建目录、不探测条件写入，也不写云端对象。目标库是否已有取决于 `vault.json` descriptor 是否存在，即使它还没有快照也属于已有库。坚果云可能用 HTTP 409 加 `AncestorsNotFound` XML 表示描述或上级目录不存在，仅此明确标记按新库处理。
2. 没有 descriptor 时，预览提供新建库恢复密钥；有 descriptor 时，用户必须导入与该库匹配的恢复密钥。错误密钥或损坏 descriptor 明确失败，不把无快照的已有库误判为新库。
3. 显示本机与远端分组、网站和媒体数量。用户确认时重新读取远端状态并重新执行合并计划；预览数量不是冻结的最终候选，预览期间变化会被纳入确认时计划。
4. 用户点击“确认并启用”并确认已保存新库恢复密钥（或提供已有库密钥）后，才创建必要目录（MKCOL），按模板探测条件写入或读写回读能力，创建新库 descriptor（仅新库），初始化本地同步身份并运行首轮同步。任何实际读写能力失败都明确失败；探测对象使用专属路径，失败会显示诊断路径。
5. 首轮合并和同步明确区分已同步、待同步和失败。发布失败保留完整本机数据，显示失败原因。设置页提供“手动同步”和断开入口；同步状态不暴露凭据和密钥。

连接等待按依赖关系并行：用户点击后立即请求来源权限，同时读取本地连接状态与配置；读取远端 descriptor 时并行统计本机数据；列出远端设备后，并行读取各设备快照版本，最终按设备 ID 排序。启用时只并行创建已确认互不依赖的 `devices/` 与 `assets/` collection；`vaults/`、库目录及设备目录仍按父子依赖顺序创建。加入已有库会在任何远端写入前重新核验 descriptor；严格模式用条件 PUT 拒绝并发创建，坚果云模式在写入前检查描述是否已存在，但此先读后写检查不是原子操作，无法消除同时创建的竞争。描述创建完成后，适配器已核对写入字节/descriptor，连接层不再重复读取；坚果云回读模式也不重复获取已经逐字节核验的 descriptor。以上减少串行网络往返，不代表已测量真实服务的耗时。

首次合并预览用紧凑数量表对照本机/云端数据，并简述合并影响。只有新建库展示一次性恢复密钥，可主动复制完整密钥；复制成功不等于已保存，仍需用户手动勾选保存确认。加入已有库不再次展示或生成密钥。复制失败明确显示，剪贴板写入集中在 platform，并在点击调用链中使用 [Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)；不读取剪贴板，不新增安装权限。新建计划缺密钥时显示错误并禁止启用。此项只调整预览交互，不改变确认时重新读取/合并及条件存取流程。

### 启用后的触发

同步默认关闭。首次权限检查及用户点击手动同步时可以请求权限；自动触发器只调用权限 `contains`，不会弹窗。仅在用户点击“确认并启用”、保存/导入正确密钥并成功完成连接后启用。扩展页打开和本地 generation 写入可触发异步协调；最近一次撤销截止时间也会安排单次 timeout。调用现有同配置文件独占锁和 `syncNow()`，主页继续先读取 Dexie。没有定时轮询或自动重试。触发器串行并合并运行期间到达的信号，不并发运行多个协调器；每次失败更新显式状态，不回退修改或丢弃本地数据。页面关闭可能中断任务，下次扩展页打开或手动同步恢复。

连接确认进入本机锁后会再次校验本地连接身份和远端库身份；等待期间旧身份变化会丢弃准备数据和界面计划，不继续初始化新身份。跨设备预览的数量不会替代确认时重新读取。所有重定向一律明确失败，不把 Basic Authorization 转发到别的 origin。

### 受控扩展审计（2026-10-13）

隔离 Chromium 154.0.8037.92 扩展审计使用预授权的 `https://localhost` 来源和自签测试证书，连接到仅绑定 `127.0.0.1` 的临时 HTTPS WebDAV 服务，最终 8 项检查全部通过。独立的两个 Chrome 配置文件实际完成：新建加密库及恢复密钥保存确认；第二配置文件拒绝错误恢复密钥、导入正确密钥并合并，保留两边分组/网站并还原图标；本机编辑自动发布、手动接收刷新网页并还原照片 Blob；服务返回 503 时显示失败，恢复服务后手动同步成功；断开移除本机连接同时保留网站。额外确认未配置连接时零网络请求、同配置文件另一标签页连接后旧 prepared 计划作废、重新打开扩展页会启动同步，以及服务忽略条件请求时在本机连接建立前明确拒绝。能力探测覆盖强 ETag 条件创建、重复创建拒绝、错误 If-Match PUT/DELETE 拒绝与匹配版本读取/清理。客户端始终保留正常 TLS 验证；仅该隔离审计浏览器接受自签 fixture 证书。

这是本地受控服务上的真实扩展流程证据，不是普通网页模拟。最终结果保存在忽略的 `/tmp/orinui-webdav-audit/browser-result.json`。来源已预授权，未验证浏览器权限弹窗、拒绝或撤销；受控测试服务审计与用户确认的真实 WebDAV 服务验收是不同证据。动态媒体同步组合、Google Drive、设备集合、远端媒体清理、密钥轮换和真实用户设备验收仍未完成。

### 验证要求

- 单元层：URL/origin/路径边界、Basic 认证头不泄露、状态码分类、XML/PROPFIND 解析、重定向拒绝、强 ETag 条件读取/创建/替换及竞争状态、坚果云 SHA-256 回读 revision 与读写探测。
- 集成层：用真实适配器接入注入的 fetch/权限/storage 端口，验证协调器完整快照与媒体往返、失败阶段和回执不确定状态。测试内存对象服务不能作为运行时提供方替身。
- 真实服务层：至少对一个兼容 WebDAV 服务验证用户触发授权、连接检查、首次建库及密钥保存确认、已有库密钥导入、合并预览、媒体与快照读写、所选一致性模式与服务能力匹配、断网/拒绝/断开及权限撤销。严格模式应拒绝缺少强 ETag 或忽略条件头的服务；坚果云回读模式需特别检查回读差异和本地数据保留。记录服务类型和限制；不能由普通网页预览或构建成功替代。
- 浏览器权限需分别验证授权、拒绝和撤销。使用的 manifest 权限必须保持可选，并仅按用户配置申请精确 origin。

### 明确未包含

Google OAuth/Drive 按用户决定延期。远端孤儿媒体清理、完整设备集合和离线设备退出、密钥轮换仍待细化协议及 MVP 边界；当前不承诺真实多服务兼容性。本项目不采用定时轮询。实现代码、自动检查、用户验收和真实服务验收分别记录，不相互替代。


## S3 与 R2 提供方

本文件说明 S3 提供方边界。Cloudflare R2 是首个真实服务验收目标；允许输入自定义 HTTPS endpoint，但没有通过实际服务验收的存储服务不声明兼容。自动测试与连接配置正确不等同于真实 R2 双配置文件验收。

截至 2026-10-25，当前协议为 Dexie 14 / ZIP v11 / sync schema 13；显式升级 Dexie 11–13 / ZIP v8–10 / sync schema 10–12。旧分组格式拒绝，不自动迁移、清库或重建同步身份。Niagara 格位、纯文本便签与待办随同一加密快照同步，不新增对象类型或明文通道。永久墓碑与已删文件夹网站派生回主页的规则与 WebDAV 共用，详见 本文。源码未发布；真实 R2（包括新小组件与全库媒体组合）尚未验收，既有 WebDAV 真实验收不替代它。检查依据见 [VERIFICATION.md](./VERIFICATION.md)。

### 连接与对象命名

- 用户必须预先创建 bucket，并为 Orinui 使用独立 prefix。Orinui 不创建或删除 bucket，不修改 bucket policy/CORS。
- 配置包含 endpoint、bucket、prefix、region、Access Key ID 和 Secret Access Key。R2 模板填写 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` 与 `region=auto`。使用 path-style 对象地址。
- endpoint 只接受无路径、无用户凭据、查询串或片段的 HTTPS 来源。用户点击检查连接时才申请该 origin 的可选权限。
- 凭据只保存于当前扩展配置文件的 `chrome.storage.local`，访问级别限制为 `TRUSTED_CONTEXTS`；凭据不进入 Dexie、ZIP、快照或日志。
- `<prefix>/vault.json` 保存加密库描述，`<prefix>/vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 保存加密快照，`<prefix>/vaults/<vaultId>/assets/<assetId>.enc` 保存逐文件加密媒体。
- 一个 prefix 对应一个同步库。更换提供方时先保留本机数据断开，再由用户检查并连接目标；不自动搬迁或删除原库。

### 条件写入、浏览器请求与失败

- 使用 AWS SDK for JavaScript v3 浏览器客户端，禁用 SDK 自动重试和区域跳转。媒体采用单对象 PUT，本轮不启用 multipart 或断点续传。
- 新媒体和库描述通过 `If-None-Match: *` 创建；设备快照通过 `If-None-Match: *` 首次发布、通过当前 ETag 的 `If-Match` 替换。S3 ETag 只是版本标识，内容 SHA-256 仍由 Orinui 校验。
- 连接检查验证 bucket 权限与原子条件写入。条件头不生效、ETag 不可读取、401/403、CORS 或网络失败都明确显示；不以先读后写替代原子条件，也不自动扩大来源权限或修改 CORS。
- 用户需自行在 bucket CORS 中允许扩展来源、已签名的 S3 请求头，并暴露 ETag；具体配置按所用 endpoint 的官方要求填写。失败时 Orinui 给出诊断，不调用服务商控制台 API。
- `XhrHttpHandler` 报告单个媒体 PUT/GET 的真实字节进度；解码、加密和 IndexedDB 事务分别显示阶段，不以文件个数代替字节进度。

### 容量预览与删除

- 容量预览分别显示本机媒体原件、本轮快照和媒体预计收发字节，以及远端当前 vault 对象的实际占用。未取得准确 Content-Length 时显示无法取得；不把字节数作为费用预测。
- 预览使用只读快照，不更改本机数据；预览与开始同步之间若数据改变，重新按执行时的状态计算。
- 远端删除前显示 bucket、prefix 和 vault 身份，并再次读取库描述验证身份与版本；在本机锁内按 `ListObjectsV2` continuation token 分页删除当前 vault 对象，验证清空后再删除对应库描述并复核。
- R2 的 `DeleteObject` 不假定有原子条件删除能力。用户须先停止其他设备同步。删除不是跨设备原子事务；任一步失败都会明确报错并保留本机数据及连接，供用户重试。
- 删除不触及 bucket、prefix 外对象或其他 prefix。忘记恢复密钥时，删除目标由本次检查得到的 vault ID、描述版本和连接配置绑定；任一项变化后旧目标失效，删除必须再次检查并经二次确认。

### 验收范围

自动检查覆盖输入校验、对象 key 隔离、条件创建/更新冲突、ETag、分页、元数据统计、进度和部分删除错误。S3 command 测试仅验证 SDK 调用映射，不替代真实服务。

真实扩展验收须使用已创建、配置好 CORS 的专用 R2 bucket/prefix 和两个隔离 Chrome 配置文件，验证 origin 权限、R2 条件写入及响应头可读、恢复密钥加入、未激活壁纸同步、容量预览、断网/拒权/412 错误、删除失败重试以及相邻对象保留。未获得 R2 凭据或真实服务验收时，不标为兼容通过。
