# WebDAV 提供方实施说明

状态：WebDAV 适配器、连接流程与事件触发已实现，并通过受控本机 HTTPS 服务的真实扩展审计。该服务使用预授权来源和自签测试证书，不代表第三方 WebDAV 服务兼容性、用户权限弹窗或发布验收。总同步决策见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)，对象端口顺序见 [SYNC-COORDINATOR.md](./SYNC-COORDINATOR.md)，密文格式见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)。

## 范围

- 用户选择一个 HTTPS WebDAV 目录承载一个同步库；应用只在用户启用后连接。
- 目录下的 `vault.json` 保存库 ID 和加密库描述；`vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 保存每设备加密快照，`vaults/<vaultId>/assets/<assetId>.enc` 保存独立加密媒体。沿用现有 AES-256-GCM envelope、恢复密钥和字段合并协议，不增加明文模式。
- 账号名与应用密码只保存在当前 Chrome 配置文件的 `chrome.storage.local`。不得写入 URL、Dexie 同步表、快照、日志、普通 JSON 备份或任何其他设备。
- 连接检查和用户手动同步只申请配置 URL 的精确 origin 权限；自动触发只检查已有权限，不弹授权。不得要求所有站点权限。
- 本阶段不处理 Google Drive、远端媒体 GC、设备集合治理或密钥轮换。

## WebDAV 目录与对象地址

用户提供 HTTPS collection URL，例如 `https://nas.example/dav/orinui/`。输入校验拒绝非 HTTPS、用户名/密码、查询串和片段；不得通过把凭据嵌进 URL 来支持 Basic Auth。规范化目录后，所有请求地址均由适配器对单个路径段编码并限制在该目录下：

```text
vault.json
vaults/<vaultId>/devices/<deviceId>/snapshot.enc
vaults/<vaultId>/assets/<assetId>.enc
```

`vault.json` 的公开 JSON 外壳只有 schemaVersion、vaultId 与 descriptor ciphertext；解密后的 descriptor 只有 schemaVersion 和 vaultId。descriptor 使用现有加密协议，AAD 为 `{ schemaVersion: 1, vaultId, kind: "snapshot", objectId: vaultId }`。外壳不含恢复密钥或 WebDAV 凭据。

路径段来自已校验的 vault/device/asset ID，使用 URL segment 编码；不可将标识直接解释为可含 `/` 的路径。对象列表只读取该库的 `devices/` 集合，不递归读取目录外内容。首次设置可创建所需子目录；目录创建返回冲突时需检查该目录确实存在，其他 HTTP/WebDAV 状态明确失败。适配器不执行目录外的 MKCOL、PUT、GET 或 DELETE。

## HTTP、安全与条件存取

- 扩展保留 `storage` 扩展权限；HTTPS 主机访问为 optional host permission。扩展通过 `chrome.permissions.request` 在用户明确提交连接/测试操作后只请求配置 URL 的精确 origin pattern，含 scheme/host/端口。不得在新标签页初始化、设置打开或后台任务中弹权限请求。
- 请求使用 `Authorization: Basic …`，认证头只在本次请求内生成；不得记录请求头、密码或完整认证 URL。连接测试与同步必须使用同一连接配置。
- 凭据写入 `chrome.storage.local` 前由调用方验证 HTTPS 与字段格式；该存储访问级别限制为 `TRUSTED_CONTEXTS`。凭据不进入 Dexie、同步快照或 JSON 备份。断开时清除本机凭据和连接状态、密钥及同步状态按现有 disconnect 语义处理；保留本地用户数据。浏览器来源权限是否撤销需显式调用并验证，不能把清除凭据描述为已撤权。
- WebDAV 不假设服务器支持 `LOCK`。所有重定向都拒绝并给出明确错误，避免凭据或对象路径发往未授权目标。
- 快照和媒体 PUT 必须利用服务器强 ETag 与条件头兑现对象端口：媒体使用 `If-None-Match: *` 创建；快照用 `If-None-Match: *` 首次创建、用 `If-Match: <observed strong ETag>` 替换。缺失、弱 ETag、条件头不受支持或条件状态不确定时明确失败，禁止退化为无条件覆盖。
- `listSnapshots` 返回每个设备当前可读的强 ETag revision。`readSnapshot` 带 `If-Match` 读取观察到的版本；变化返回明确冲突。创建对象后读取实际字节并校验回执、密文身份和哈希；响应成功本身不能代替内容验证。
- HTTP 401/403、404、409/412、网络错误、格式错误和不支持的条件行为按具体阶段报告；不得吞错、假报成功或自动重试。媒体先于快照写入，保持协调器契约。

WebDAV 服务器对 PUT、GET、PROPFIND 与 ETag 的实际行为存在实现差异。连接检查必须验证本项目依赖的能力；如果服务器只提供弱 ETag 或忽略条件头，不得启用同步。若 PROPFIND 列表没有可靠 ETag，适配器应读取候选快照属性并取得强 ETag；无法建立可靠 revision 时明确拒绝该服务。

## 连接与首次合并流程

