# 当前工程架构

本文描述当前代码职责；2026-10-19 搜索升级与此前文件夹界面已实现，自动检查、受控扩展检查和用户验收分别记录。未来同步设计单独见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)；功能进度见 [TASKS.md](./TASKS.md)，检查证据见 [VERIFICATION.md](./VERIFICATION.md)。

## 工具链

| 职责 | 当前实现 |
|---|---|
| 扩展与构建 | WXT + Vite，Chrome Manifest V3；源码根为 src |
| 界面 | React + TypeScript |
| 样式 | Tailwind CSS v4，统一语义令牌 |
| 组件 | shadcn/ui，Base UI / base-luma；组件源码保存在仓库 |
| 图标 | lucide-react；随包图形使用固定 ID |
| 排序 | dnd-kit core、sortable、utilities |
| 动态色 | Material color utilities，在本机生成令牌 |
| 中文检索 | pinyin-pro，随包本地词典，首次本地检索时按需加载 |
| 动效 | CSS transition 与 tw-animate-css |
| 状态 | React Context/hooks；未引入 Zustand |
| 数据 | Dexie / IndexedDB |
| 检查 | TypeScript、Vitest、fake-indexeddb、Playwright |

不引入 Material Web 组件；动态色库只负责颜色计算。系统字体栈不依赖远程字体。

## 模块职责

| 目录 | 职责与边界 |
|---|---|
| `src/entrypoints/newtab` | HTML 与 React 挂载 |
| `src/app` | 页面、背景、主题和数据桥；注入仓储操作 |
| `src/domain` | 类型、校验、限制与纯规则，不依赖 React 或浏览器 API |
| `src/storage` | Dexie 表、仓储、排序和事务；通过参数接收数据库 |
| `src/sync` | 公共对象端口和手动同步用例；注入存储/锁/加密/算法，不包含具体网络提供方 |
| `src/features` | 功能界面，通过 useData 读取数据和调用操作，不直接访问 Dexie |
| `src/platform` | 唯一直接调用扩展 API、fetch、图片解码/画布及文件下载的边界；WebDAV 请求与精确来源权限也集中于此 |
| `src/hooks` | 跨功能复用钩子，包括本地 Blob 对象 URL 生命周期 |
| `src/components/ui` | shadcn 组件，保留上游风格 |
| `src/styles` | 颜色、字号层次、圆角、动效与全局样式 |
| `src/lib` | 通用工具，不包含领域规则 |
| `public` | 随包静态资源 |

WXT 入口位于 `src/entrypoints`，`@/` 指向 src，public 位于仓库根目录。

搜索规则见 [SEARCH-DESIGN.md](./SEARCH-DESIGN.md)。`domain/search-query` 负责关键词和网址路由，`local-search` 接收注入的转拼音函数建立只读索引；`search-tools` 注册纯工具解析器，时间与时区通过上下文注入。搜索功能层负责索引生命周期、结果组合、键盘/输入法和渲染，执行器注入导航与剪贴板端口。`app/preference-commands` 在事务内写入设置，新搜索偏好使用独立同步寄存器。

## 平台接口

| 模块 | 当前职责 |
|---|---|
| `extension.ts` | 从 runtime manifest 读取名称/版本；需要真实扩展环境 |
| `navigation.ts` | 搜索目标标签页由用户设置；网站使用原生链接设置目标并保留浏览器修饰键行为 |
| `eyedropper.ts` | 能力检查、调用吸管；取消返回 null，能力缺失或失败明确报错 |
| `images.ts` | 本地图片解码、尺寸检查、缩放/编码和照片取色；安全 SVG 图标保留矢量内容，背景处理为栅格输出 |
| `svg.ts` / `svg-style.ts` / `svg-stylesheet.ts` / `svg-references.ts` | 静态 SVG 白名单、内联/简单内嵌 CSS 的级联转换、XML/XLink 归一化及内部资源引用/循环检查；未知或危险内容明确拒绝 |
| `svg-image.ts` | SVG 输入校验后的图片归一化与 XML 序列化；为尺寸和缺失 viewBox 补齐规范值 |
| `remote-images.ts` / `remote-image-download.ts` | 用户操作中申请具体来源与响应头权限；注入网络/监听/锁/图片处理端口，逐跳下载、体积检查和跨来源确认 |
| `backup-file.ts` | `fflate` 流式 ZIP 编解码、manifest/原始媒体校验及本地文件读写 |
| `backup-download.ts` | 导出文件的浏览器下载与对象 URL 生命周期 |
| `media.ts` / `media-frame.ts` | MP4/WebM/GIF/动画 WebP 内容识别与浏览器解码；动态封面生成及接收时重建 |
| `clipboard.ts` | 用户点击后写入系统剪贴板；能力缺失或写入拒绝直接报错，不读取剪贴板或自动复制 |

