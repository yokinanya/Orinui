# WebDAV 提供方实施说明

状态：WebDAV 适配器、连接流程与事件触发已实现，并通过受控本机 HTTPS 服务的真实扩展审计。该服务使用预授权来源和自签测试证书，不代表第三方 WebDAV 服务兼容性、用户权限弹窗或发布验收。总同步决策见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)，对象端口顺序见 [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md)，密文格式见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)。

2026-10-14 用户已另行确认当前 UI、现有功能扩展权限和屏幕吸管验收，依据见 [VERIFICATION.md](./VERIFICATION.md)。下一阶段优先真实第三方 WebDAV 服务及真实设备；具体服务来源与同步流程仍需记录，Google Drive 适配器与授权验收延期。下方保留历史受控审计的原始范围。

## 范围

- 用户选择一个 HTTPS WebDAV 目录承载一个同步库；应用只在用户启用后连接。
- 目录下的 `vault.json` 保存库 ID 和加密库描述；`vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 保存每设备加密快照，`vaults/<vaultId>/assets/<assetId>.enc` 保存独立加密媒体。沿用现有 AES-256-GCM envelope、恢复密钥和字段合并协议，不增加明文模式。
- 账号名与应用密码只保存在当前 Chrome 配置文件的 `chrome.storage.local`。不得写入 URL、Dexie 同步表、快照、日志、普通 JSON 备份或任何其他设备。
- 连接检查和用户手动同步只申请配置 URL 的精确 origin 权限；自动触发只检查已有权限，不弹授权。不得要求所有站点权限。
- 本阶段不处理 Google Drive、远端媒体 GC、设备集合治理或密钥轮换。

## 服务模板（2026-10-14）

连接表单提供以下模板，地址与认证提示依据服务官方文档核实；默认选择坚果云。

| 模板 | 地址填写 | 账号与密码 | 官方依据 |
|---|---|---|---|
| 坚果云 | 预填 `https://dav.jianguoyun.com/dav/`；地址只到 `/dav` 时使用 `/dav/Orinui/` | 账号邮箱、第三方应用密码 | [地址与账号](https://help.jianguoyun.com/?p=3234)、[生成应用密码](https://help.jianguoyun.com/?p=2064) |
| Koofr | 预填 `https://app.koofr.net/dav/Koofr/`，保留路径大小写 | 账号邮箱、为此连接生成的应用密码 | [官方 WebDAV 接入说明](https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/) |
| Nextcloud | 留空，由用户从实例的文件设置复制个人 WebDAV 地址；占位展示 `/remote.php/dav/files/<用户名>/` 形态 | 实例用户名、应用密码 | [官方 WebDAV 说明](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html) |
| 自定义 | 留空，手动填写 HTTPS collection URL | 按服务要求填写账号及密码/应用密码 | 沿用本章地址与条件存取要求 |

各模板均预填示例或官方 WebDAV 地址，地址可编辑。地址规范化后若路径末段正好是 `/dav/`，适配器会在该服务目录下使用 `/Orinui/`，并在确认连接时仅创建这个专用目录（已存在则复用）；用户填写更深的目录时按原地址使用，且要求目标 collection 已存在。该规则覆盖坚果云账户根，可避免直接在其根目录写文件返回 404。切换模板清空账号、密码、恢复密钥及密钥保存确认，并取消旧准备数据、清除旧错误；检查中、加载中或已有合并计划时禁用模板选择。连接配置 schema 2 持久化一致性模式；旧 schema 1 配置迁移为 `strong-etag`，避免升级时隐式降低已有连接的写入保护。

选择模板不联网、不申请权限、不创建目录；官方帮助链接仅在用户点击时导航。用户点击“检查连接”和“确认并启用”后，按模板策略验证所需能力。除坚果云外，预置模板仍要求强 ETag 条件操作。模板不是兼容验收结论。

## WebDAV 目录与对象地址

用户提供 HTTPS collection URL，例如 `https://nas.example/dav/orinui/`。输入校验拒绝非 HTTPS、用户名/密码、查询串和片段；不得通过把凭据嵌进 URL 来支持 Basic Auth。规范化目录后，所有请求地址均由适配器对单个路径段编码并限制在该目录下：

```text
vault.json
vaults/<vaultId>/devices/<deviceId>/snapshot.enc
vaults/<vaultId>/assets/<assetId>.enc
```