1. 用户在设置页填写 HTTPS collection、账号和应用密码，点击“检查连接”。该用户操作请求该 origin 权限，然后只读取 `vault.json` descriptor 和现有快照，形成连接/首次合并预览；prepare 阶段不创建目录、不探测条件写入，也不写云端对象。目标库是否已有取决于 `vault.json` descriptor 是否存在，即使它还没有快照也属于已有库。
2. 没有 descriptor 时，预览提供新建库恢复密钥；有 descriptor 时，用户必须导入与该库匹配的恢复密钥。错误密钥或损坏 descriptor 明确失败，不把无快照的已有库误判为新库。
3. 显示本机与远端分组、网站、照片和图标数量。用户确认时重新读取远端状态并重新执行合并计划；预览数量不是冻结的最终候选，预览期间变化会被纳入确认时计划。
4. 用户点击“确认并启用”并确认已保存新库恢复密钥（或提供已有库密钥）后，才创建必要目录（MKCOL）、探测强 ETag 与条件创建/替换/删除能力、创建新库 descriptor（仅新库），初始化本地同步身份并运行首轮同步。任何能力探测失败都明确失败，不启用同步；创建/探测对象使用专属路径，清理失败时显示诊断路径。
5. 首轮合并和同步明确区分已同步、待同步和失败。发布失败保留完整本机数据，显示失败原因。设置页提供“手动同步”和断开入口；同步状态不暴露凭据和密钥。

## 启用后的触发

同步默认关闭。首次权限检查及用户点击手动同步时可以请求权限；自动触发器只调用权限 `contains`，不会弹窗。仅在用户点击“确认并启用”、保存/导入正确密钥并成功完成连接后启用。扩展页打开和本地 generation 写入可触发异步协调；最近一次撤销截止时间也会安排单次 timeout。调用现有同配置文件独占锁和 `syncNow()`，主页继续先读取 Dexie。没有定时轮询或自动重试。触发器串行并合并运行期间到达的信号，不并发运行多个协调器；每次失败更新显式状态，不回退修改或丢弃本地数据。页面关闭可能中断任务，下次扩展页打开或手动同步恢复。

连接确认进入本机锁后会再次校验本地连接身份和远端库身份；等待期间旧身份变化会丢弃准备数据和界面计划，不继续初始化新身份。跨设备预览的数量不会替代确认时重新读取。所有重定向一律明确失败，不把 Basic Authorization 转发到别的 origin。

## 受控扩展审计（2026-10-13）

隔离 Chromium 154.0.8037.92 扩展审计使用预授权的 `https://localhost` 来源和自签测试证书，连接到仅绑定 `127.0.0.1` 的临时 HTTPS WebDAV 服务，最终 8 项检查全部通过。独立的两个 Chrome 配置文件实际完成：新建加密库及恢复密钥保存确认；第二配置文件拒绝错误恢复密钥、导入正确密钥并合并，保留两边分组/网站并还原图标；本机编辑自动发布、手动接收刷新网页并还原照片 Blob；服务返回 503 时显示失败，恢复服务后手动同步成功；断开移除本机连接同时保留网站。额外确认未配置连接时零网络请求、同配置文件另一标签页连接后旧 prepared 计划作废、重新打开扩展页会启动同步，以及服务忽略条件请求时在本机连接建立前明确拒绝。能力探测覆盖强 ETag 条件创建、重复创建拒绝、错误 If-Match PUT/DELETE 拒绝与匹配版本读取/清理。客户端始终保留正常 TLS 验证；仅该隔离审计浏览器接受自签 fixture 证书。

这是本地受控服务上的真实扩展流程证据，不是普通网页模拟。最终结果保存在忽略的 `/tmp/orinui-webdav-audit/browser-result.json`。来源已预授权，未验证浏览器权限弹窗、拒绝或撤销；测试服务不代表 Nextcloud、NAS 或其他第三方服务。Google Drive、设备集合、远端媒体清理、密钥轮换和真实用户服务器验收仍未完成。

## 验证要求

- 单元层：URL/origin/路径边界、Basic 认证头不泄露、状态码分类、XML/PROPFIND 解析、重定向拒绝、强 ETag 条件读取/创建/替换及竞争状态。
- 集成层：用真实适配器接入注入的 fetch/权限/storage 端口，验证协调器完整快照与媒体往返、失败阶段和回执不确定状态。测试内存对象服务不能作为运行时提供方替身。
- 真实服务层：至少对一个兼容 WebDAV 服务验证用户触发授权、连接检查、首次建库及密钥保存确认、已有库密钥导入、合并预览、媒体与快照读写、弱/缺失 ETag 拒绝、断网/拒绝/断开及权限撤销。记录服务类型和限制；不能由普通网页预览或构建成功替代。
- 浏览器权限需分别验证授权、拒绝和撤销。使用的 manifest 权限必须保持可选，并仅按用户配置申请精确 origin。

## 明确未包含

Google OAuth/Drive、远端孤儿媒体清理、完整设备集合和离线设备淘汰、密钥轮换、定时轮询及真实多服务兼容性承诺仍为后续工作。实现代码、自动检查、真实扩展验证和服务端验收分别记录，不相互替代。