已新增 sync-crypto、sync-codec、sync-images 平台模块，提供加密、字节格式与真实媒体校验；动态媒体同步保存原始 Blob 并逐文件 AES-GCM 加密，poster 由接收端重建为本地缓存。sync-lock 委托原生 Web Locks，content-motion 集中动态效果 API。`platform/webdav-client`、`webdav-protocol`、`webdav-xml` 与 `webdav-store` 实现 HTTPS WebDAV 请求、PROPFIND 解析、默认强 ETag 条件存取和坚果云专用 SHA-256 回读兼容模式；`webdav-settings` 管理精确来源权限和当前配置文件的本机凭据。自动触发与待删除到期调度位于同步应用层。Drive/Identity 仍未接入。WXT `build:publicAssets` hook 将根目录单一来源的 GPL `LICENSE` 复制到扩展输出目录；第三方许可清单由 public 资源随包输出。关于页需在真实扩展检查，普通网页套件不覆盖 runtime manifest。

## 本地数据与事务

当前 Dexie schema 为版本 12；ZIP formatVersion 9 与同步 schema 11 独立于 Dexie schema。仅对当前 Beta 2 的 Dexie 11、ZIP 8 和同步 10 提供显式升级，见 [搜索设计](./SEARCH-DESIGN.md)。主页个性化设置与文件夹/网站层级分别保存。

| 表 | 主键与索引 | 作用 |
|---|---|---|
| folders | id；order | 一层文件夹，作为主页网格条目 |
| shortcuts | id；folderId、order | 网站；folderId=null 表示主页网格，非空表示所属文件夹 |
| settings | 固定主键 app | 外观、搜索、网站显示、布局、时钟设置 |
| assets | id；kind | 静态图片/图标或动态媒体 Blob、尺寸、MIME 与可选来源 URL；poster 为动态媒体的本地缓存 |
| sync_state | 固定主键 app | 库/设备身份、时钟/代次、接收标记及可选本机基线/运行/成功记录 |
| sync_records | id；kind、entityId | 字段寄存器、墓碑和短暂撤销图片缓存 |
| sync_keys | vaultId | 本机不可导出的 CryptoKey |

- 多表/多次写入使用单一读写事务；失败整体回滚。
- 领域校验在写入前执行；文件夹可删除；删除时同一事务把其中网站移回主页，不丢弃网站数据。
- 排序维护集中在 order.ts。拖放使用 assignOrder 按传入数组顺序编号；renumber 先按现有 order 排序，不能用它替代拖放结果。
- 未发生移动时返回 null，避免无意义写入。
以下 1–8 为历史升级行为，不表示当前 Dexie 12 接受旧分组数据库：

