# 项目上下文

## 项目目标

`LEASE Vector Memory` 是独立的 SillyTavern 第三方扩展。它以八张结构化表格维护记忆：七张自动填表详情表与一张仅用户可编辑的“手工记忆”表；每行直接作为向量切片，不再经过 AI 二次总结。

## 技术栈与运行环境

- 原生 JavaScript、jQuery、HTML、CSS。
- SillyTavern 扩展上下文、聊天元数据与隐藏持久化书。
- OpenAI 兼容 Embedding API，可选 Rerank API。
- Node.js 仅用于语法检查和内置行为测试，无生产依赖或构建步骤。

## 核心文件

- `index.js`：v2 表格数据、稳定 R 编号、事务执行、热记忆注入、主界面与请求拦截。
- `memory_lifecycle.js`：行级冷热、锁定、逐表 X、冷记忆书同步与向量记忆区。
- `backfill_manager.js`：自动批量填表、手动追溯和来源楼层范围。
- `vector_manager.js`：外部知识书、Embedding、Rerank、检索及 `LEASE_Vector_Memory_Database` 持久化。
- `prompt_manager.js`：追溯提示词和表结构组合方案；手工记忆固定为末表且 AI 不可写。
- `io_manager.js`：v2 JSON/TXT 往返和旧 LEASE Memory Context 导出文件显式迁移。
- `debug_manager.js`：最后请求、插入索引、角色、热行与冷召回诊断。
- `tests/core.test.mjs`：稳定 ID、事务保护、可见性、自动降冷、失败回退和命名空间测试。

## 关键设计决策

- 每张表独立使用永不复用的 `R1、R2……`；表号仍为 `0..7`。删除、排序与冷热转换不改变 R 编号。
- 持久化格式为 v2 `{cells, meta}`，元数据包括 ID、冷热、锁定、来源区间与时间戳。
- 白色热行在日常剧情请求中直接注入；绿色冷行仅语义召回；锁定热行直接注入但对填表 AI 不可见且不可写。
- 批量填表只收到前七表中未锁定的白色行。任何更新/删除指向冷行、锁定行、不存在 ID 或手工记忆时，整批零写入。
- 主线和支线默认自动降冷并保留最近 3 行；其他表默认关闭，预填 3。Embedding 成功后才转绿，失败保持白色。
- 冷记忆书按聊天隔离，条目标识为“表号 + R 编号”；行编辑只使对应文本缓存失效。无时间衰减，默认最多召回 20 条。
- 热表和冷召回默认插在预设/System/世界书之后、历史聊天之前；显式深度设置覆盖默认锚点。
- `summary_manager.js`、总结表、自动总结、总结提示词和“详情→总结→向量”链均已删除。
- 插件 ID 为 `lease_vector_memory`；localStorage、聊天元数据和扩展设置使用 `lvm_`/`lvm` 命名空间，不读取旧插件存储。
- 当前仓库没有 remote。完成 SillyTavern 实机验收前不得创建 GitHub 仓库或推送。

## 运行与验证

- `npm test`：运行 Node 行为测试。
- `npm run check`：检查核心 JavaScript 语法。
- `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`：检查 manifest。
- 实机仍需验证：批量填表、锁定保护、真实 Embedding、冷召回、提示词最终位置、聊天切换与移动端 UI。

## 当前状态与已知问题

- v4.0.0 的本地代码与自动测试已完成，尚未复制到 SillyTavern 实际扩展目录，也未执行真实模型/API 回归。
- 为降低一次性重写风险，旧版部分不可达的总结 UI 辅助代码与历史配置字段仍可能存在注释或死分支；总结模块、触发入口、可见配置卡和向量同步入口已移除。后续可继续做纯清理，但不得改变 v2 数据行为。
- 用户显式导入旧文件时会忽略总结表、把旧绿色状态全部转白，再按当前 X 尝试降冷；Embedding 未配置或失败不会丢行。
