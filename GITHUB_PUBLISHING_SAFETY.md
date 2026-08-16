# GitHub 发布安全与原作者署名规则

> **最高优先级规则：绝对不要影响、打扰或向原作者的 GitHub 仓库写入任何内容。**

本文档用于约束本项目今后的人工操作、Codex 操作和其他自动化发布操作。开始任何 GitHub 相关工作前，必须先阅读并遵守本文档。

## 仓库身份

- **LEASE 自己的发布仓库（唯一允许写入的目标）**：`https://github.com/LEASE-2473/ST-Memory-Context`
- **原作者仓库（只读参考，禁止写入）**：`https://github.com/gaigai315/ST-Memory-Context`
- 本地项目目录：`D:\LEASE AI Project\SillyTavern Project Main\插件\ST-Memory-Context-main`

## 绝对禁止的操作

不得对 `gaigai315/ST-Memory-Context` 或原作者的其他仓库执行以下操作：

- 推送分支、提交、标签或 Release。
- 创建 Pull Request，或把任何 PR 的目标仓库设为原作者仓库。
- 创建 Issue、Discussion、评论、Review 或其他会通知原作者的内容。
- 修改原作者仓库的设置、文件、Wiki、Actions 或任何远程状态。
- 将原作者仓库配置成可写的 Git remote，或使用任何可能向其写入的 Token/账号操作。
- 未经 LEASE 明确逐次确认，以任何方式联系、提及或打扰原作者及贡献者。

## 允许的只读行为

为了核对功能和保留正确署名，可以只读查看、下载、克隆或比较原作者公开仓库。只读操作不得产生 PR、Issue、评论、通知或其他远程写入。

如果需要配置上游参考 remote，必须命名为 `upstream`，且应将推送地址禁用；执行任何 GitHub 写操作前仍须重新核对目标仓库所有者。

## 每次发布前必须核对

1. 执行 `git remote -v`，确认 `origin` 指向 `LEASE-2473/ST-Memory-Context`。
2. 确认当前 GitHub 登录账号和目标仓库均属于 `LEASE-2473`。
3. 如果创建 PR，确认 base/目标仓库是 `LEASE-2473/ST-Memory-Context`，绝不能是 `gaigai315/ST-Memory-Context`。
4. 在任何推送、合并、Release 或仓库迁移前，向 LEASE 清楚说明实际写入目标。
5. 如果目标不明确或出现原作者仓库地址，立即停止，不得猜测。

## 独立性说明

本项目是 LEASE 自行维护的非官方衍生版本。当前代码、功能取舍和后续维护由 LEASE 独立负责，不代表原作者立场，也不应要求原作者为本版本提供支持。

当前 GitHub 仓库可能仍显示 Fork 来源关系；这只是 GitHub 的仓库关系标记，不代表修改会自动回传原作者。若未来要取消 Fork 关系并迁移为完全独立的普通仓库，必须由 LEASE 明确授权后另行操作，不能擅自删除、迁移或重建仓库。

## 原作者与创意来源声明

LEASE Memory Context 魔改自 **gaigai315 / Gaigai Team 及 ST-Memory-Context contributors** 的开源项目 **ST-Memory-Context**。本衍生版本的核心创意、原始设计基础及大量既有实现来源于原项目；LEASE 对这些创意与贡献表示感谢并持续保留署名。

- 原项目：`https://github.com/gaigai315/ST-Memory-Context`
- 原项目声明的许可证：MIT License
- 详细归属与修改范围：见 `ATTRIBUTION.md`、`LICENSE` 和 `README.md`

本声明用于尊重并注明原作者的创意和贡献，不表示原作者认可、参与维护或为 LEASE 版本背书。