- 版本 1 → 2 迁移补齐外观字段并新增 assets，不重建既有网站。
- 版本 2 → 3 只新增同步表；没有配置同步库时不捕获业务记录。DBCore 中间件把本机版本与领域写入原子提交，接收事务暂停捕获防回声。
- 版本 3 → 4 不改表/索引；将旧网站图标像素尺寸迁移为占比，并同步规范化本地同步寄存器中的图标值。
- 版本 4 → 5 不改表/索引；为时钟、布局、搜索和网站偏好补新增字段默认值，并为新同步寄存器使用零逻辑版本，保留既有逻辑版本。已连接同步的旧库在同一升级事务中暂时暂停变更捕获，迁移完成后恢复原暂停状态；失败则整笔回滚。旧设置仍经过领域校验，损坏数据会使迁移失败。
- 版本 5 → 6 不改表/索引；为旧布局和对应本地同步寄存器加入 `style: centered`，保留区域设置与逻辑版本。版本 6 → 7 将旧 `toolbar`/`sidebar` 映射到新命名布局，并补 `clockPosition: left`；版本 7 → 8 为设置和同步布局寄存器添加 `hideGroupNameWhenSingle: false`。迁移时暂停并恢复既有同步捕获状态，损坏值使整笔迁移回滚。
- ZIP formatVersion 8 使用 folders/folderId 清单；旧 formatVersion 2–7 的 groups/groupId 数据明确拒绝，不能静默合并成一个文件夹。同步 schema 10/11 使用 folder 实体与 folderId placement；旧 schema 1–9 格式拒绝，不能清空或重映射远端状态。Dexie schema 11 遇到旧分组数据明确拒绝，不把网站搬到主页后清空旧表，不自动清理数据、同步身份或密钥；用户接受主动卸载重装旧版本，但不授权自动重置。Beta 1 ZIP v1、开发期 JSON 与旧 wire formats 保持拒绝。

完整规则与限额见 [DATA-CONTRACT.md](./DATA-CONTRACT.md)。

## 界面数据桥

DataProvider 注入数据库，由 use-data-state 加载状态、data-commands 绑定仓储操作。布局样式、时钟角落、区域、时钟、搜索和网站偏好都按字段补丁更新，在仓储事务中与当前设置合并。居中留白服从保存的区域顺序；顶部工作台与左侧锚点使用固定区域位置，排序控件会明确禁用。

启动先 ensureInitialized，读取设置、文件夹与主页网站。文件夹弹层按需读取其网站。写入成功后刷新受影响的本地状态；表单错误在字段处显示，其他失败通过提示条显示，初始化失败进入明确错误状态。

主题模式已经持久化。theme.ts 监听系统偏好，apply-appearance.ts 按保存的 system/light/dark 设置应用主题，并统一写入或移除背景与动态令牌。

主页阅读层独立于动态种子：纯色/渐变启用局部中性表面，照片使用白字阴影/描边、透明文字区域和半透明磨砂控件，默认背景保留原构图。动态种子只影响强调/玻璃语义色，不推断整屏文字极性；照片遮罩与用户背景不改写。源码不进行逐元素背景采样，截图采样仅用于有限组合回归。

同步删除墓碑永久保留，不按 TTL 或离线时长裁剪。接收时，仍指向已删除文件夹的网站派生到主页，不改写 placement 寄存器、逻辑版本或设备身份；正常本地删除文件夹的显式网站移动与此派生步骤不同。

## 图片、资源与备份

