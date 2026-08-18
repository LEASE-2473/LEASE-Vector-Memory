# 更改日志

## 2026-08-19 修复自动隐藏与冷热记忆注入位置 v4.3.2

- **用户目标**：修复 LEASE Vector Memory 的“保留最近 N 层”自动隐藏完全失效，以及热记忆表格、冷向量召回都被错误作为独立消息插到索引 1 的问题；以当前 `ST-Memory-Context-main` 和 gaigai 固定上游快照为对照恢复正确语义。
- **主要修改**：确认目标项目在删除 `summary_manager.js` 时误删了 `applyContextLimitHiding`、`silentHideMessages` 和隐藏索引检测，但 UI、消息完成、聊天切换、立即执行及发送前调用仍然保留，导致所有入口实际无实现可调。将三段实现迁回 `index.js` 并改用 `LeaseVectorMemory` 命名空间：只统计普通对话，排除 system、插件注入和手机消息，隐藏保留范围之前且尚未隐藏的楼层，更新 DOM 后调用 `saveChat()` 持久化。表格注入除用户已删除的总结表和实时填表外按 gaigai 固定上游恢复：固定 system role，先预扫描并抽出 `{{MEMORY_TABLE_表名}}`，再处理 `{{MEMORY_TABLE}}` 与 `{{MEMORY}}`，拆分原消息插入独立表格消息，恢复关闭锚点清洗、手机 `allowTable` 授权/禁用，以及 `[Start a new Chat]` 前、无分隔符索引 0 的默认位置。删除上游没有的最终请求归位器。冷向量保留用户指定差异：普通请求不合并进分隔符文本，而作为独立消息插在 `[Start a new Chat]` 前；显式 `{{VECTOR_MEMORY}}` 仍原位替换；Gemini 兜底完全保持上游实现，不额外优化。版本升至 4.3.2。
- **修改的文件**：`index.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 39/39 项，覆盖旧楼层筛选、隐藏持久化、显式表格锚点拆分、单表锚点优先级、手机 `allowTable`、上游默认表格位置，以及普通请求冷向量位于 `[Start a new Chat]` 前；`npm run check` 通过 6 个核心 JavaScript 语法检查；manifest/package 版本一致性和 `git diff --check` 通过。
- **未完成事项**：尚未在真实 SillyTavern 请求探针中观察 4.3.2 的最终 messages/contents，也未提交、推送或部署到扩展运行目录。
- **已知风险与后续建议**：表格无 `[Start a new Chat]` 时按上游放索引 0；冷向量无分隔符时使用深度、第一条普通对话前或末尾兜底。部署后应在调试面板确认表格/向量均位于分隔符前，并检查第 N+1 条普通对话生成后旧楼层出现幽灵隐藏标记。

## 2026-08-17 修复角色信息空主键与错误 R 连坐 v4.3.1

- **用户目标**：检查连续性记录中反复出现的“事务已拒绝：表2 R2不存在”，核对角色信息填表失败、默认提示词和上游行为，解释为什么界面只有 R1 却被判定 R2 不存在，并直接修复根因。
- **主要修改**：仅使用 Chrome 中 URL 精确为 `http://127.0.0.1:8000/` 的本地 SillyTavern 标签进行只读诊断，未操作另一个远端酒馆。控制台确认 v4.3.0 多次先把表2/3/6 的空表错误 update 转成 insert，再因表2 R2不存在整批拒绝；表格弹窗确认角色信息 R1 的角色名、身份和性格为空，只留下身体状态与当前目标。现场新行确为 R1，证明 v4.2.5 的工具栏清表计数器重置已经生效；本次并非 nextRowId 残留，而是模型在真空表上仍输出 update，旧兼容分支又无条件转 insert。根因是新向量提示词重度强调实体表 update，却遗漏上游“实体不存在必须 insert、首次角色必须填写第0列角色名”的关键分支，并只提供了不含角色名的角色 update 示例。提示词版本升至 8.0：直接把正文的“实体表严格全局唯一（updateRow）”改为“按主键新增或更新（存在 update，不存在 insert）”，补全表2规则、稳定 R 规则及首次新增/后续更新两个角色示例，并追加最高优先级实体协议覆盖两条追溯请求路径。空表 update 缺少第0列时不再自动造行；角色信息错误指向未来 R 时，执行器会在命令携带角色名的前提下按主键纠正到真实 R、修复唯一空主键旧行，或把真正的新角色安全转成 insert；无法证明目标时仍保持整批拒绝。审计同时把快照回档中遗留的直接 `sheet.r=[]` 旁路改为 `sheet.clear()`，保证所有整表清空语义统一重置计数器。版本升至 4.3.1。
- **上游对照**：固定上游快照的提示词明确要求首次角色使用 insert 并填写第0列角色名，且包含新增人物示例；其执行器逐条直接执行、没有 LEASE 的事务预检，所以错误更新通常静默漏写而不是弹出整批拒绝。上游较少出现该提示的主要原因是提示词分支更完整与失败静默，并非拥有稳定 R 防错能力。
- **修改的文件**：`index.js`、`backfill_manager.js`、`prompt_manager.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 32/32 项，新增覆盖空表缺主键拒绝、按角色名纠正错误 R、唯一空主键 R1 修复、新角色错误 update 转 insert，以及快照回档统一调用 `clear()`；`npm run check` 通过 6 个核心 JavaScript 语法检查；manifest/package 版本一致性检查为 `lease_vector_memory 4.3.1`；`git diff --check` 无空白错误，仅有工作区 LF→CRLF 提示。修复通过 GitHub PR #3 合入 `LEASE-2473/LEASE-Vector-Memory` 的 `main`；Chrome 仅操作 `http://127.0.0.1:8000/`，扩展管理器更新到 `main-ab1d0f1` 后整页刷新，启动日志显示 `LEASE Vector Memory v4.3.1`，顶部入口可见，管理器显示 4.3.1。另一个远端 SillyTavern 标签未操作。
- **未完成事项**：无。现有空主键 R1 仍需重新追溯一批，并由携带角色名的模型命令触发自动补齐；这是数据修复动作，不属于发布遗漏。
- **已知风险与后续建议**：角色主键纠错只针对“角色信息”表，且必须有非空第0列角色名；这避免按模糊内容误改其他实体表。若升级后的首次重试仍未携带角色名，事务会明确拒绝而不会继续污染数据；可改用单表重构角色信息，或手工把当前 R1 的角色名补为对应角色后再追溯。

## 2026-08-17 修复顶部入口再次消失 v4.3.0

- **用户目标**：修复本地 SillyTavern 更新至 v4.2.10 后，LEASE Vector Memory 顶部入口再次消失的问题。
- **主要修改**：通过用户当前打开的 `127.0.0.1:8000` 页面确认插件脚本已加载，但初始化在主题函数中抛出 `ReferenceError: book_surface is not defined`，因此入口尚未创建就已中断。将旧总结代码清理后残留的 `book_surface` 引用替换为现行固定列不透明背景 `stickyColumnBg`；同时隔离主题应用异常，即使今后单条主题样式失败，插件仍会继续创建顶部入口并完成初始化。新增针对残留变量和初始化隔离的回归测试，版本升至 4.3.0。
- **修改的文件**：`index.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：浏览器诊断确认本地页面加载 `/scripts/extensions/third-party/LEASE-Vector-Memory/index.js`，控制台唯一阻断错误定位到 `thm()` 中的 `book_surface`；`npm test` 通过 27/27 项；`npm run check` 通过 6 个核心 JavaScript 语法检查。发布后已在本地扩展管理器仅更新 LEASE Vector Memory，整页刷新后管理器显示 `4.3.0`，`#lvm-top-wrapper` 与 `#lvm-top-btn` 均已创建且可见。
- **未完成事项**：无。
- **已知风险与后续建议**：更新后若没有整页刷新，浏览器仍可能继续运行已加载的 v4.2.10 脚本；必须刷新页面才能执行新初始化代码。

