# 搜索与单行快捷工具

本轮方案经用户于 2026-10-19 确认。本文记录行为与数据契约；实际检查和验收范围以 [VERIFICATION.md](./VERIFICATION.md) 为准，不表示已经公开发布。

## 输入与隐私

- 输入期间只运行本地解析和索引检索，不请求搜索建议、GitHub API 或其他外部服务，不读取剪贴板、不保存查询历史。
- 全拼和首拼索引使用随包 `pinyin-pro`，首次使用本地检索时加载扩展自身资源；索引加载、读取失败明确显示，不伪造空结果成功。
- 普通文字默认使用所选引擎；结构明确的算式和颜色值可优先选择工具结果，仍提供网页搜索备选。裸数字只推荐时间戳解释，不抢占默认搜索。
- 显式工具命令进入工具模式；参数错误显示错误，不将原文自动发送给搜索引擎。关闭的显式工具命令显示已关闭。
- 导航、复制都需 Enter 或点击动作；复制成功反馈只在平台写入成功后显示。示例动作只回填输入，不导航、不复制。

## 搜索设置

搜索页包含搜索框、搜索行为、结果内容、搜索引擎四区；宽容器双列，窄容器单列，自定义引擎管理保持面板内二级页和返回焦点恢复。

| 字段 | 默认与规则 |
|---|---|
| width | 保留 narrow/standard/wide，对应 448/576/704px；默认 standard |
| autoFocus / openTarget | false / current-tab，与网站打开目标独立 |
| customization.corner | small/standard/pill 对应 8/16/24px；默认 standard |
| customization.surfaceOpacity | 默认 null，使用既有背景自适应表面；整数 0–100 手动覆盖背景 alpha，不改变文字 alpha |
| customization.placeholder | 默认“搜索、查找网站或计算”；单行纯文本，可留空，不存储输入查询 |
| customization.showSites / showFolders | 默认均 true，分别控制本地网站和文件夹结果 |
| customization.enabledTools | 默认全部启用：calculation、datetime、color、github |
| customization.engineKeywords | 默认空映射；引擎 ID → 单个关键词，trim 后不含空白和控制字符，大小写不敏感唯一 |

关键词不能与工具语法冲突，`gh` 始终保留给 GitHub 工具。内置引擎名称和模板固定，关键词独立可编辑；删除自定义引擎时同事务移除其关键词。删除默认引擎前仍须先切换默认值。

## 搜索路由与本地检索

- 配置引擎关键词后，例如 `wiki react`，只把 `react` 编码进该引擎的模板，不修改默认引擎。关键词缺少查询参数时提示输入内容。
- 明确 HTTP/HTTPS 地址或带点域名提供打开网址动作；无协议补 HTTPS。复用网站 URL 规则，拒绝凭据及非法协议；小数和算式不识别为域名。
- 网站索引包含显示名称、URL 和所属文件夹名称，文件夹索引包含名称。支持原文、全拼、首拼；评分依次为原文精确、前缀、包含、全拼、首拼，同分保持索引接收的既有顺序，不混用不同容器内的 order。
- 所有本地网站参与索引，不局限于主页；内容改变后重建索引，不在每次输入时重复转拼音。

## GitHub 命令

`gh` 或 `gh help` 展示功能示例；裸写 `owner/repo#123` 不触发工具。

| 命令 | 行为 |
|---|---|
| gh owner/repo | 默认打开仓库，同时提供 Issues、PR、Releases、代码搜索及 HTTPS/SSH 克隆命令复制动作 |
| gh owner/repo#123 | 打开 GitHub Issue 或 PR 编号，不获取标题或状态 |
| gh search 关键词 | GitHub 仓库搜索 |
| gh code owner/repo 关键词 | 构造限定仓库的代码搜索 |
| gh issues owner/repo [筛选词] | 无筛选打开 Issues；有筛选附加仓库与 Issue 类型条件 |
| gh prs owner/repo [筛选词] | 无筛选打开 PR 列表；有筛选附加仓库与 PR 类型条件 |
| gh releases owner/repo | 完整发布列表，包含预发布版本，不限定 latest 稳定版 |
| gh clone owner/repo | 默认复制 HTTPS 克隆命令，同时提供 SSH 格式，不执行命令 |