- 编辑图片图标使用草稿，取消不写入；保存网站与图片、保存照片与背景设置均事务化。
- 替换独占图片时在事务中释放旧资源再检查容量；失败恢复原引用及 Blob。共享图片仍有引用时保留。
- 网站删除会返回当前会话的撤销快照，包括所需图片；撤销重新检查目标容器/容量并事务化恢复。
- use-local-image 读取本地 Blob，管理对象 URL、异步取消和读取/取色错误。
- MP4、WebM、GIF、动画 WebP 只从本地文件导入；平台按内容签名和真实浏览器解码校验，不因扩展名或错误 MIME 假定格式，不自动转码。动态视频静音循环，动图保留原始多帧数据。
- 动态媒体封面由首帧生成，最长边不超过 1280px，保存在本地资产记录；备份和同步传原始二进制，恢复/接收后重新生成封面。动态播放不逐帧提取主题色。
- 动态播放控制响应系统减少动态效果、页面可见性和窗口焦点；页面/窗口失焦时暂停，只在焦点恢复后恢复此前具有播放意图的媒体。手动暂停按素材 ID 保存在本设备 `chrome.storage.local`，不进入 ZIP 或同步；播放、读取或解码错误向用户明确呈现。
- 背景照片和动态媒体作为本地素材库记录保留；切换背景不释放旧背景。只有显式删除、本地重置或完整 ZIP 替换会移除背景资源；网站图标仍按引用关系清理。
- 主页先发布本地照片或动态封面对象 URL，再独立提取动态色；动态色关闭时跳过取色。取色只对保比例、最长边 128px 的采样图运行 Material 色彩量化，避免扫描整张高分辨率照片阻塞背景显示；取色失败单独显示错误。
- use-image-source 管理已保存来源回填与输入草稿；use-shortcut-icon-source 读取资源来源并同步网站草稿，显式处理来源清除。表单初始化只在打开或切换实体/文件夹时执行，元数据刷新不重置其他草稿字段。下载成功后来源与本地图片一起保存，不引入新的存储表或 schema 迁移。
- SVG 不通过清洗后继续使用，而是拒绝白名单外的元素、属性和引用；照片背景栅格化为静态 PNG。安全图标以 `image/svg+xml` 保存为规范化 XML：显式设置最长边不超过 1024 的宽高，缺少 `viewBox` 时按原尺寸补入 `0 0 <width> <height>`，由 XMLSerializer 序列化；保留允许的矢量几何与展示属性，不保证原字节相同。图标 MIME 在领域、资源存储、ZIP 备份与同步校验；提供 `ShortcutIcon.color` 时用本地 CSS mask 整体着色，无值则用原 SVG 图片显示。
- 图片链接下载只在用户主动操作中联网，使用 omit credentials/no-referrer，并对每一跳阻止浏览器自动重定向。临时 webRequest 观察读取响应头中的 Location，领域层严格校验目标；同来源继续，跨来源交回界面确认并重新请求具体来源权限。同一链接通过原生独占锁串行观察，请求结束后移除监听，不常驻收集网络信息。
- Manifest 声明可选 HTTPS 与精确 localhost HTTP 来源，不安装时授予全部站点访问。私有 DNS 最终地址判定存在平台限制。
- ZIP 备份由 platform 流式逐资源编解码、domain 严格校验、storage 事务化替换；manifest formatVersion 为 9，全部背景素材原件和被引用的网站图标位于 `assets/<assetId>` 并带长度与 SHA-256。导入须整包验证后预览和确认，不重新下载来源 URL；开发期 JSON 与 Beta 1 ZIP v1 均不兼容。
- 静态图片继续保留单文件 10 MiB 及既有像素/输出规则。取消 50 MiB 本地媒体总量和 70 MiB JSON 文件限制；不设动态视频应用级单文件大小或时长上限。实际浏览器配额、文件 API 或解码容量失败必须明确显示。

## 外观与交互实现注意事项

动态色只覆盖强调色和半透明表面，正文/错误色保留基础语义；自定义背景文字由独立主题阅读层保证对比，不再按整屏亮度推断前景。纯色直接取其颜色、渐变取中点，照片种子在本机计算；没有种子色时不覆盖动态令牌，图片读取/取色错误明确呈现。

颜色面板内部 HSV 保留浮点，保存为规范化 hex。测试覆盖采样色和全部灰阶；不将历史穷举或规范目标当成本次验收。高频选色写入通过 use-throttled-emit 合并，并在结束时提交尾值。

主页对象管理共用菜单内容，网站与文件夹的右键/菜单键和编辑模式「⋯」提供可聚焦操作。一层文件夹与主页网站在同一网格平铺，文件夹在前、网站在后，文件夹与网站分别排序，不支持跨类型任意排序，不使用分组标签、主页导航栏或侧栏；文件夹弹层显示其网站，移动网站通过移入文件夹/移回主页操作。