## 2026-08-17 内置向量化精细追溯提示词 v4.2.10

- **用户目标**：将用户使用 Gemini 实测并根据复审意见修正的 `LEASE vectorprompt.md` 缝合为 LEASE Vector Memory 的默认历史追溯提示词，在不改动旧插件原 Markdown 的前提下发布到独立 GitHub 仓库。
- **主要修改**：把“向量化精细记忆版 v2”原文以 UTF-8/Base64 内置为默认提示词，提示词版本升至 7.9，使现有安装的内置默认方案自动刷新且不覆盖用户自建方案。去重改为仅以当前表格为准；主线与支线按独立事件/阶段积极分行；连续微转场和无中断跨零点可保留同一行；睡眠、散场、长时段跳跃和新目标必须分行；主线建议约 250~450 字、硬上限约 800 字，要求包含可脱离世界书理解的具体事实。保留用户约定的 `23:59` 标准完结时间戳。旧自定义提示词缺少新版规则时才追加 v7.9 兼容协议，避免内置默认正文重复叠加。v4.2.9 的自然日硬切方案未发布并被本版撤回。本次发布同时包含 v4.2.8 已完成的不可达旧总结界面与专属样式清理。
- **修改的文件**：`prompt_manager.js`、`backfill_manager.js`、`tests/core.test.mjs`、`index.js`、`style.css`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。旧插件目录中的 `LEASE vectorprompt.md` 只读取未修改，也不属于本仓库提交。
- **验证**：`npm test` 通过 26/26 项；`npm run check` 通过 6 个核心 JavaScript 语法检查；内置提示词与原 Markdown 逐字一致，SHA-256 为 `13c0738af6f48c87266b50bd12687b223e55ac32b15f54b8fd7fdef87336d0dc`；manifest/package 版本一致性检查结果为 `lease_vector_memory 4.2.10`；`git diff --check` 通过（仅提示未来可能进行 LF→CRLF 转换）。
- **未完成事项**：尚未在真实 SillyTavern 中调用 Gemini、Embedding 或 Rerank API 做端到端回归；现有已经写成长行的历史 R 行不会自动拆分，需要清表重新追溯或手工整理。
- **已知风险与后续建议**：模型最终分行仍受原聊天时间线清晰度影响；发布后建议用已测试过的同一段剧情重新追溯，对比新旧插件输出，并观察 250~450 字目标在实际模型中的稳定性。

## 2026-08-17 修复主线跨日无限追加 v4.2.9（本地未发布）

- **用户目标**：修复主线第二行从周一持续写到周五、来源区间和事件概要异常增长的问题，确认提示词是否存在错误。
- **主要修改**：确认 v7.6 追加规则把“同一核心目标和直接因果”置于日期边界之前，并允许继续覆盖结束时间，导致模型忽略原正文的跨天分行要求。提示词版本升至 7.7，把自然日设为主线绝对边界：日期或星期变化时，无论目标、人物和地点是否相同，都必须结束旧 R 并 `insertRow` 新 R；同一 R 的开始和结束时间只能属于同一天。单日内部继续按完整事件弧合并，避免变成每句话一行。新 v7.7 标记会被追溯的两条请求路径强制追加到旧提示词末尾，用户无需重置已有提示词。
- **修改的文件**：`prompt_manager.js`、`backfill_manager.js`、`tests/core.test.mjs`、`index.js`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 26/26 项，回归测试确认“自然日绝对边界”“周一到周五不可同一行”和两条追溯请求路径的兜底规则；`npm run check` 通过 6 个核心 JavaScript 语法检查；`git diff --check` 通过（仅提示未来可能进行 LF→CRLF 转换）。
- **未完成事项**：现有已经被写成长行的 R2 不会自动拆分，需要清表后重新追溯，或手工删除 R2 后从对应来源楼层重新追溯；v4.2.9 尚未提交、推送或部署到真实 SillyTavern。
- **已知风险与后续建议**：本方案因无法处理连续事件跨零点而在发布前撤回，已由 v4.2.10 的事件/阶段语义分块规则替代。

## 2026-08-16 清理不可达的旧总结代码 v4.2.8（本地未发布）

- **用户目标**：在 v4.2.7 已提交并推送后，继续在本地清理无法从界面进入的旧总结死代码，并用非技术语言说明解决的问题。
- **主要修改**：删除旧总结删除弹窗、笔记本渲染和翻页/目录/编辑事件、三个永久关闭分支、总结专用表格选择器及旧配置读写；删除动态主题和静态 CSS 中对应的总结弹窗、笔记本、目录、归档水印和专用选择器样式；移除主题页中已无实际用途的“总结本背景图”控件。历史总结配置键改为升级时清除，`summarizedRows` 冷行兼容索引、旧文件导入和提示词迁移逻辑保持不变。新增静态回归测试，防止旧入口和 `if (false)` 死分支回流。版本升至 v4.2.8。
- **修改的文件**：`index.js`、`style.css`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 26/26 项；`npm run check` 通过 6 个核心 JavaScript 语法检查；manifest/package 版本一致性检查通过，结果为 `lease_vector_memory 4.2.8`；`git diff --check` 通过（仅提示工作区未来可能进行 LF→CRLF 转换，无空白错误）。
- **未完成事项**：本批 v4.2.8 清理按用户要求只保留在本地，尚未提交或推送；尚未在真实 SillyTavern 页面执行交互回归。
- **已知风险与后续建议**：本轮删除量较大但只涉及不可达总结分支和专属样式，自动测试已覆盖核心数据行为与旧入口不回流；发布前仍建议实机打开主表、批量填表 API、主题设置和向量页快速检查。不要删除仍承担冷行兼容索引职责的 `summarizedRows`。

## 2026-08-16 修复稳定编号复用与空表事务顺序 v4.2.7

