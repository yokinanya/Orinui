# 当前工程架构

本文描述已实现的代码。未来同步设计单独见 [SYNC-DESIGN.md](./SYNC-DESIGN.md)；功能进度见 [TASKS.md](./TASKS.md)，检查证据见 [VERIFICATION.md](./VERIFICATION.md)。

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
| `src/platform` | 唯一直接调用扩展 API、fetch、图片解码/画布及文件下载的边界 |
| `src/hooks` | 跨功能复用钩子，包括本地 Blob 对象 URL 生命周期 |
| `src/components/ui` | shadcn 组件，保留上游风格 |
| `src/styles` | 颜色、字号层次、圆角、动效与全局样式 |
| `src/lib` | 通用工具，不包含领域规则 |
| `public` | 随包静态资源 |

WXT 入口位于 `src/entrypoints`，`@/` 指向 src，public 位于仓库根目录。

## 平台接口

| 模块 | 当前职责 |
|---|---|
| `extension.ts` | 从 runtime manifest 读取名称/版本；需要真实扩展环境 |
| `navigation.ts` | 搜索和网站在当前标签页打开 |
| `eyedropper.ts` | 能力检查、调用吸管；取消返回 null，能力缺失或失败明确报错 |
| `images.ts` | 本地图片解码、尺寸检查、缩放/编码和照片取色 |
| `svg.ts` | 静态 SVG 几何/属性白名单与拒绝规则 |
| `remote-images.ts` / `remote-image-download.ts` | 用户操作中申请具体来源与响应头权限；注入网络/监听/锁/图片处理端口，逐跳下载、体积检查和跨来源确认 |
| `backup-file.ts` | JSON/Blob 编解码及本地文件读写 |
| `backup-download.ts` | 导出文件的浏览器下载与对象 URL 生命周期 |

已新增 sync-crypto、sync-codec、sync-images 平台模块，提供加密、字节格式与真实媒体校验；sync-lock 委托原生 Web Locks，content-motion 集中动态效果 API。当前没有 Identity、Drive、WebDAV 或自动同步调度模块。关于页已另在真实扩展检查，普通网页套件不覆盖平台信息。

## 本地数据与事务

当前 Dexie schema 为版本 3：

| 表 | 主键与索引 | 作用 |
|---|---|---|
| groups | id；order、isDefault | 分组与唯一默认组 |
| shortcuts | id；groupId、order | 网站及组内连续位置 |
| settings | 固定主键 app | 外观、搜索、布局、时钟设置 |
| assets | id；kind | 图片 Blob、尺寸、MIME 与可选来源 URL |
| sync_state | 固定主键 app | 库/设备身份、时钟/代次、默认组、接收标记及可选本机基线/运行/成功记录 |
| sync_records | id；kind、entityId | 字段寄存器、墓碑和短暂撤销图片缓存 |
| sync_keys | vaultId | 本机不可导出的 CryptoKey |

- 多表/多次写入使用单一读写事务；失败整体回滚。
- 领域校验在写入前执行；默认组不可删除，缺少默认组时报错，不静默补替。
- 排序维护集中在 order.ts。拖放使用 assignOrder 按传入数组顺序编号；renumber 先按现有 order 排序，不能用它替代拖放结果。
- 未发生移动时返回 null，避免无意义写入。
- 版本 1 → 2 迁移补齐外观字段并新增 assets，不重建现有网站和分组。
- 版本 2 → 3 只新增同步表；没有配置同步库时不捕获业务记录。DBCore 中间件把本机版本与领域写入原子提交，接收事务暂停捕获防回声。
- JSON 备份当前为版本 1，独立于 Dexie schema；没有旧 JSON 版本迁移器。

完整规则与限额见 [DATA-CONTRACT.md](./DATA-CONTRACT.md)。

## 界面数据桥

DataProvider 注入数据库，由 use-data-state 加载状态、data-commands 绑定仓储操作。

启动先 ensureInitialized，读取设置及分组，选择默认组。网站按当前分组加载。写入成功后刷新受影响的本地状态；表单错误在字段处显示，其他失败通过提示条显示，初始化失败进入明确错误状态。

主题模式已经持久化。theme.ts 监听系统偏好，apply-appearance.ts 按保存的 system/light/dark 设置应用主题，并统一写入或移除背景与动态令牌。

主页阅读层独立于动态种子：纯色/渐变启用局部中性表面，照片使用白字阴影/描边、透明文字区域和半透明磨砂控件，默认背景保留原构图。动态种子只影响强调/玻璃语义色，不推断整屏文字极性；照片遮罩与用户背景不改写。源码不进行逐元素背景采样，截图采样仅用于有限组合回归。

## 图片、资源与备份

