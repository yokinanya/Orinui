# 架构说明

> 记录工程层面的既定选择与理由。产品与视觉规则见 [VISUAL-SPEC.md](./VISUAL-SPEC.md) 与 [DATA-CONTRACT.md](./DATA-CONTRACT.md)。

## 工具链

| 选择 | 内容 | 理由 |
|---|---|---|
| 构建 | WXT + Vite | 处理 Manifest V3、入口与打包，目标浏览器切换成本低 |
| 界面 | React + TypeScript | 与组件库生态一致，类型检查守住数据契约 |
| 样式 | Tailwind CSS v4 | 与设计令牌配合，避免散落的样式文件 |
| 组件 | shadcn/ui，`base-luma` | 组件以源码形式进入仓库，可局部调整；luma 的圆润与留白贴合视觉规格 |
| 图标 | lucide-react | 组件库默认图标集，体积可控 |
| 拖动排序 | `@dnd-kit/core` + `@dnd-kit/sortable` | 官方维护、无 jQuery 依赖；同时提供指针与键盘传感器，拖动不是唯一排序路径 |
| 字体 | 系统字体栈 | 不远程加载字体，减少首屏开销并保护隐私 |
| 包管理 | pnpm | 依赖体积与安装速度更优，锁文件可复现 |

不使用 `@material/web`：Web 端已进入维护状态，且新标签页需要的是令牌体系而非 Material 组件外形。

## 目录职责

| 目录 | 职责 | 约定 |
|---|---|---|
| `src/entrypoints/newtab` | 新标签页入口 | 只负责挂载与全局样式引入 |
| `src/app` | 页面组合、背景层、主题、数据桥 | 只有 DataProvider 允许同时接触数据层与界面 |
| `src/domain` | 领域类型与纯规则 | 无副作用、可单测，不依赖 React |
| `src/features/*` | 按功能划分的界面与交互 | 每个功能自成一个目录，通过 `useData()` 访问数据 |
| `src/platform` | 扩展 API、权限与导航的薄封装 | 唯一允许直接调用浏览器 API 的位置 |
| `src/components/ui` | shadcn/ui 生成组件 | 保留上游风格，改动越少越易升级 |
| `src/lib` | 通用工具（`cn`、提示条封装） | 不含业务规则 |
| `src/styles` | 设计令牌与全局样式 | 颜色、圆角、字体与 shadcn 所需变体只在这里定义 |
| `public` | 随包静态资源 | 扩展图标等无需构建处理的文件 |

WXT 的源码根目录设为 `src`，因此入口位于 `src/entrypoints`，`@/` 指向 `src`，`public/` 仍在仓库根目录。

## 设计令牌

`src/styles/globals.css` 定义两套语义变量：

- 基础角色：`background`、`foreground`、`card`、`popover`、`primary`、`secondary`、`muted`、`accent`、`destructive`、`border`、`input`、`ring`。
- 壁纸之上的专用角色：`glass`、`glass-strong`、`glass-border`、`glass-foreground`、`glass-foreground-muted`，以及 `wallpaper` 与 `wallpaper-mask`。

浅色为暖白、深色为石墨灰。动态取色接入后，运行时会覆盖强调色相关的变量，静态值作为取色失败时的回退，因此组件始终只引用语义令牌。

## 主题

`src/app/theme.ts` 按系统偏好切换根元素的 `dark` 类并监听变化。手动固定浅色/深色属于外观设置，接入持久化后在此扩展。

## 平台边界

`src/platform` 目前包含：

- `extension.ts`：读取扩展名称与版本，仅在设置抽屉打开时调用。
- `navigation.ts`：在当前标签页打开地址（搜索与快捷方式共用）。
- `eyedropper.ts`：屏幕吸管（EyeDropper API）。能力探测与“用户取消”分开：取消返回 `null`，能力缺失直接报错由界面决定是否显示入口。