- **用户目标**：审查 LEASE Vector Memory 的历史更改记录，确认已记录的问题是否真正解决，并直接修复仍存在的稳定编号、批量事务和界面文字问题。
- **主要修改**：组合方案或表结构切换时改为备份和恢复整张表的 v2 状态，不再只保留行数组，因此已删除高编号之后的 `nextRowId` 不会丢失，新行不会复用历史 R 编号。批量命令执行前改为复制命令并在虚拟表状态中按原顺序校验：`validateOnly` 不再改写调用方命令，同批先新增再更新能命中刚生成的稳定 R 行，删除后的后续命令也会按事务内最新状态检查；空表首条错误 update 的兼容行为继续保留。将批量填表 API 弹窗中遗留的“AI 总结配置”标题改为准确名称。版本升至 v4.2.7。
- **修改的文件**：`index.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 25/25 项，新增覆盖方案切换后继续使用 R11、空表同批 insert→update 只保留一行、校验不修改原命令、新增后删除的 R 行不能在同批被再次更新及 API 弹窗标题；`npm run check` 通过 6 个核心 JavaScript 语法检查；`manifest.json` 解析通过；`git diff --check` 通过（仅提示工作区未来可能进行 LF→CRLF 转换，无空白错误）。
- **未完成事项**：尚未把 v4.2.7 部署到真实 SillyTavern 扩展目录；尚未调用真实填表模型、Embedding 或 Rerank API 做端到端回归。
- **已知风险与后续建议**：源码中仍有少量不可达的旧总结辅助代码，当前没有总结模块或可见总结入口，本轮只修正用户可达弹窗标题，未进行高风险的大范围死代码清理。实际 SillyTavern 目录目前是旧 `ST-Memory-Context`，本轮没有覆盖，避免误伤正在使用的旧插件。

## 2026-08-16 放宽主线代码封锁并改为事件弧聚合 v4.2.6

- **用户目标**：修复结束时间非空就拒绝继续填写导致的批量事务失败，并避免提示词把连续剧情按每个地点、动作和短时间段切成大量不连贯小行；异常无限追加应由提示词约束，不应由代码替模型判断剧情边界。
- **主要修改**：移除执行层针对主线“结束时间非空”“同批已填写结束时间”“出现不同地点”的三项硬拒绝。稳定 R、冷行、锁定行、手工记忆和不存在行的事务保护保持不变。提示词版本升至 7.6，将强制分行规则改成“完整事件弧聚合”：同一核心目标与直接因果链中的房间切换、短距离移动、途中交谈和连续地点允许继续更新同一 R，结束时间可覆盖为最新时间；仅在核心目标改变、明显长时间跳跃或开启因果独立事件时新建行，同时禁止仅因同一天或人物相同而无限追加无关事件。
- **修改的文件**：`index.js`、`prompt_manager.js`、`backfill_manager.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 22/22 项；`npm run check` 通过；manifest 解析为 `lease_vector_memory / 4.2.6`；`git diff --check` 通过。新增回归覆盖结束时间延长、同批连续更新和同一事件跨地点更新。
- **未完成事项**：发布后需在 SillyTavern 用截图对应的连续剧情重新追溯，观察模型是否把同一事件弧合并到合理数量的行。
- **已知风险与建议**：取消剧情语义硬拒绝后，模型仍可能偶尔错误聚合或拆分；执行层不再越权判断语义，后续应根据实机样本微调提示词中的正反例。

## 2026-08-16 修复清表状态并按 LEASE 原提示词迁移 Vector 版 v4.2.5

