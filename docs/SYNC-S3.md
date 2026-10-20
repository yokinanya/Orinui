# S3 与 Cloudflare R2 提供方

本文件说明 S3 提供方边界。Cloudflare R2 是首个真实服务验收目标；允许输入自定义 HTTPS endpoint，但没有通过实际服务验收的存储服务不声明兼容。自动测试与连接配置正确不等同于真实 R2 双配置文件验收。

当前协议为 Dexie 13 / ZIP v10 / sync schema 12；显式升级上一版 Dexie 12 / ZIP v9 / sync schema 11 和 Beta 2 的 Dexie 11 / ZIP v8 / sync schema 10。旧分组格式拒绝，不自动迁移、清库或重建同步身份。永久墓碑与已删文件夹网站派生回主页的规则与 WebDAV 共用，详见 [SYNC-PROTOCOL.md](./SYNC-PROTOCOL.md)。2026-10-18 本轮文件夹与界面尚未验收的历史记录保留在 [VERIFICATION.md](./VERIFICATION.md)。

## 连接与对象命名

- 用户必须预先创建 bucket，并为 Orinui 使用独立 prefix。Orinui 不创建或删除 bucket，不修改 bucket policy/CORS。
- 配置包含 endpoint、bucket、prefix、region、Access Key ID 和 Secret Access Key。R2 模板填写 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` 与 `region=auto`。使用 path-style 对象地址。
- endpoint 只接受无路径、无用户凭据、查询串或片段的 HTTPS 来源。用户点击检查连接时才申请该 origin 的可选权限。
- 凭据只保存于当前扩展配置文件的 `chrome.storage.local`，访问级别限制为 `TRUSTED_CONTEXTS`；凭据不进入 Dexie、ZIP、快照或日志。
- `<prefix>/vault.json` 保存加密库描述，`<prefix>/vaults/<vaultId>/devices/<deviceId>/snapshot.enc` 保存加密快照，`<prefix>/vaults/<vaultId>/assets/<assetId>.enc` 保存逐文件加密媒体。
- 一个 prefix 对应一个同步库。更换提供方时先保留本机数据断开，再由用户检查并连接目标；不自动搬迁或删除原库。

## 条件写入、浏览器请求与失败

- 使用 AWS SDK for JavaScript v3 浏览器客户端，禁用 SDK 自动重试和区域跳转。媒体采用单对象 PUT，本轮不启用 multipart 或断点续传。
- 新媒体和库描述通过 `If-None-Match: *` 创建；设备快照通过 `If-None-Match: *` 首次发布、通过当前 ETag 的 `If-Match` 替换。S3 ETag 只是版本标识，内容 SHA-256 仍由 Orinui 校验。
- 连接检查验证 bucket 权限与原子条件写入。条件头不生效、ETag 不可读取、401/403、CORS 或网络失败都明确显示；不以先读后写替代原子条件，也不自动扩大来源权限或修改 CORS。
- 用户需自行在 bucket CORS 中允许扩展来源、已签名的 S3 请求头，并暴露 ETag；具体配置按所用 endpoint 的官方要求填写。失败时 Orinui 给出诊断，不调用服务商控制台 API。
- `XhrHttpHandler` 报告单个媒体 PUT/GET 的真实字节进度；解码、加密和 IndexedDB 事务分别显示阶段，不以文件个数代替字节进度。

## 容量预览与删除

- 容量预览分别显示本机媒体原件、本轮快照和媒体预计收发字节，以及远端当前 vault 对象的实际占用。未取得准确 Content-Length 时显示无法取得；不把字节数作为费用预测。
- 预览使用只读快照，不更改本机数据；预览与开始同步之间若数据改变，重新按执行时的状态计算。
- 远端删除前显示 bucket、prefix 和 vault 身份，并再次读取库描述验证身份与版本；在本机锁内按 `ListObjectsV2` continuation token 分页删除当前 vault 对象，验证清空后再删除对应库描述并复核。
- R2 的 `DeleteObject` 不假定有原子条件删除能力。用户须先停止其他设备同步。删除不是跨设备原子事务；任一步失败都会明确报错并保留本机数据及连接，供用户重试。
- 删除不触及 bucket、prefix 外对象或其他 prefix。忘记恢复密钥时，删除目标由本次检查得到的 vault ID、描述版本和连接配置绑定；任一项变化后旧目标失效，删除必须再次检查并经二次确认。

## 验收范围

自动检查覆盖输入校验、对象 key 隔离、条件创建/更新冲突、ETag、分页、元数据统计、进度和部分删除错误。S3 command 测试仅验证 SDK 调用映射，不替代真实服务。

真实扩展验收须使用已创建、配置好 CORS 的专用 R2 bucket/prefix 和两个隔离 Chrome 配置文件，验证 origin 权限、R2 条件写入及响应头可读、恢复密钥加入、未激活壁纸同步、容量预览、断网/拒权/412 错误、删除失败重试以及相邻对象保留。未获得 R2 凭据或真实服务验收时，不标为兼容通过。