`vault.json` 的公开 JSON 外壳只有 schemaVersion、vaultId 与 descriptor ciphertext；解密后的 descriptor 只有 schemaVersion 和 vaultId。descriptor 使用现有加密协议，AAD 为 `{ schemaVersion: 1, vaultId, kind: "snapshot", objectId: vaultId }`。外壳不含恢复密钥或 WebDAV 凭据。

路径段来自已校验的 vault/device/asset ID，使用 URL segment 编码；不可将标识直接解释为可含 `/` 的路径。对象列表只读取该库的 `devices/` 集合，不递归读取目录外内容。通常用户配置的根 collection 必须已存在，并用 `PROPFIND Depth: 0` 确认。唯一例外是 URL 路径末段正好为 `/dav/`：适配器将其映射到同级 `/Orinui/`，并在该应用 collection 不存在时创建；绝不对 DAV endpoint root 发送 `MKCOL`。对应用根和根路径内各目标子目录先执行 PROPFIND；已存在且确为 collection 时直接复用，只有明确返回 404 才发送 MKCOL。MKCOL 返回已存在/冲突状态时再确认目标确实是 collection；其他状态（包括 403）明确失败并附目标路径。适配器不执行目录外的 MKCOL、PUT、GET 或 DELETE。

## HTTP、安全与条件存取