- **用户目标**：修复清空表格后初始化对话仍因“表2 R5不存在、表4 R2不存在”而整批拒绝的问题；撤销自行精简的默认提示词，严格以用户提供的 LEASE 魔改版 `新版-backfillPrompt.txt` 为基线迁移 Vector Table。
- **主要修改**：确认清表根因是 `Sheet.clear()` 只清空了行数组，没有重置 `nextRowId`，导致空表内部仍保留 R5/R2 作为未来号码；动态表结构又把这些未来号码暴露给了模型。现在整表清空会同时把该表 `nextRowId` 归 1，普通删除行仍不复用编号；同时移除 `Next Stable Row ID` 暴露，并保留仅针对真空表的 update→insert 兼容。提示词方面，确认仓库内置基线与用户提供文件逐字一致，运行时默认提示词恢复为该完整正文，只机械迁移总结表→手工记忆、数字行索引→稳定 R，以及冷热/锁定不可见不可写规则；原证据边界、统一时间轴、七表职责、去重、字段含义、示例与输出格式均保留。提示词版本升至 7.5 以刷新内置 default，用户自建方案仍不覆盖。
- **修改的文件**：`prompt_manager.js`、`index.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 22/22 项；`npm run check` 通过；manifest 解析为 `lease_vector_memory / 4.2.5`；`git diff --check` 通过。原提示词基线 SHA-256 校验为 `cf6505f811785cb037ce260e7ead26b59c30fb0d4c76d7569def0db9044c0d7d`；动态执行迁移后的默认提示词确认包含原证据边界和时间轴、包含手工记忆与稳定 R 规则、不含总结表或数字行号更新示例。
- **未完成事项**：需在 SillyTavern 更新后对当前已清空的会话再执行一次初始化填表。
- **已知风险与建议**：更新前已经清空的会话可能仍在持久化数据中保留旧 `nextRowId`；v4.2.5 的空表执行兼容会保证初始化可正常新增。若希望界面从 R1 重新开始，更新后再执行一次清表即可。

## 2026-08-16 修复空表初始化 R0 回归 v4.2.4

- **用户目标**：修复清表后初始化对话无法填表、整批因“表2 R0不存在”被拒绝的问题，并说明上一版究竟修改了什么。
- **主要修改**：确认 v4.2.3 将提示词版本升至 7.3 后刷新了内置 default，而历史 Base64 正文仍包含旧数字行号示例，模型在空表时直接生成了不存在的 R0。提示词版本升至 7.4，旧 Base64 正文仅保留审计、不再作为运行时默认值；新增简洁的 v4 稳定行默认提示词，明确空表只能 `insertRow`、R0 永不存在、实体表按真实 R 更新、主线按事件分行。默认方案使用新正文，用户自建方案不因版本升级被覆盖。执行层增加严格限定的初始化兼容：目标表在事务开始时确实为空且命令为 R0/0 更新时转为 insert，生成真实 R1；其他非法 R 仍整批拒绝。
- **修改的文件**：`prompt_manager.js`、`index.js`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`tests/core.test.mjs`。
- **验证**：`npm test` 通过 20/20 项；`npm run check` 通过；manifest 解析为 `lease_vector_memory / 4.2.4`；`git diff --check` 通过。新增空表 R0→insert/R1 回归测试及运行时默认提示词来源检查。
- **未完成事项**：需在 SillyTavern 清空表格后重新进行一次初始化对话，确认真实模型优先输出 insertRow；还需检查用户原先自行修改的 default 提示词是否需要从外部备份恢复。
- **已知风险与建议**：v4.2.3 已经覆盖的 default 提示词无法仅凭仓库自动恢复用户此前未导出的自定义文本；v4.2.4 会用干净默认正文修复功能。真正的用户自建命名方案不会被版本迁移覆盖。

## 2026-08-16 修复主线事件无限追加 v4.2.3

- **用户目标**：修复批量填表持续修改已经结束的主线行、不按新事件另起一行，并把多个场景疯狂追加进同一个事件概要的问题。
- **主要修改**：提示词版本升至 7.3，新增最高优先级“主线事件分行协议”，明确一行代表同一地点、同一目标、尚未结束的事件单元；地点/目标/场景切换或事件结束时必须 `insertRow`，并明确废止“同一天必须 updateRow”和数组索引旧规则。该协议会补入内置默认提示词，也会在用户仍使用旧/自定义提示词时追加到实际追溯请求末尾。执行层封存结束时间非空的主线 R 行，按命令顺序阻止同批结束后继续更新，并拒绝将不同地点追加到同一主线行。追加列新增重复片段跳过与“旧全文＋新增内容”吸收保护。
- **修改的文件**：`prompt_manager.js`、`backfill_manager.js`、`index.js`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`tests/core.test.mjs`。
- **验证**：`npm test` 通过 19/19 项；`npm run check` 通过；manifest 解析和 `git diff --check` 通过。新增已结束行封存、同批封存后再更新、地点切换拒绝、追加内容去重及提示词旧规则废止测试。
- **未完成事项**：需在 SillyTavern 中用同一段历史重新追溯，确认模型改为结束旧 R 行后插入新行。
- **已知风险与建议**：当前执行层能确定性识别结束时间和 `[地点]` 切换；纯语义上的“目标变化但地点未变”仍主要依赖提示词判断。被旧版本污染的超长历史行不会自动拆分，需手工整理或使用单表重构。

## 2026-08-16 可调来源区间列并修复清表入口 v4.2.2

- **用户目标**：来源区间列默认缩短约一半，并允许像普通列一样拖动调宽；修复点击“清表”没有反应。
- **主要修改**：来源区间列默认由 118px 缩至 64px，在表头增加拖拽柄，通过每张表独立的 `__lvm_source_width__` 键保存到当前会话列宽配置；拖动时同步更新表头和全部来源单元格，完整来源继续保留在悬停提示中。移除清表入口对已删除 `m.sm` 总结管理器的调用；四种清理方式执行后同步重建冷行索引和当前聊天冷记忆书；清空七张自动表时不再误把保留的手工记忆冷行转热。
- **修改的文件**：`style.css`、`index.js`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`tests/core.test.mjs`。
- **验证**：`npm test` 通过 15/15 项；`npm run check` 通过；manifest 解析为 `lease_vector_memory / 4.2.2`；`git diff --check` 通过。新增清表入口残留依赖、四种清理后冷库同步和手工冷记忆状态保护的静态回归检查。
- **未完成事项**：仍需在 SillyTavern 中实机拖动来源列并点击四种清理选项。
- **已知风险与建议**：来源列缩得很窄时会更早显示省略号，但数据和悬停完整文本不受影响；“重置列宽”会把它恢复到 64px 默认值。

## 2026-08-16 修复固定来源列与自动降冷面板 v4.2.1

- **用户目标**：修复来源区间文字叠入主体角色列，以及“冷热与 API”页的自动降冷面板被压缩成一条细缝的问题；重新检查桌面与窄屏 UI 后发布更新。
- **主要修改**：提高行号/来源固定列的 CSS 选择器优先级，使 `sticky` 不再被通用单元格 `position: relative !important` 覆盖；移除相互冲突的行号内联宽度，来源内容改为明确像素宽度、单行省略和绘制裁剪，并使用随明暗主题切换的不透明固定列背景。自动降冷面板改为不可收缩卡片，八张表使用桌面双列、窄屏单列布局，明确展示自动开关与保留行数。
- **修改的文件**：`index.js`、`memory_lifecycle.js`、`style.css`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`tests/core.test.mjs`，新增 `tests/ui-regression.html` 本地视觉复现页。
- **验证**：`npm test` 通过 14/14 项；`npm run check` 通过；`manifest.json` 可解析；`git diff --check` 通过。本地浏览器在 1280×720 下确认自动降冷面板 8 行完整、高度约 300px、双列显示；390×844 下确认单列显示且无页面横向溢出。固定列坐标连续：行号列结束于 194.5px，来源列为 194.5–312.5px，首个数据列从 312.5px 开始，未重叠。
- **未完成事项**：尚未在用户当前 SillyTavern 页面中更新插件并对真实主题、真实表格数据和触摸滚动做最终回归。
- **已知风险与建议**：视觉复现页覆盖了导致本次错误的 Flex 收缩、CSS 优先级、长来源文本和响应式断点；SillyTavern 的第三方主题仍可能增加更高优先级规则，更新后应以用户实际主题再看一次截图。

## 2026-08-16 精简冷热 UI、向量文本与表格操作 v4.2.0

- **用户目标**：向量内容移除 R 编号和来源楼层；取消当前聊天逐条卡片，把冷却策略与 API 合并；拆分行号与来源为两个固定列并阻止来源撑高行；移除逐行上下移动；要求主线事件概要明确记录地点。
- **主要修改**：Embedding 文本现仅含表名、列名与单元格正文，R/来源继续作为内部条目元数据。向量区缩为“冷热与 API / 知识书管理”两页，API 页上方直接显示逐表 X，删除当前聊天逐行卡片与搜索。主表新增独立固定“来源区间”列，R/勾选列横向紧凑显示，来源区间横向合并、单行省略并以悬停标题保留全文。状态列只保留转冷/转热与锁定/解锁，删除上下移动入口和处理分支。默认提示词版本升至 7.2，并在普通追溯和重试请求末尾追加主线地点最高优先级规则。旧格式冷向量会自动失效重算，失败行恢复白色。
- **修改的文件**：`index.js`、`memory_lifecycle.js`、`vector_manager.js`、`style.css`、`prompt_manager.js`、`backfill_manager.js`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 12/12 项；`npm run check` 与额外 `node --check` 通过；manifest 解析为 `lease_vector_memory / 4.2.0`；`git diff --check` 通过。新增验证向量文本不含 `R1/来源/0-30`、两页 UI、无行上下移动入口、来源独立列及主线地点强制规则。
- **未完成事项**：尚未在真实 SillyTavern 中观察大量来源区间时两列固定效果；尚未用真实 Embedding API 验证旧冷行格式升级后的批量重算；尚未调用填表模型确认所有主线事件均带地点。
- **已知风险与后续建议**：来源区间仍完整保存在元数据与单元格悬停提示中，只是不再纵向展开。更新后首次打开可能触发旧冷行重新 Embedding；API 失败的行会按安全规则恢复白色。

## 2026-08-16 修复 GitHub 安装后顶部入口缺失 v4.1.1

- **用户目标**：修复从新 GitHub 项目安装后，SillyTavern 顶部没有插件图标、无法打开插件页面的问题。
- **主要修改**：确认 GitHub 安装目录名为 `LEASE-Vector-Memory`，而动态路径回退只识别旧 `ST-Memory-Context` 与本地 `LEASE-Memory-Table`，导致必需子模块加载失败且 `ini()` 从未执行。路径识别现兼容 `LEASE-Vector-Memory` 与 `-main`；空路径时明确停止并报错；初始化会等待顶部工具栏挂载点出现。顶部入口从会与旧插件冲突的 `gaigai-*` 改为独立 `lvm-top-wrapper / lvm-top-btn`，使用脑图标，且只清理自己的入口。恢复内置 GitHub 更新检查地址为 `LEASE-2473/LEASE-Vector-Memory`。
- **修改的文件**：`index.js`、`manifest.json`、`package.json`、`tests/core.test.mjs`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 10/10 项，其中动态执行路径定位函数确认 `/scripts/extensions/third-party/LEASE-Vector-Memory/index.js?v=4.1.1` 能解析出正确目录；`npm run check` 通过；manifest 解析为 `lease_vector_memory / 4.1.1`。
- **未完成事项**：推送后需要用户在 SillyTavern 扩展管理器更新并整页刷新，确认顶部脑图标出现并能打开主界面。
- **已知风险与后续建议**：如果浏览器或 SillyTavern 缓存旧脚本，只点更新而不整页刷新仍可能继续运行 v4.1.0；更新后应执行强制刷新。旧插件仍建议停用，避免两套请求拦截同时运行。

## 2026-08-16 创建独立 GitHub 项目并公开发布

- **用户目标**：把 LEASE Vector Memory 作为全新项目发布到 GitHub，便于在 SillyTavern 中通过 GitHub 安装和更新。
- **主要修改**：确认当前登录账号为 `LEASE-2473`、目标仓库此前不存在、本地 `main` 干净且无旧 remote；创建公开普通仓库 `LEASE-2473/LEASE-Vector-Memory`，将本地 `main` 推送并设置 `origin` 跟踪。更新 README 安装地址、项目上下文及发布安全边界。未创建 Fork、PR、Issue 或向原作者仓库进行任何写操作。
- **修改的文件**：`README.md`、`PROJECT_CONTEXT.md`、`GITHUB_PUBLISHING_SAFETY.md`、`CHANGELOG.md`；外部状态新增 GitHub 仓库和 `origin`。
- **验证**：创建前使用 `gh auth status` 确认账号；使用 `gh repo view` 确认目标仓库原先不存在；首次推送成功。文档提交后再次核对仓库可见性、默认分支、远端地址和远端 `main` 提交。
- **未完成事项**：尚未在 SillyTavern 中通过公开 URL 完成首次安装和“检查更新”实机回归；真实 Embedding/Rerank 与移动端回归仍待执行。
- **已知风险与后续建议**：新旧插件同时启用会重复拦截请求，安装新项目后应停用旧 `ST-Memory-Context`。公开仓库任何后续推送仍必须先核对 `origin` 所有者为 `LEASE-2473`。

## 2026-08-16 向量记忆区三分区与主表状态操作补全 v4.1.0

- **用户目标**：纠正 Embedding/Rerank API 被藏在“外部知识书”中的误导信息架构；让聊天冷记忆书与外部知识书统一可见、可启停；补齐主表可发现的显示/隐藏、冷热和锁定操作；明确关闭向量功能后的普通表格行为。
- **主要修改**：向量记忆区重构为“当前聊天记忆库 / API 设置 / 知识书管理”三分区。当前页展示全部热、冷、锁定行及逐表 X；API 页独立展示 Embedding、Rerank、阈值与召回配置；知识书页统一列出当前聊天、其他聊天冷记忆书和外部知识书，并允许按当前会话启停召回。主表状态操作列改为固定可见文字按钮，工具栏新增批量“显隐/锁定”和状态图例。向量总开关关闭时禁止新增冷行并恢复已有冷行为白色，保证所有行继续直接注入。系统冷记忆书只读展示，不允许按外部书方式删除或改源文本。
- **修改的文件**：`index.js`、`memory_lifecycle.js`、`vector_manager.js`、`style.css`、`tests/core.test.mjs`、`manifest.json`、`package.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：`npm test` 通过 8/8 项；`npm run check` 通过；`manifest.json` 可解析；`git diff --check` 通过。新增覆盖向量关闭时保持全白、三分区入口、主表固定状态操作与统一知识书列表的检查。
- **未完成事项**：尚未在可确认的独立 SillyTavern 测试目录部署 v4.1.0；尚未用真实 Embedding/Rerank API 验证逐行转冷、启停当前聊天冷记忆书及召回；尚未完成手机端点击回归。
- **已知风险与后续建议**：本机实际 SillyTavern 目录目前只有旧 `ST-Memory-Context v3.3.3`，本轮未覆盖，避免破坏旧版。用户截图中的 v4.0.0 可能来自另一个测试环境，部署 v4.1.0 时应先确认其扩展目录并停用旧插件。