只为已实现的功能建立封装，不预置未使用的 API 适配层。

## 数据层

`src/storage` 建立在 Dexie 之上，表结构见 `db.ts`：

| 表 | 主键与索引 | 说明 |
|---|---|---|
| `groups` | `id`，索引 `order`、`isDefault` | 默认分组通过 `isDefault` 标记，同一时刻只有一个 |
| `shortcuts` | `id`，索引 `groupId`、`order` | 组内位置从 0 连续编号 |
| `settings` | `id`（固定为 `app`） | 单行保存全部分区，结构随版本迁移 |
| `assets` | `id`，索引 `kind` | 本地图片二进制，图片总量上限 50 MiB（版本 2 新增） |

约定：

- 所有会改动多张表或多次写入的操作都包在 `db.transaction('rw', ...)` 中，失败即整体回滚。
- 校验在写入前完成；订单维护集中在 `order.ts`，位置始终保持连续，避免空洞与重复。
- `order.ts` 的 `assignOrder` 按数组下标编号，`renumber` 先按 `order` 排序再编号：拖动排序必须用前者——若先排序会按旧位置把刚做的移动还原回去。
- `moveTo` 在标识不存在或位置未变时返回 `null`，仓储据此跳过写入，不产生无意义的更新。
- 默认分组不可删除；分组数据缺少默认分组时直接报错，不静默顶替（详见 `ensureDefaultGroup`）。
- 仓储函数以数据库实例作为第一个参数，测试可以为每个用例创建独立数据库。

## 测试

使用 Vitest，Node 环境下通过 `fake-indexeddb` 提供内存 IndexedDB。

- `tests/domain`：纯规则测试（网址、文本、布局、搜索模板、设置校验）。
- `tests/storage`：事务行为、排序、上限、默认分组不变量、撤销与持久化。
- `tests/features`：与界面共用的纯逻辑（动态配色令牌、颜色换算）。
- `tests/platform`：平台封装的边界行为（吸管能力探测、取消与失败分类）。
- 每个用例使用独立数据库名，互不干扰。

`tests/storage/migration.test.ts` 覆盖版本 1 → 2 的迁移：保留已有主题、补齐新增外观字段、保留分组与网站数据。

## 界面与数据层的连接

`src/app/DataProvider.tsx` 是唯一同时了解数据层与界面的模块：

- 启动时调用 `ensureInitialized`，加载分组与设置，并选中默认分组。
- 切换分组时按需加载该组网站，不在内存里维护全部分组的内容。
- 写入方法直接复用 `src/storage` 的仓储函数，并在成功后刷新受影响的本地状态。
- 写入失败会向上抛出：表单把它显示在对应字段，其他操作交给提示条；只有初始化失败才让整页进入错误状态。

组件不直接调用 Dexie，只通过 `useData()` 使用数据与操作。

## 外观与动态配色