- 编辑图片图标使用草稿，取消不写入；保存网站与图片、保存照片与背景设置均事务化。
- 替换独占图片时在事务中释放旧资源再检查容量；失败恢复原引用及 Blob。共享图片仍有引用时保留。
- 网站删除会返回当前会话的撤销快照，包括所需图片；撤销重新检查分组/容量并事务化恢复。
- use-local-image 读取本地 Blob，管理对象 URL、异步取消和读取/取色错误。
- use-image-source 管理已保存来源回填与输入草稿；use-shortcut-icon-source 读取资源来源并同步网站草稿，显式处理来源清除。表单初始化只在打开或切换实体/分组时执行，元数据刷新不重置其他草稿字段。下载成功后来源与本地图片一起保存，不引入新的存储表或 schema 迁移。
- SVG 不通过清洗后继续使用，而是拒绝白名单外的元素、属性和引用；接受内容栅格化为静态 PNG。
- 图片链接下载只在用户主动操作中联网，使用 omit credentials/no-referrer，并对每一跳阻止浏览器自动重定向。临时 webRequest 观察读取响应头中的 Location，领域层严格校验目标；同来源继续，跨来源交回界面确认并重新请求具体来源权限。同一链接通过原生独占锁串行观察，请求结束后移除监听，不常驻收集网络信息。
- Manifest 声明可选 HTTPS 与精确 localhost HTTP 来源，不安装时授予全部站点访问。私有 DNS 最终地址判定存在平台限制。
- 备份由 platform 编解码、domain 严格校验、storage 事务化替换；导入不重新下载来源 URL。

## 外观与交互实现注意事项

动态色只覆盖强调色和半透明表面，正文/错误色保留基础语义；自定义背景文字由独立主题阅读层保证对比，不再按整屏亮度推断前景。纯色直接取其颜色、渐变取中点，照片种子在本机计算；没有种子色时不覆盖动态令牌，图片读取/取色错误明确呈现。

颜色面板内部 HSV 保留浮点，保存为规范化 hex。测试覆盖采样色和全部灰阶；不将历史穷举或规范目标当成本次验收。高频选色写入通过 use-throttled-emit 合并，并在结束时提交尾值。

主页对象管理共用菜单内容，网站的右键菜单和编辑模式「⋯」调用同一套操作；分组仅保留标签右键/菜单键入口，去掉编辑态外框与三点。分组容器隐藏原生滚动条但保留横向滚动，编辑态标签接收触屏拖动。网站排序用 rectSortingStrategy，分组用 horizontalListSortingStrategy 并限制纵向移动。

键盘拖放用空格拿起/放下、Escape 取消，Enter 保留给对象自身动作；菜单提供不依赖拖动的排序路径。编辑模式状态由 ShortcutsRegion 持有。删除分组先查询数量再确认。

设置抽屉内边距位于滚动容器自身，避免 Switch 扩大的点击热区造成横向溢出。当前有抽屉/弹窗过渡；主页进入和分组内容切换通过 CSS/WAAPI 实现。数据桥用 loadedShortcutsGroupId 确认数组归属，丢弃过期请求；不重挂编辑区域，减少动态效果时只淡化。主页可读性与照片样式独立维护在 home-readability.css，由 globals.css 引入，避免全局样式文件超过工程规模限制。

## shadcn 与样式约定

components.json 手工维护，未通过 shadcn init 初始化。生成组件需要全局样式补齐：

- 引入 tw-animate-css。
- 使用基于根 dark 类的自定义 dark 变体。
- 保留 data-open/closed/checked/unchecked/selected/disabled/active/horizontal/vertical 变体。Base UI 使用 data-orientation，不能依赖原生 HTML orientation 属性。
- sheet.tsx 的右侧边框已移除，避免深色主题 currentColor 发丝线；其它上游代码尽量少改。

使用 shadcn CLI 添加或更新组件后，核对 cn 是否误导入为同名包，应指向 `@/lib/utils`；移除误装的 cn 依赖，并检查本地 sheet 改动是否被覆盖。

网站网格采用固定格子宽度的换行布局，使不足一行的网站居中；容器上限对应六列。布局插槽设置只支持显示与上下移动，与网站/分组的拖动编辑是不同操作。

网站编辑在横屏 md 及以上使用加宽双列，头部与保存/取消不进入内容滚动区。内置图标选择组合现有 Popover 与 ToggleGroup，选项仅显示图形；紧凑上传仍使用真实文件输入，由可见按钮触发，隐藏文件输入不占 Tab 停靠点。

## 测试和未验证边界

Vitest 通过 fake-indexeddb 测试领域规则、持久化、事务回滚、资源和备份。每个数据库测试使用独立名称。scripts/run-tests.mjs 对整个单元测试进程设置 60 秒超时。

Playwright 使用 Chrome channel 访问构建产物的 HTTP 网页预览；它不是已加载的 Chrome 扩展。真实权限、EyeDropper 实际屏幕和 runtime manifest 等待扩展验收。

当前构建有大代码块警告，首屏性能尚未验收；UI 有限背景组合已修复并复验，不表示全部照片达标。具体结果与包体积集中维护在 VERIFICATION.md。

## 同步实现边界

提供方、媒体范围、端到端加密和高层合并方向已经选定，但当前应用仍无外部同步连接。已实现基础层和手动协调器；基础 API 见 SYNC-PROTOCOL.md，公共端口/执行顺序见 SYNC-COORDINATOR.md。

domain/sync 定义协议、对象边界校验和合并规则，storage/sync 管理状态/版本与短事务，sync 注入这些依赖协调手动操作，platform 管理原生锁/加密/媒体。请求与计算在事务外；本机完整提交先于上传/条件发布，后续新编辑保留更高代次并返回 pending。运行身份与基线独立于发布成功，集成测试不代表云端验收。