## 2026-08-16 LEASE Vector Memory 独立二次魔改 v4.0.0

- **用户目标**：在不修改旧魔改项目的前提下建立独立仓库，删除二次总结链，以稳定 R 编号和行级冷热向量记忆解决批量填表误写、隐藏历史与总结冲突。
- **主要修改**：从旧仓库已提交 `main` 快照建立无远端的独立基线；插件身份改为 `LEASE Vector Memory / lease_vector_memory`，全部存储切换到 `lvm_`/`lvm` 命名空间和 `LEASE_Vector_Memory_Database`。新增 v2 `{cells, meta}` 持久化、永不复用 R 编号、批处理来源区间、冷/热/锁定状态、手工记忆表、逐表 X、Embedding 成功后转绿、失败回白、按聊天冷记忆书及向量记忆区。批量填表仅接收未锁定白行，非法 R、冷行、锁定行或手工表冲突会使整批零写入。默认注入点改为预设/System/世界书后、历史前，调试面板增加位置和冷热统计。旧文件迁移忽略总结表与旧绿色状态，再按 X 安全降冷。删除 `summary_manager.js`、总结触发、总结提示词和总结向量同步入口。
- **修改的文件**：`index.js`、`backfill_manager.js`、`memory_lifecycle.js`、`vector_manager.js`、`prompt_manager.js`、`io_manager.js`、`debug_manager.js`、`phone-adapter.js`、`style.css`、`manifest.json`、`package.json`、`tests/core.test.mjs`、`README.md`、`PROJECT_CONTEXT.md`、`ATTRIBUTION.md`、`GITHUB_PUBLISHING_SAFETY.md`；删除 `summary_manager.js`。
- **验证**：`npm test` 通过 6/6 项；`npm run check` 通过六个核心 JavaScript 语法检查；全部顶层 JavaScript 另行逐个 `node --check`；`manifest.json` 可解析。测试覆盖稳定 ID 与 v2 往返、冷/锁定/手工可见性、冲突整批拒绝、十行主线 X=3、Embedding 失败保持白色和命名空间隔离。
- **未完成事项**：尚未复制到独立 SillyTavern 测试环境；尚未调用真实剧情模型、Embedding 或 Rerank API；尚未完成聊天切换、提示词最终索引、移动端 UI 与外部向量书实机回归；尚未创建 GitHub 仓库或 remote。
- **已知风险与建议**：旧版仍有少量不可达的总结辅助死代码和历史字段，当前不会加载总结模块或显示总结配置，但后续应继续做纯清理审计。实机验收前保持旧插件停用且不要连接远端。

## 2026-08-02 恢复上游总结控制台、自动确认与总结表归档

