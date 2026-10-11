# UI 设计验证

记录日期：2026-10-11。对照已确认的 [VISUAL-SPEC.md](./VISUAL-SPEC.md)，先记录首轮问题，再记录本批修复与复验；保持既定视觉方向。

当前结论：下表中的六项首轮问题已修复，并通过当前构建的截图与浏览器回归。默认中性主页保持原样；自定义背景采用局部可读性底层。完整的读屏器、触摸设备和全部照片验收仍不在本批证明范围。

## 修复与复验结果

可读性令牌独立于动态种子色：自定义照片/纯色/渐变在时钟、日期、名称、分组及小按钮附近使用 98% 暖中性表面，前景与主题配对。网站整格仍保持透明；组角色用彩色细线保留，焦点用双层轮廓，照片遮罩与背景设置不改写。默认背景关闭局部底层。

| 原问题 | 最终结果 |
|---|---|
| 55% 照片遮罩的小字对比 | 浅色黑图 2.626 → 7.971:1；深色白图 2.580 → 10.773:1；条纹暗区 7.971:1 |
| 关闭动态配色的极性错误 | 浅色黑底时钟 1.157 → 12.513:1；深色白底时钟 1.120 → 16.977:1 |
| 强反差渐变/控件对比 | 渐变小字最低 1.259 → 7.902:1；浅色黑底当前组/编辑图标 12.513:1，深色白底 16.977:1 |
| 320px 时钟选项裁切 | 活动面板 scrollWidth=clientWidth=240；“跟随系统”“12 小时”“24 小时”完整显示 |
| 320px 取色弹层越界 | 弹层宽 192px，x104–296，完整位于 x80–320 的抽屉内 |
| 英文关闭名称、全部属性过渡 | 抽屉/对话框关闭名称为“关闭”；tabs 明确使用颜色与下划线透明度过渡 |

UI 修复批次验证（2026-10-11）：`pnpm compile`、26 文件/247 项单元测试、`pnpm build` 通过；Chrome 普通网页回归为 5 文件/44 项，其中新增 14 项真实截图像素对比与 3 项窄屏/键盘用例。单测总数变化来自删除旧平均亮度/极性规则的用例，并用 9 项当前颜色规则与黑白极值对比检查替换原来的 13 项颜色用例；同步和存储测试没有删减。

另在最终构建的隔离 Chromium 153 扩展中重跑首轮 UI 矩阵、200% 原生缩放与焦点检查。最终扩展检查没有页面异常或 HTTP/HTTPS 请求。对比截图只隐藏字形，保留真实局部底层；按计算前景色与底层像素计算比值。

修复后截图：[条纹照片](./ui-review/fixed-photo-stripes-light-mask55.png)、[黑色背景/动态色关闭](./ui-review/fixed-solid-black-dynamic-off.png)、[强反差渐变](./ui-review/fixed-gradient-black-white.png)、[320px 布局](./ui-review/fixed-drawer-布局-320.png)、[320px 取色](./ui-review/fixed-color-picker-320.png)。原始复验数据在 `.output/ui-review-fixed`；下方首轮截图保留为修复前证据。

## 环境与方法