键盘拖放用空格拿起/放下、Escape 取消，Enter 保留给对象自身动作；菜单提供不依赖拖动的排序路径。编辑模式状态由主页组合层持有。删除文件夹先查询网站数量并确认，事务内把网站返回主页，不级联删除网站。

设置面板使用模态 Dialog，左侧分区标签仅属于设置面板，不是主页侧栏。右侧使用轻边框分区与主题/布局/背景可视选项；壁纸库和自定义引擎编辑在面板内二级页完成，提供返回入口，不另开层层弹窗。壁纸选中只是界面状态，较大详情预览通过显式“应用”写入当前背景。网站实时预览来自草稿；“保存并继续添加”保存成功后保留目标文件夹、重置本条内容，失败时保留草稿并明确显示错误。主页与文件夹弹层遵循同一网格/菜单和减少动态效果规则。

## shadcn 与样式约定

components.json 手工维护，未通过 shadcn init 初始化。生成组件需要全局样式补齐：

- 引入 tw-animate-css。
- 使用基于根 dark 类的自定义 dark 变体。
- 保留 data-open/closed/checked/unchecked/selected/disabled/active/horizontal/vertical 变体。Base UI 使用 data-orientation，不能依赖原生 HTML orientation 属性。
- sheet.tsx 的右侧边框已移除，避免深色主题 currentColor 发丝线；其它上游代码尽量少改。

使用 shadcn CLI 添加或更新组件后，核对 cn 是否误导入为同名包，应指向 `@/lib/utils`；移除误装的 cn 依赖，并检查本地 sheet 改动是否被覆盖。

主页网站与文件夹共用页面宽度，格子按列数均分；窄屏网格可横向滚动但页面不溢出。布局插槽仅 `clock`、`search`、`shortcuts`，插槽设置与主页对象管理分离，不保留分组导航区域。

网站编辑在横屏 md 及以上使用加宽双列，头部与保存/取消不进入内容滚动区。内置图标选择组合现有 Popover 与 ToggleGroup，选项仅显示图形；紧凑上传仍使用真实文件输入，由可见按钮触发，隐藏文件输入不占 Tab 停靠点。

## 测试和未验证边界

Vitest 通过 fake-indexeddb 测试领域规则、持久化、事务回滚、资源和备份。每个数据库测试使用独立名称。scripts/run-tests.mjs 对整个单元测试进程设置 60 秒超时。

Playwright 使用 Chrome channel 访问构建产物的 HTTP 网页预览；它不是已加载的 Chrome 扩展。2026-10-14 用户确认当前 UI、现有功能扩展权限和 EyeDropper 验收完成；runtime manifest 已有真实扩展检查。用户确认与自动测试的范围分别记录在 VERIFICATION.md。

当前构建有大代码块警告，首屏性能尚未验收；UI 有限背景组合已修复并复验，不表示全部照片达标。具体结果与包体积集中维护在 VERIFICATION.md。

## 同步实现边界

提供方、媒体范围、端到端加密和高层合并方向已经选定。同步基础层、手动协调器和 WebDAV 提供方已实现；本轮加入全背景素材与删除墓碑，并增加 S3 提供方。Cloudflare R2 是首个实际兼容验收目标；真实 R2 和窗口焦点验收尚待完成。Beta 1 动态媒体同步审计的限制见 [Beta 发布记录](./BETA-0.1.0.md)。基础 API 见 SYNC-PROTOCOL.md，协调流程见 SYNC-COORDINATOR.md，WebDAV 和 S3 细节分别见 SYNC-WEBDAV.md 与 SYNC-S3.md。

domain/sync 定义协议、对象边界校验和合并规则，storage/sync 管理状态/版本与短事务，sync 注入这些依赖协调手动操作，platform 管理原生锁/加密/媒体。请求与计算在事务外；本机完整提交先于上传/远端发布，后续新编辑保留更高代次并返回 pending。发布保护由提供方模式决定；运行身份与基线独立于发布成功，集成测试不代表云端验收。