- **用户目标**：按提醒恢复偏离上游的总结/追溯 UI，找回自动表格总结前带确定、取消和临时顺延的确认弹窗，并修复“记忆总结”表在总结和向量化成功后没有归档隐藏的问题。
- **主要修改**：将表格总结控制台的状态卡、指针、表格总结卡和按钮恢复为上游布局；将表格选择器恢复为上游 `gg-sum-table-selector-overlay`、`gg-custom-modal`、选择卡片、全选/全不选和确定保存结构。把自动批量填表及自动表格总结从普通确认框重新接回已保留的上游 `showAutoTaskConfirm()`，支持取消和临时顺延 N 楼并持久化顺延指针。自动向量同步成功后归档隐藏“记忆总结”表全部行；同步或向量化失败时不归档。核对确认 `backfill_manager.js` 与固定上游快照逐字一致，因此未重复改写追溯模块。版本升至 `3.3.3`。
- **修改的文件**：`summary_manager.js`、`index.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。未修改或同步 SillyTavern 本地运行目录。
- **验证**：执行全部 JavaScript 语法检查、`manifest.json` 解析、上游 UI 标识静态对照、自动任务确认入口与顺延持久化测试、向量成功归档/失败不归档行为测试、`backfill_manager.js` 上游一致性校验及 `git diff --check`。
- **未完成事项**：尚未在真实 SillyTavern 中等待自动任务触发、点击顺延、实际调用 Embedding API 或观察总结表变绿。
- **已知风险与建议**：确认弹窗沿用上游透明遮罩和动态主题；手机浏览器软键盘可能影响顺延输入框的可视高度，部署后应实机检查。只有自动向量同步成功才触发总结表归档，手动书架同步继续沿用原有成功后归档逻辑。

## 2026-08-02 恢复上游总结预览窗并修复手机端溢出

- **用户目标**：修复表格总结未静默保存时出现的预览窗在手机界面顶出屏幕的问题，不再使用 LEASE 重构时另写的弹窗，直接恢复上游 UI。
- **主要修改**：将自定义 `#gg-summary-preview` 替换为上游 `#gai-summary-pop`、`.g-ov`、`.g-w`、`.g-hd`、`.g-bd`、`.g-p` 结构，移除手机端不适配的 `min-height: 360px` 文本框和整窗滚动方案，重新使用插件现有的 85dvh 限高、内部弹性布局与滚动规则；恢复上游在保存后显示的三按钮原行处理框（删除、隐藏、保留），删除行为按 LEASE 当前语义只作用于本次参与总结的源行；保留会话切换安全检查。确认静默参数为 `true` 时直接写入总结并按全局设置处理源行，不调用预览窗或原行处理框。版本升至 `3.3.2`。
- **修改的文件**：`summary_manager.js`、`index.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。未修改或同步 SillyTavern 本地运行目录。
- **验证**：执行全部 JavaScript 语法检查、`manifest.json` 解析、静默/非静默总结分支行为测试、上游弹窗结构静态对照及 `git diff --check`。
- **未完成事项**：尚未在手机 Safari/Chrome 的真实 SillyTavern 页面中调用模型并检查弹窗。
- **已知风险与建议**：手机浏览器地址栏展开/收起会改变动态视口高度；当前布局沿用上游 85dvh 方案，部署后应在实际手机上分别验证横屏、竖屏和软键盘弹出状态。

## 2026-08-02 固化 GitHub 发布安全边界与原作者创意署名

- **用户目标**：为后续修改留下明确规则，绝不影响、打扰或向原作者 GitHub 仓库写入，同时清楚声明本版本魔改自原作者的创意与开源项目。
- **主要修改**：新增 `GITHUB_PUBLISHING_SAFETY.md`，明确 LEASE 仓库是唯一允许写入的目标，原作者仓库仅可只读参考；禁止向原作者推送、创建 PR/Issue/评论/Release 或产生通知，并列出每次发布前的目标核对步骤。同步强化 `ATTRIBUTION.md` 和 README 的创意来源、感谢、非官方衍生与无背书声明；修正 `PROJECT_CONTEXT.md` 中“当前目录没有 Git”的过期状态。
- **修改的文件**：`GITHUB_PUBLISHING_SAFETY.md`、`ATTRIBUTION.md`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **验证**：检查 Markdown 文件存在、内部链接目标、仓库地址和禁止写入规则文本；检查 `git remote -v`，确认本地 `origin` 指向 `LEASE-2473/ST-Memory-Context`。
- **未完成事项**：本轮仅修改本地 Markdown，没有提交、推送、创建 PR、Issue、评论或其他 GitHub 写操作。
- **已知风险与建议**：当前 GitHub 仓库仍显示 Fork 来源关系；这不会自动影响原作者仓库。若未来希望迁移成完全独立的非 Fork 仓库，必须由 LEASE 明确授权后单独处理。

## 2026-08-02 恢复上游“注入记忆表格”配置样式

- **用户目标**：注入记忆表格功能不做 LEASE 化 UI，恢复上游原本的样式、名称和位置。
- **主要修改**：把 `lvm_c_table_inj` 从“记忆总结（默认设置）”折叠区移回自动隐藏与自动总结之间的独立配置卡；恢复上游“💉 注入记忆表格”标题、白色卡片样式、信息图标和“注入策略点击上方 i 图标查看”说明；恢复同风格变量说明弹窗。表格变量遵循上游语义：`{{MEMORY}}` 的表格部分跟随开关，`{{MEMORY_TABLE}}` 与 `{{MEMORY_TABLE_表名}}` 为显式强制表格锚点。版本升至 `3.3.1`。
- **修改的文件**：`index.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`；同步修订两份外部审计报告。未修改或同步 SillyTavern 本地运行目录。
- **验证**：执行全部 JavaScript 语法检查、manifest 解析、上游卡片静态结构对照及注入行为测试。
- **未完成事项**：尚未在 SillyTavern 实机点击信息图标、切换开关并查看真实请求。
- **已知风险与建议**：上游信息弹窗中与已删除实时填表/普通世界书同步有关的两条说明不能原样照搬；弹窗保持上游视觉和变量布局，但只说明当前仍有效的四类变量。

## 2026-08-02 恢复未归档表格发送并清理实时填表幽灵链

- **用户目标**：恢复白色未归档详细表格随剧情请求发送，避免批量填表与总结之间出现结构化记忆断档；维持上游式静默总结交互；恢复默认提示词；清理实时填表死分支和幽灵配置；确认表格与向量可以导出、导入；重新审计代码与 UI 可达性。
- **主要修改**：将 `tableInj` 恢复为默认开启、可按聊天保存且有 UI 的有效功能；新增未归档详细表格消息和 `{{MEMORY}}`、`{{MEMORY_SUMMARY}}`、`{{MEMORY_TABLE}}`、`{{MEMORY_TABLE_表名}}` 锚点处理，绿色行继续由 `S.txt()` 跳过，向量接管只抑制默认总结而不抑制白色表格。增加“恢复 LEASE 默认提示词”入口，恢复编辑框内容后由用户确认保存。移除 `C.enabled` 五类实时回档分支、Swipe/DOM Swipe 监听及其专属运行状态；移除 `autoSummaryHideContext`、`log`、`filterHistory`、`tablePosType`、`API_CONFIG.enableAI` 等幽灵字段；删除 4 个旧独立表结构预设事件。修复 TXT 表格导入未恢复 `[已归档]` 状态且会污染列名的问题。版本升至 `3.3.0`，重写两份审计报告。
- **修改的文件**：`index.js`、`prompt_manager.js`、`io_manager.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`；更新资料文件夹中的 `代码与UI可达性审计报告.md` 和 `上游与LEASE功能逐项对照报告.md`。未修改或同步 SillyTavern 本地运行目录。
- **验证**：全部 8 个 JavaScript 文件通过 `node --check`，`manifest.json` 解析通过；独立行为测试确认默认总结与白色表格注入、空/绿色表跳过、指定表锚点去重、向量接管后白色表格继续发送、关闭 `tableInj` 后总结兜底仍工作；表格 JSON/TXT 含总结与归档状态往返通过；向量多书、片段、Base64 向量、未完成状态及合并导入往返通过；`C.enabled` 和 4 个旧选择器活动引用为零。
- **未完成事项**：尚未在 SillyTavern 实机执行 13/33/37/38 层完整流程，未实际调用剧情模型和 Embedding API，也未在新聊天中手动导入并绑定旧向量书。
- **已知风险与建议**：旧 v3.0-v3.2 配置曾被强制保存为 `tableInj: false`，本版首次升级会迁移为开启，之后尊重 UI 选择。向量备份未记录 Embedding 模型元数据，跨环境恢复应保持同一模型。当前源码目录没有 `.git`，发布前需放入或关联正确的 Fork 工作树。

## 2026-08-01 固定上游快照与逐项功能对照审计

- **用户目标**：直接下载原作者 GitHub 仓库到“记忆表格LEASE魔改”资料夹，按固定提交逐一审阅 LEASE 是否误删所需功能、遗留幽灵代码、把重要功能误判为幽灵，或让需要用户操作的代码失去 UI。
- **主要修改**：下载并校验上游 `main` 提交 `28241c95ac7a2a3874bdc0e041a3f9083c19ebee`，保存为独立快照 `上游原版对照\gaigai315-ST-Memory-Context-main-28241c9`；新增快照说明和《上游与LEASE功能逐项对照报告》。审计确认批量追溯、调试、表格导入导出和样式与上游规范化后完全一致，手机适配核心行为等价；发现历史 `<Memory>` 标签发送前清洗、恢复默认提示词、导出全部组合方案三项建议恢复的能力，以及 5 处 `C.enabled` 实时填表死分支。同步把原代码/UI 报告的不匹配总数从 13 修正为 14，并将 `filterHistory` 重新分类为“重要实现被删、字段成为幽灵”。
- **修改的文件**：新增 `D:\LEASE AI Project\SillyTavern Project Main\插件\记忆表格LEASE魔改\上游原版对照\README.md`、上游 Git 快照和 `上游与LEASE功能逐项对照报告.md`；更新 `代码与UI可达性审计报告.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。本轮未修改插件运行代码。
- **验证**：上游快照 `rev-parse HEAD` 与远端 `main` 一致，Git 状态为空；完成文件清单、规范化内容、配置字段、DOM ID、事件订阅、全局导出、提示词/表结构方案和请求注入链对照。全部 8 个 LEASE JavaScript 继续通过 `node --check`，`manifest.json` 可解析。
- **未完成事项**：本轮只下载和审计，没有实现报告中的三项建议恢复能力，也没有清理 `C.enabled` 死分支；尚未进行 SillyTavern 实机回归。
- **风险与建议**：不要机械恢复上游所有功能。下一轮应先恢复安全清洗和组合方案两个入口，再单独清理幽灵分支；实时填表、聊天/大总结、总结优化、智能联动和普通世界书同步继续保持删除。