- `src/domain/appearance.ts` 定义主题、背景（默认/照片/纯色/渐变）与动态配色的数据模型和校验。
- `src/features/appearance/color-tokens.ts` 用 Material 官方算法（`@material/material-color-utilities`）从种子色生成令牌覆盖，只覆盖强调色与壁纸之上的半透明表面，不动大面积表面与错误色。
- 强调色跟随用户选择的深浅模式；壁纸之上的文字与半透明表面按**背景亮度**决定（`wallpaperPolarity`）。这是必要的：主题与背景可能互相冲突，若只按主题取色，浅色背景配深色主题会让主页文字看不清。
- 无法判断亮度时（照片、默认背景）回退到主题；照片背景由遮罩强度保护对比度。
- 冲突时界面给出文字提示，但不改写用户选择的颜色。
- `src/app/apply-appearance.ts` 是唯一把外观写到根元素的地方：切换 `dark` 类、设置 `--wallpaper*`，并按需写入或移除动态令牌。
- `src/features/appearance/ColorPicker.tsx` 是外观面板里唯一的颜色选择入口：圆形色板是弹层触发器，弹层内是饱和度/明度面板 + 色相条 + 十六进制输入 + 屏幕吸管。不使用原生 `input[type=color]`，因为它的弹窗由浏览器绘制、无法跟随应用样式；色板带显式尺寸，避免被 `Field` 的 `*:w-full` 拉伸成整行宽。
- `src/features/appearance/color-math.ts` 负责 hex 与 HSV 的换算。**HSV 保持浮点、不取整**：取整会让 `hex → HSV → hex` 产生最多 3/255 的通道漂移，用户只拖动色相也会让整个颜色偏移；取整只发生在显示与最终 hex 输出。全部 1677 万种颜色的往返一致性已穷举验证，测试覆盖采样空间与全部灰阶。
- `SaturationValueArea` 与 `HueBar` 共用 `use-drag-area.ts` 的指针拖动逻辑，并各自实现方向键操作。色相条没有套用通用滑块：色相条的轨道本身就是彩虹（通用滑块的输入色轨道与填充区间在这里没有意义），而且通用滑块只允许把可访问名称给到内部滑块，项目没有透出该参数。
- 拖动取色期间颜色变化很密，`src/hooks/use-throttled-emit.ts` 把它合并成低频写入，同时保留尾随提交与拖动结束时的立即落定，避免每一次 pointermove 都写一次数据库。

## 主页管理交互

网站与分组的操作入口在主页，不放在设置抽屉里：

- `src/features/shortcuts/ShortcutActionsMenu.tsx` 与 `src/features/groups/GroupActionsMenu.tsx` 各只写一份菜单内容，右键菜单与编辑模式下的「⋯」按钮共用它。这是可行的：Base UI 的 `ContextMenu.Item`／`Sub`／`Popup` 与 `Menu` 的对应部分是同一个组件（`context-menu/index.parts` 直接转发 `menu/*`），`ContextMenuRootContext` 也是可选读取，所以同一份内容在两种菜单根下都成立。
- 拖动排序用 `@dnd-kit`：网站网格用 `rectSortingStrategy`，分组标签用 `horizontalListSortingStrategy` 并配一个把纵向位移归零的内联 modifier，不额外引入 `@dnd-kit/modifiers`。
- 传感器统一为「指针距离 8px 才激活」+「键盘传感器」，所以点击仍然有效、拖动不是唯一排序路径。键盘传感器的按键映射改为「空格拿起／放下、Escape 取消」，把 `Enter` 留给对象自身的动作（分组标签用 Enter 切换分组），否则编辑模式下无法用键盘换组。
- 拖动热区：网站格子挂在格子内层，避免把「⋯」按钮嵌进 `role="button"` 的拖动元素里；分组标签的拖动属性直接挂在标签按钮上，因为标签本身既是拖动项也是切换入口——拆成外层容器加内层按钮会让同一个标签出现两个 Tab 停靠点。
- 分组标签行用 `closestCorners`（一维列表相交即切换目标），网站网格用 `closestCenter`。
- 编辑模式状态由 `ShortcutsRegion` 持有并向下传递（分组标签行与网格都需要），不引入额外的全局状态。
- 分组重命名与删除确认放在 `GroupDialogs.tsx`，删除确认在打开时查询组内网站数量。
- 设置抽屉面板的内边距放在滚动容器自身：Switch 用 `after:-inset-x-3` 扩大点击热区，若滚动容器比内容窄，这段装饰性热区会溢出内容盒并触发横向滚动。

## 样式注意事项

`components.json` 为手工维护，因此 shadcn 的初始化步骤没有执行过，`src/styles/globals.css` 需要手工补齐 shadcn 组件依赖的两项内容：