- 先用 Chrome HTTP 预览排查，再用本机已有的 Chromium 153.0.8010.12 加载 `.output/chrome-mv3`，所有最终截图与测量来自真实 `chrome-extension://` 页面。
- 使用独立临时浏览器配置；展示数据通过实际 JSON 导入界面写入该配置，包含 5 个分组、24 个网站、长名称与内置图标。没有写入用户 Chrome 配置或初始示例数据。
- 记录空状态、明暗主题、编辑模式、键盘菜单、设置五个分区、取色弹层，以及 1440/768/640/375/320 CSS px 视口。网站编辑对话框另检查 375×667、320×800、1366×768、640×450。
- 1280×900 视窗调用真实浏览器缩放到 200%，实测 `innerWidth=640`、`innerHeight=450`、`devicePixelRatio=2`。Chrome 内部 `chrome://newtab` 不允许该 API；缩放检查直接访问同一真实扩展页面。
- 对比度使用浏览器计算后的名义文字 RGB，与隐藏内容后背景截图的对应中心像素计算；组标签另外采样实际胶囊底色。该采样可证明反例，不代表全部图片、焦点环或控件都已满足 WCAG。
- 普通文本按 4.5:1、大号时钟按 3:1 检查，依据 [WCAG 2.2 对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。代码审查参照 [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)。

## 首轮已确认的问题（现已修复）

| 优先级 | 触发与实际表现 | 定位与证据 |
|---|---|---|
| P2 | 照片默认 55% 遮罩未保证小字可读性：浅色主题+黑图的日期/网站名称 2.626:1，深色主题+白图为 2.580:1；黑白条纹的暗区也复现 | [background-style.ts:51](../src/features/appearance/background-style.ts)、[apply-appearance.ts:56](../src/app/apply-appearance.ts)；[条纹背景截图](./ui-review/photo-stripes-light-mask55.png) |
| P2 | 关闭动态配色后，主页前景只跟随主题：浅色+黑纯色时钟 1.157:1，深色+白纯色时钟 1.120:1，几乎不可读 | [apply-appearance.ts:48](../src/app/apply-appearance.ts)；[黑背景截图](./ui-review/solid-black-dynamic-off.png) |
| P2 | 强反差渐变采用整屏统一前景；黑→白、白→黑时，部分网站名称最低 1.259:1。即使动态配色开启，纯色与主题相反时，当前分组标签仅 2.982:1/1.561:1，编辑图标仅 1.270:1/1.158:1 | [background-style.ts:78](../src/features/appearance/background-style.ts)、[SortableGroupTab.tsx:33](../src/features/groups/SortableGroupTab.tsx)、[GroupTabs.tsx:73](../src/features/groups/GroupTabs.tsx)；[渐变截图](./ui-review/gradient-black-white.png) |
| P2 | 320px 视口中布局页“24 小时”被裁切；抽屉宽 240px，面板 `scrollWidth=265`、`clientWidth=240`，需横向移动才能看到完整选项 | [ClockSettingsPanel.tsx:16](../src/features/settings/ClockSettingsPanel.tsx)、[SettingsSheet.tsx:30](../src/features/settings/SettingsSheet.tsx)；[布局截图](./ui-review/drawer-布局-320.png) |
| P3 | 320px 取色弹层宽 256px，左边界 x40，抽屉左边界 x80；弹层越出抽屉 40px。控件仍在视口内可操作，属于面板布局一致性问题 | [ColorPicker.tsx:89](../src/features/appearance/ColorPicker.tsx)；[取色截图](./ui-review/color-picker-320.png) |
| P3 | 中文界面中抽屉和对话框的关闭按钮可访问名称为英文 `Close`；设置 tabs 还使用 `transition-all`，应收窄为实际过渡属性 | [sheet.tsx:78](../src/components/ui/sheet.tsx)、[dialog.tsx:75](../src/components/ui/dialog.tsx)、[tabs.tsx:58](../src/components/ui/tabs.tsx) |

上表保留首次发现时的数值和源码定位，源码行号在修复后可能变化。当前修复和复验状态以本页顶部为准。

## 首轮已通过的检查

- 默认中性渐变：1440px 浅/深色主页无明显裁切；时钟、日期、搜索、分组和透明网站格子的层级符合规格。采样的时钟/日期/网站文字最低对比度分别为 7.869:1 和 9.046:1。
- 网站网格：1440/768/640px 为 6 列，375px 为 3 列，320px 为 2 列；页面自然纵向滚动，没有主页横向溢出，固定设置入口可见。
- 长网站名称按格子宽度截断，但链接保留完整可访问名称；多分组的标签行在窄屏可横向滚动。编辑模式的操作按钮与网站/分组保持同一整体。
- `/` 聚焦搜索；初始没有自动聚焦。`Shift+F10` 在网站链接上打开实际菜单，编辑等操作可见。
- 设置抽屉初始焦点进入选中的 tab；连续 35 次 Tab 均保留在抽屉内。Escape 关闭后回到设置按钮，768/375/320px 都复现。
- 320px 网站对话框可用 Tab 到达“保存”；该按钮实测位于 y696–732、视口高 800px，滚动后完整可见。四种对话框尺寸的内容均能纵向滚动。
- 原生 200% 缩放下主页与布局页无横向溢出；长面板纵向滚动。该检查不代替所有设备/视口组合。
- 减少动态效果时，主页使用 `home-content-fade`、`transform=none`；抽屉过渡缩短。分组切换的快速操作与减少位移已有 27 项网页回归套件中的专项覆盖。
- 在真实扩展关于页读取 `Orinui`、`版本 0.0.0`。最终扩展 UI 检查没有未捕获页面错误，也没有发起 HTTP/HTTPS 请求。

## 截图与原始测量

- [浅色主页](./ui-review/populated-light-1440.png)、[深色主页](./ui-review/populated-dark-1440.png)、[编辑模式](./ui-review/edit-light-1440.png)、[320px 主页](./ui-review/populated-light-320.png)。
- [200% 缩放布局页](./ui-review/real-zoom200-layout.png)、[键盘到达保存](./ui-review/dialog-save-focused-320.png)、[真实关于页](./ui-review/extension-about-1440.png)。
- 原始 JSON 为本机产物，不入仓库：`.output/ui-review/measurements.json`（抽屉/焦点）、`cases.json`（展示/背景）、`interaction.json`（缩放/键盘/动效）、`contrast.json`（文字对比）、`control-contrast.json`（控件对比）。

本页引用的代表截图保存在 `docs/ui-review`，可随文档保留。原始 JSON 和临时检查脚本保存在忽略的 `.output/ui-review`；重新构建/清理产物后，原始 JSON 链接可能需要重新生成。

## 验证边界

Browser 插件加载被 Windows `realpath EPERM` 阻止，未通过修改运行时绕过；改用项目 Playwright 和独立临时配置。当前 Playwright 所需的 Chromium 1248 修订版未安装，明确指定本机已有 1243 修订版，实际版本为 153.0.8010.12，没有下载浏览器或伪造扩展 API。扩展加载方法依据 [Playwright 官方说明](https://playwright.dev/docs/chrome-extensions)。

首次 HTTP 预览点击关于页时出现 `getManifest` 缺失并使页面空白，这是普通网页缺少扩展运行时的边界；真实扩展中的关于页通过。没有为此新增伪造版本或静默降级。

本轮未验证实际屏幕吸管、图片来源权限与下载、读屏器完整朗读、触摸设备、全部照片组合或发布性能；这些状态保持待验收。