## 2026-08-01 恢复保留 N 层自动隐藏与手机填表适配

- **用户目标**：恢复由用户设置“保留最近 N 层”的自动隐藏功能和 UI，但不恢复“总结后隐藏上下文”及智能联动计算；恢复手机填表适配模块；用更宽的范围复查代码—UI 可达性报告，并用通俗语言解释 `tableInj`、`log`、`filterHistory`、`API_CONFIG.enableAI`。
- **主要修改**：在插件配置中恢复“✂️ 自动隐藏旧楼层”，支持开关、保留层数和立即执行；配置按聊天保存，并在消息完成、聊天切换和最终请求发送前自动执行。隐藏实现只计算普通对话楼层、保留最近 N 层并无感标记旧楼层，不接回总结指针联动。恢复 `phone-adapter.js`，按上游机制识别 `gaigaiPhoneSignal`、标记 `isPhoneMessage`、设置手机来源名称并接入探针；现有请求链继续跳过手机内部 API、遵守 `allowVector`，追溯/批量填表排除手机消息。插件版本升至 `3.2.0`。扩大审计范围后修订 LEASE 魔改资料夹中的报告：当前代码/UI 不匹配由 14 组降为 13 组，并补记首轮遗漏的“已删除模块与需求清单”核对。
- **修改的文件**：`index.js`、`summary_manager.js`、`phone-adapter.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`；更新资料报告 `D:\LEASE AI Project\SillyTavern Project Main\插件\记忆表格LEASE魔改\代码与UI可达性审计报告.md`。
- **验证**：执行全部 8 个 JavaScript 文件的 `node --check`、`manifest.json` 解析、动态模块加载清单、恢复功能静态断言、DOM ID/事件引用审计、配置读取链和孤立函数审计；均通过。另用模拟聊天验证隐藏逻辑会排除 system/插件消息、只保留最近 N 层、首次保存一次且重复执行幂等。上游源码对照确认手机协议只定义并读取 `allowVector`，没有 `allowMemory` 读取链，因此当前恢复与上游一致。未修改或同步 SillyTavern 本地运行目录。
- **未完成事项**：尚未在 SillyTavern 实机验证自动隐藏后的幽灵图标/请求上下文、手机插件真实请求、聊天切换后的按聊天配置恢复。
- **风险与建议**：隐藏操作会写入聊天消息的 `is_system` 并保存聊天；关闭开关只停止后续自动隐藏，不会自动取消此前已隐藏的楼层。部署到测试酒馆或 VPS 后应刷新扩展缓存并确认版本号为 `v3.2.0`。

## 2026-08-01 恢复史官破限与表格总结进度指针

- **用户目标**：所有可发布修改必须落在 `ST-Memory-Context-main` 源码项目中；恢复“史官破限”和总结进度指针；总结优化继续移除；只精简已删除功能的 UI，不删减仍保留功能的配置界面。
- **主要修改**：恢复“🔓 史官破限 (System Pre-Prompt)”编辑区、默认正文、组合方案存储/切换及总结与追溯调用链；将内置提示词方案版本升至 `7.1`，使此前被置空的默认 LEASE 方案自动补回史官破限，同时不覆盖用户自建方案。在“总结控制台”顶部恢复仅表格模式的总结指针、当前总楼层、手动修正和按聊天保存说明；修复延迟总结成功后指针直接跳到最新楼层的问题，现按单个总结批次推进并保留延迟区间；修复“重置所有详细表”误清零总结指针的问题。移除遗留的总结优化弹窗 CSS 选择器，插件版本升至 `3.1.1`。完成代码—UI 可达性审计，并将报告写入 LEASE 魔改资料文件夹。
- **修改的文件**：`index.js`、`summary_manager.js`、`prompt_manager.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`；新增资料报告 `D:\LEASE AI Project\SillyTavern Project Main\插件\记忆表格LEASE魔改\代码与UI可达性审计报告.md`。
- **验证**：执行全部现存 JavaScript 的 `node --check`、`manifest.json` 解析、史官默认值/导出/UI 链路、总结控制台指针 UI/聊天存取/批次推进和总结优化弹窗残留的静态断言；均通过。审计额外比对 213 个静态渲染 ID、211 个静态 DOM 引用、配置字段读取链及单引用函数。未修改或同步 SillyTavern 本地运行目录。
- **未完成事项**：尚未在 SillyTavern 实机点击“修正”、切换聊天验证指针恢复，亦未实际调用总结或追溯模型验证史官破限请求消息。
- **风险与建议**：默认 LEASE 方案会在首次加载时迁移并恢复内置史官破限；用户自建方案继续保留各自内容。部署到本地测试酒馆或 VPS 后需刷新扩展缓存，再检查版本号为 `v3.1.1`。