1. `@import 'tw-animate-css'`：提供 `animate-in`、`fade-in-0`、`zoom-in-95`、`slide-in-from-*` 等过渡工具类，抽屉、弹窗、菜单与提示依赖它们。
2. 自定义变体：`@custom-variant dark (&:is(.dark *))`，以及 `data-open`、`data-closed`、`data-checked`、`data-unchecked`、`data-selected`、`data-disabled`、`data-active`、`data-horizontal`、`data-vertical` 九个变体。**缺少它们会造成实际故障**：Base UI 用 `data-orientation` 表达方向，标签页因此退化成横向排列；`dark:` 也会错误地跟随系统偏好而不是根元素的类。

新增自定义工具类或变体前，先确认 shadcn 官方样式文件是否已定义同名项，避免重复或冲突。

`src/components/ui/sheet.tsx` 移除了 `data-[side=right]:border-l`：`border-l` 不带颜色时取 `currentColor`，深色主题下会变成一条近白色发丝线，比抽屉本身还抢眼。抽屉与页面之间已有遮罩与阴影，不需要这道线。这是对生成组件的少量本地改动，其余 side 的边框保持上游原样（项目只使用 `side="right"`）。

## shadcn CLI 使用注意

WXT 不在 shadcn 支持的框架列表内，因此 `shadcn init` 无法自动执行，`components.json` 为手工维护。使用 CLI 添加组件后需要检查：

1. 生成的导入是否被错误写成 `from "cn"`，应改为 `from "@/lib/utils"`。
2. 是否误装名为 `cn` 的 npm 依赖，需要移除。
3. 若 CLI 覆盖了本地改动过的组件文件，重新检查导入路径。

## 已记录的偏差

- 内置背景原本计划随包提供授权自然摄影，目前素材未引入，首页使用语义令牌中的中性渐变；引入授权素材后沿用同一令牌即可替换。
- 计划中的目录结构写为根目录 `entrypoints/`，实际采用 WXT 约定的 `src/entrypoints/`。
- 数据模型按阶段收窄：`ShortcutIcon` 目前只有 `letter` 与 `asset` 两种，内置图形与直链下载在对应功能落地时补充。设置分区已从早期的「主题/时钟/布局/搜索」收敛为抽屉里的「外观/布局/关于」，表结构随外观阶段升到版本 2（新增外观字段与图片资源表），迁移有测试覆盖。
- 分组语义色角色（`Group.colorRole`）已进入数据模型，但界面仍未使用：标签与选中态统一用主题强调色。动态配色已落地，若要按角色着色，需要先确认「分组色是按种子色生成的色板分配，还是用户可指定」。
- 网站网格没有采用等分 CSS 网格，而是固定格子宽度的换行布局：网站数量不足一行时整行保持居中，避免等分网格把前几个网站挤到最左侧；容器宽度上限 41rem 对应 6 列硬上限。
- 未使用的 shadcn 组件会在确认无用后删除，需要时再按 CLI 流程添加；`input` 与 `textarea` 因被 `input-group` 依赖而保留。
- 主页管理方式经过一次推翻：视觉规格原先写「主页不额外放编辑按钮，设置面板内进入编辑快捷方式模式」，现已改为右键菜单随时可用 + 标签行末尾「编辑」按钮切换编辑模式，设置抽屉只保留外观、布局与关于。

## 待观察项

- 首页生产包（未压缩）约 721 kB JS、93 kB CSS，主要来自 React、Base UI 组件与 `@dnd-kit`。首屏延迟与拆包（例如设置抽屉按需加载）将在发布验证阶段测量后决定，不提前宣称达标。
- 关于面板在纯网页预览（非扩展环境）下会因 `chrome.runtime` 不可用而报错；这是平台边界被正确暴露的表现，不作为回退逻辑处理。
- 屏幕吸管需要在真实 Chrome 扩展环境（`chrome-extension://` 页面）人工点一次，确认能力探测为真且取到的颜色正确；自动化测试只用桩覆盖了能力探测、取消与失败分类。