- 扩展保留 `storage` 扩展权限；HTTPS 主机访问为 optional host permission。扩展通过 `chrome.permissions.request` 在用户明确提交连接/测试操作后只请求配置 URL 的精确 origin pattern，含 scheme/host/端口。不得在新标签页初始化、设置打开或后台任务中弹权限请求。
- 请求使用 `Authorization: Basic …`，认证头只在本次请求内生成；不得记录请求头、密码或完整认证 URL。连接测试与同步必须使用同一连接配置。
- 凭据写入 `chrome.storage.local` 前由调用方验证 HTTPS 与字段格式；该存储访问级别限制为 `TRUSTED_CONTEXTS`。凭据不进入 Dexie、同步快照或 JSON 备份。断开时清除本机凭据和连接状态、密钥及同步状态按现有 disconnect 语义处理；保留本地用户数据。浏览器来源权限是否撤销需显式调用并验证，不能把清除凭据描述为已撤权。
- WebDAV 不假设服务器支持 `LOCK`。所有重定向都拒绝并给出明确错误，避免凭据或对象路径发往未授权目标。
- Koofr、Nextcloud、自定义以及迁移来的旧连接使用强 ETag 条件模式：媒体以 `If-None-Match: *` 创建；快照首次创建使用 `If-None-Match: *`，替换使用 `If-Match: <observed strong ETag>`。缺少写入回执 ETag 时，先查 `PROPFIND Depth: 0` 的 `DAV:getetag`，再查 GET 响应 ETag；取得的版本必须通过 `If-Match` 回读并逐字节核验。版本缺失、内容不符或条件头不生效时明确失败。
- 坚果云模板使用 `readback-only` 兼容模式，不要求 ETag，也不发送写入条件头。对象 revision 为密文字节的 `sha256:<hex>`；快照发布前读取对象并比较 expectedRevision，随后 PUT 并 GET 核对完整字节；媒体先 GET 检查是否已有对象，写入后同样回读；连接能力探测实际执行唯一对象的 PUT、GET、DELETE 和删除后确认。该流程可以识别已发生的变化与读写不一致，但“先读后写”不是原子比较并交换；同一 deviceId 被多个实例同时使用时仍可能互相覆盖。正常的不同设备使用独立快照路径，同配置文件内由 Web Locks 串行化。首次创建 vault descriptor 也使用读前检查和回读确认，因此并发首次创建仍不是原子操作。连接预览会展示此风险。
- `listSnapshots` 在强 ETag 模式返回服务器版本，在坚果云模式通过 GET 内容生成 SHA-256 revision；`readSnapshot` 会对观察到的 revision 复算并比较。所有模式都读取实际字节并校验回执、密文身份和哈希，HTTP 成功本身不能代替内容验证。
- HTTP 401/403、404、409/412、网络错误、格式错误和不支持的条件行为按具体阶段报告；不得吞错、假报成功或自动重试。坚果云读取 `vault.json` 时若返回 HTTP 409，只有响应 XML 的 `<exception>` 为 `AncestorsNotFound` 才按描述不存在处理；其他 409 保持明确失败。该兼容依据是[坚果云缺失文件 409 的已合并修复案例](https://github.com/qixing-jk/all-api-hub/pull/637)。媒体先于快照写入，保持协调器契约。

WebDAV 服务器对条件请求与版本属性的实际行为存在差异，连接检查按已选模式验证能力。坚果云的旧强 ETag 探测已由用户实测确认无法从 PUT、DAV:getetag 或 GET 获得有效强 ETag，因此坚果云模板不再把条件 ETag 作为连接门槛；读写回读失败仍明确报错并显示探测路径。其他服务不因坚果云例外而放宽条件。

该模式设计参考两类 Obsidian 社区插件：Remotely Save 用文件时间、大小及上次同步状态判断变化，并以普通覆盖 PUT 写入，没有 ETag 条件比较；它的行为说明不依赖 ETag 可以换取兼容性，但依赖同步状态和避免并发推送。Cloud WebDAV Sync 使用不可变 SHA-256 Blob 与 Commit，并依据服务能力保护可变 HEAD；其当前策略选择仍要求 HEAD 强 ETag，即使使用 MOVE 排他锁也不直接覆盖完全无 ETag 的情况。Orinui 保留现有每设备独立快照布局，不照搬文件同步或完整仓库格式，只为坚果云采用可识别、可提示的读回模式。[Remotely Save WebDAV 适配器](https://github.com/remotely-save/remotely-save/blob/master/src/fsWebdav.ts)、[Cloud WebDAV Sync 设计](https://github.com/SEVENTEEN-TAN/cloud-webdav-sync/blob/main/README.zh-CN.md)

## 连接与首次合并流程

1. 用户在设置页填写 HTTPS collection、账号和应用密码，点击“检查连接”。该用户操作请求该 origin 权限，然后只读取 `vault.json` descriptor 和现有快照，形成连接/首次合并预览；prepare 阶段不创建目录、不探测条件写入，也不写云端对象。目标库是否已有取决于 `vault.json` descriptor 是否存在，即使它还没有快照也属于已有库。坚果云可能用 HTTP 409 加 `AncestorsNotFound` XML 表示描述或上级目录不存在，仅此明确标记按新库处理。
2. 没有 descriptor 时，预览提供新建库恢复密钥；有 descriptor 时，用户必须导入与该库匹配的恢复密钥。错误密钥或损坏 descriptor 明确失败，不把无快照的已有库误判为新库。
3. 显示本机与远端分组、网站、照片和图标数量。用户确认时重新读取远端状态并重新执行合并计划；预览数量不是冻结的最终候选，预览期间变化会被纳入确认时计划。
4. 用户点击“确认并启用”并确认已保存新库恢复密钥（或提供已有库密钥）后，才创建必要目录（MKCOL），按模板探测条件写入或读写回读能力，创建新库 descriptor（仅新库），初始化本地同步身份并运行首轮同步。任何实际读写能力失败都明确失败；探测对象使用专属路径，失败会显示诊断路径。
5. 首轮合并和同步明确区分已同步、待同步和失败。发布失败保留完整本机数据，显示失败原因。设置页提供“手动同步”和断开入口；同步状态不暴露凭据和密钥。

连接等待按依赖关系并行：用户点击后立即请求来源权限，同时读取本地连接状态与配置；读取远端 descriptor 时并行统计本机数据；列出远端设备后，并行读取各设备快照版本，最终按设备 ID 排序。启用时只并行创建已确认互不依赖的 `devices/` 与 `assets/` collection；`vaults/`、库目录及设备目录仍按父子依赖顺序创建。加入已有库会在任何远端写入前重新核验 descriptor；严格模式用条件 PUT 拒绝并发创建，坚果云模式在写入前检查描述是否已存在，但此先读后写检查不是原子操作，无法消除同时创建的竞争。描述创建完成后，适配器已核对写入字节/descriptor，连接层不再重复读取；坚果云回读模式也不重复获取已经逐字节核验的 descriptor。以上减少串行网络往返，不代表已测量真实服务的耗时。

首次合并预览用紧凑数量表对照本机/云端数据，并简述合并影响。只有新建库展示一次性恢复密钥，可主动复制完整密钥；复制成功不等于已保存，仍需用户手动勾选保存确认。加入已有库不再次展示或生成密钥。复制失败明确显示，剪贴板写入集中在 platform，并在点击调用链中使用 [Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)；不读取剪贴板，不新增安装权限。新建计划缺密钥时显示错误并禁止启用。此项只调整预览交互，不改变确认时重新读取/合并及条件存取流程。

## 启用后的触发

同步默认关闭。首次权限检查及用户点击手动同步时可以请求权限；自动触发器只调用权限 `contains`，不会弹窗。仅在用户点击“确认并启用”、保存/导入正确密钥并成功完成连接后启用。扩展页打开和本地 generation 写入可触发异步协调；最近一次撤销截止时间也会安排单次 timeout。调用现有同配置文件独占锁和 `syncNow()`，主页继续先读取 Dexie。没有定时轮询或自动重试。触发器串行并合并运行期间到达的信号，不并发运行多个协调器；每次失败更新显式状态，不回退修改或丢弃本地数据。页面关闭可能中断任务，下次扩展页打开或手动同步恢复。

连接确认进入本机锁后会再次校验本地连接身份和远端库身份；等待期间旧身份变化会丢弃准备数据和界面计划，不继续初始化新身份。跨设备预览的数量不会替代确认时重新读取。所有重定向一律明确失败，不把 Basic Authorization 转发到别的 origin。

## 受控扩展审计（2026-10-13）

隔离 Chromium 154.0.8037.92 扩展审计使用预授权的 `https://localhost` 来源和自签测试证书，连接到仅绑定 `127.0.0.1` 的临时 HTTPS WebDAV 服务，最终 8 项检查全部通过。独立的两个 Chrome 配置文件实际完成：新建加密库及恢复密钥保存确认；第二配置文件拒绝错误恢复密钥、导入正确密钥并合并，保留两边分组/网站并还原图标；本机编辑自动发布、手动接收刷新网页并还原照片 Blob；服务返回 503 时显示失败，恢复服务后手动同步成功；断开移除本机连接同时保留网站。额外确认未配置连接时零网络请求、同配置文件另一标签页连接后旧 prepared 计划作废、重新打开扩展页会启动同步，以及服务忽略条件请求时在本机连接建立前明确拒绝。能力探测覆盖强 ETag 条件创建、重复创建拒绝、错误 If-Match PUT/DELETE 拒绝与匹配版本读取/清理。客户端始终保留正常 TLS 验证；仅该隔离审计浏览器接受自签 fixture 证书。

这是本地受控服务上的真实扩展流程证据，不是普通网页模拟。最终结果保存在忽略的 `/tmp/orinui-webdav-audit/browser-result.json`。来源已预授权，未验证浏览器权限弹窗、拒绝或撤销；测试服务不代表 Nextcloud、NAS 或其他第三方服务。Google Drive、设备集合、远端媒体清理、密钥轮换和真实用户服务器验收仍未完成。

## 验证要求

- 单元层：URL/origin/路径边界、Basic 认证头不泄露、状态码分类、XML/PROPFIND 解析、重定向拒绝、强 ETag 条件读取/创建/替换及竞争状态、坚果云 SHA-256 回读 revision 与读写探测。
- 集成层：用真实适配器接入注入的 fetch/权限/storage 端口，验证协调器完整快照与媒体往返、失败阶段和回执不确定状态。测试内存对象服务不能作为运行时提供方替身。
- 真实服务层：至少对一个兼容 WebDAV 服务验证用户触发授权、连接检查、首次建库及密钥保存确认、已有库密钥导入、合并预览、媒体与快照读写、所选一致性模式与服务能力匹配、断网/拒绝/断开及权限撤销。严格模式应拒绝缺少强 ETag 或忽略条件头的服务；坚果云回读模式需特别检查回读差异和本地数据保留。记录服务类型和限制；不能由普通网页预览或构建成功替代。
- 浏览器权限需分别验证授权、拒绝和撤销。使用的 manifest 权限必须保持可选，并仅按用户配置申请精确 origin。

## 明确未包含

Google OAuth/Drive 按用户决定延期。远端孤儿媒体清理、完整设备集合和离线设备退出、密钥轮换仍待细化协议及 MVP 边界；当前不承诺真实多服务兼容性。本项目不采用定时轮询。实现代码、自动检查、用户验收和真实服务验收分别记录，不相互替代。