## 2026-08-01 恢复批量填表、LEASE 合并方案与向量接管校验

- **用户目标**：保留按楼层批量填表的间隔、延迟和静默选项；避免向量化未真正完成时停止发送默认记忆；恢复可切换、可按角色使用的剧情方案，并让每个方案同时保存表结构和提示词；移除旧 gaigai/yuzuki 默认模板，内置用户提供的 LEASE 表结构与两份新版提示词。
- **主要修改**：
  - 恢复自动批量填表配置和消息完成后的触发流程，支持间隔楼层、延迟楼层、发起前确认/静默发起和结果弹窗/静默保存；继续禁用逐条 `<Memory>` 实时填表。
  - 新增向量接管状态核验：只有当前聊天存在总结向量书、分片数量一致且全部向量化成功时，才停止默认总结发送；未配置 API、部分失败或尚未建库时继续兜底，并在配置页显示原因与进度。
  - 将提示词预设与表格结构合并为组合方案，支持新建、切换、重命名、删除、导入导出和绑定当前角色；方案切换时同步应用表结构和提示词。
  - 默认方案改为“LEASE专属”，内置八张 LEASE 表；总结提示词和追溯提示词逐字取自 `新版-summaryPromptTable.txt` 与 `新版-backfillPrompt.txt`。迁移时清理旧插件自动创建的 gaigai/yuzuki 内置项，保留用户自建方案。
  - 插件版本升级为 `3.1.0`，更新 README、项目上下文和内置更新说明，并将修改同步到 SillyTavern 实际加载目录。
- **修改的文件**：`index.js`、`prompt_manager.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`；同时同步同名运行文件到 `D:\LEASE AI Project\SillyTavern\public\scripts\extensions\third-party\ST-Memory-Context`。
- **验证**：源目录和实际加载目录的全部 JavaScript 均通过 `node --check`；`manifest.json` 解析为 `3.1.0`；两份内置提示词解码后与用户文件逐字一致；迁移、组合方案应用、批量触发范围和向量接管状态的 Node 行为测试通过；浏览器实机刷新 `http://127.0.0.1:8000/` 后确认插件以 `v3.1.0` 启动、八张 LEASE 表可见、批量填表四项配置可见、向量未就绪时显示默认总结兜底、组合方案仅显示“LEASE专属”且两份提示词已加载。
- **未完成事项**：未实际调用剧情填表模型或 Embedding API，未制造真实的部分向量失败场景。
- **风险与建议**：旧用户自建方案会保留；旧插件自动创建且名称匹配 gaigai/yuzuki 内置项的方案会被迁移清理。建议首次使用先在测试聊天中执行一次批量填表，再生成一条总结并观察向量状态从兜底切换为“已接管”。

## 2026-07-26 GitHub 公开发布准备

- **用户目标**：将魔改版本发布到用户自己的 GitHub 账户，同时正确注明原作者和开源许可。
- **主要修改**：在 README 顶部增加原项目链接、MIT 授权来源及非官方衍生声明，并加入当前 GitHub 安装地址；增加完整 MIT `LICENSE`；增加 `ATTRIBUTION.md` 记录原项目、维护者与主要功能差异；在 manifest 中同时标明当前维护者、原作者来源和项目主页；已在 `LEASE-2473` 账户下创建原仓库 Fork。
- **修改的文件**：`README.md`、`manifest.json`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`LICENSE`、`ATTRIBUTION.md`。
- **验证**：全部 7 个 JavaScript 文件通过 `node --check`；`manifest.json` 解析通过；`git diff --check` 通过；未发现写死的非空密钥、Token、私人路径或聊天数据；与上游差异确认 `backfill_manager.js` 未被修改，完整手动追溯实现原样保留。
- **未完成事项**：尚未在实际 SillyTavern 环境中完成 UI、总结 API、Embedding API 与检索注入回归。
- **风险与建议**：原仓库没有独立 `LICENSE` 文件，但其 README 明确声明 MIT License；本版本据此补齐标准 MIT 文本并显著保留原作者归属。

## 2026-07-26 LEASE 轻量化记忆总结与向量化重构

- **用户目标**：将弃用的开源版本魔改为个人插件；保留记忆表格、完整手动追溯、表格总结、默认总结兜底与向量检索；移除日常实时填表、后台自动填表、聊天与大总结、总结优化和世界书总结同步。
- **主要修改**：
  - 插件显示名改为 `LEASE Memory Context`，版本升至 `3.0.0`，关闭上游自动更新。
  - 将总结模块重写为仅总结所选记忆表格，并支持保留、隐藏或删除源行。
  - 总结保存后可直接同步向量模块；正文按 `===` 等配置分隔符切片，每片独立向量化。
  - 向量仅使用总结正文，不附加“剧情总结 N”标题或备注。
  - 统一总结同步、TXT 导入和源文本编辑的切片实现。
  - 切断 AI 回复中的实时填表解析入口，增加仅表格来源的自动总结触发器。
  - 保留并重新接入原版完整手动追溯模块，包括区间/单表/全部表、分批、重构、表格优化、进度修正与结果确认；恢复追溯提示词管理和每聊天追溯进度。
  - 总结确认页保留“重新生成”，可在写入总结表前重做本次结果。
  - 删除世界书总结、手机填表适配、内置实时填表预设包及三个备份预设文件。
  - 配置界面删除实时/批量填表、大总结、表格注入和世界书区块；保留默认总结与向量化区块。
  - 提示词界面只暴露表格总结、手动追溯与可选系统提示词，旧配置中的实时填表、聊天总结和优化提示词字段会被清理。
  - 根据用户纠正，从本机未改动的 2.3.5 安装副本完整恢复 `backfill_manager.js`，避免自行重写造成追溯行为缺失。
- **修改的文件**：`index.js`、`backfill_manager.js`、`summary_manager.js`、`vector_manager.js`、`prompt_manager.js`、`manifest.json`、`README.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`。
- **删除的文件**：`world_info.js`、`phone-adapter.js`、`builtin_preset_bundle.js`、三个 `yuzuki-*_及全部预设备份_*.json`。
- **验证**：全部 7 个现存 JavaScript 文件通过 `node --check`；`manifest.json` 解析通过；追溯模块与本机原版副本 SHA-256 一致；行为测试确认两行总结中的 `chunk-A === chunk-B` 与 `chunk-C` 会在同步阶段直接形成 3 个独立片段，且标题和备注不会进入向量，并会继续调用该书籍的向量化入口；已移除模块和旧活动入口检查通过。
- **未完成事项**：尚未在实际 SillyTavern 环境中执行 UI、总结 API、Embedding API 与检索注入回归。
- **风险与建议**：尚未在 SillyTavern 中实际点击追溯、调用总结/Embedding API；向量数据库继续使用隐藏存储书以避免浏览器容量限制。