参数非法明确报错。本轮没有仓库别名、版本比较、Token/OAuth 或实时远程结果。登录与私有仓库权限由打开后的 GitHub 网页处理。

## 单行工具

- 计算：保留括号、正负号、科学计数法、四则运算和后缀百分号；`=` 显式触发。无 eval。
- 单位：保留同维度的长度、质量、时长、容量和温度换算。
- 颜色：HEX 3/4/6/8 位、RGB(A)、HSL(A)，显示色块并分别复制 HEX/RGB/HSL；HEX 输入默认复制 RGB，RGB/HSL 输入默认复制 HEX。颜色名称如 red 不自动匹配。
- 对比度：`对比度 #333333 #ffffff`；显示实际文字预览、比例、正文 AA/AAA 和大型文字 AA 判定。透明前景按背景合成，背景必须不透明，不假设白底。
- 当前时间：`ts now`，提供本地时间、ISO、Unix 秒/毫秒；时钟及时区由调用方注入，结果是当前输入时采样的快照。
- 时间戳：保留 `unix:<秒>`、`unixms:<毫秒>`，不靠位数猜测显式单位。
- 日期：`日期 2026-10-19 + 7天`，支持天/周加减，显示日期与星期；`日期差 2026-10-19 2026-11-01` 按后减前返回有符号日历天数，不含端点加一。
- 时区：带显式时区的 ISO 时间 `to Asia/Tokyo`，严格验证真实日历日期和时区，禁止无效日期自动进位。
- 中文工具名展示可填入的示例；`?` 列出启用工具。上下键选择，Enter 执行动作；Esc 先收起结果、再清空输入，收起后 Enter 先恢复结果，避免执行隐藏选择。输入法合成期间不执行动作。

工具以稳定 ID 注册，结果动作也有独立 ID；解析器返回纯数据，不在领域层调用浏览器、网络或剪贴板。多格式结果在同一结果列表中提供，不引入 JSON 编辑、文本对比或多步处理工作区。

## 数据与兼容

- 新写入为 Dexie 12、ZIP 9、同步快照 11。新增偏好位于 `AppSettings.search.customization`，单独使用 `searchCustomization` 原子同步寄存器；原 `searchPreferences` 三个基础字段保持独立。
- Dexie 11→12 显式补默认设置和零时钟寄存器；保留领域 ID、现有寄存器、同步身份、generation、密钥和本机提供方凭据，失败事务回滚。
- ZIP 8 和同步快照 10 先按旧格式严格验证，再显式补新默认值并规范化为当前格式。旧快照的新寄存器逻辑时钟为零，不覆盖已经编辑的新配置。
- 并发删除自定义引擎时，合并会移除该引擎的关键词，并以本机设备 ID 和高于全部已观察时钟的新逻辑版本保存裁剪结果，避免同版本内容被改写。
- ZIP 9 和同步 11 缺字段或含未知字段均拒绝；本地当前设置缺字段也明确报错，不通过运行时默认值掩盖损坏。
- 旧分组数据库、ZIP 1–7、同步 1–9 和开发期 JSON 继续拒绝。旧客户端不支持新格式时明确失败，不自动清空、降级写入或重建远端库。
- Vault descriptor、ORINUI01 envelope 和 AAD 的加密版本保持 1；不轮换密钥或改变 vault/device 身份。

## 调研依据

设置和快捷入口参考 [Bonjourr 设置](https://bonjourr.fr/docs/reference/settings-reference/)、[Alfred 搜索](https://www.alfredapp.com/help/features/web-search/)、[uTools 功能指令](https://www.u-tools.cn/docs/guide/what-is-keyword.html)和 [Raycast 计算与颜色](https://manual.raycast.com/calculator)。GitHub 查询参考其[代码搜索](https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax)和 [Issue/PR 搜索](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)文档；对比度采用 [WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。这些参考不改变 Orinui 输入期间不联网的边界。
