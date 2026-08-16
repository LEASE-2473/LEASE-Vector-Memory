# 原项目归属与修改说明

## 原项目

- 项目名称：ST-Memory-Context
- 原项目地址：https://github.com/gaigai315/ST-Memory-Context
- 原作者及贡献者：gaigai315、Gaigai Team 及 ST-Memory-Context contributors
- 原项目声明的许可证：MIT License

本仓库是上述项目的非官方衍生版本。原项目代码及既有内容的权利归原作者和相应贡献者所有；LEASE 仅对本衍生版本中的新增和修改部分负责。本项目不代表原作者立场，也未获得原作者的官方背书。

LEASE Vector Memory 的核心创意、原始设计基础及大量既有实现来源于原项目。LEASE 对 gaigai315、Gaigai Team 及所有原项目贡献者的创意和工作表示感谢，并在后续魔改与发布中持续保留署名。

为避免影响或打扰原作者，本项目的所有提交、分支、Pull Request、Issue、Release 和其他写操作都只能发生在 LEASE 自己的仓库。原作者仓库仅用于只读参考和来源署名；详细安全规则见 [GITHUB_PUBLISHING_SAFETY.md](GITHUB_PUBLISHING_SAFETY.md)。

## 当前维护者

- 维护者：LEASE
- GitHub：https://github.com/LEASE-2473

## 主要修改

- 保留记忆表格、自动批量填表、手动追溯、外部知识书和独立向量检索能力。
- 新增稳定 R 行编号、行级冷热、锁定热行、手工记忆、逐表 X 和事务保护。
- 直接将每张详情表的每一行向量化，不再生成或向量化 AI 总结表。
- 移除全部二次总结链、总结控制台、总结表、总结提示词及普通世界书总结同步。
- 保留隐藏存储书 `LEASE_Vector_Memory_Database`，仅用于向量数据持久化。

详细行为与当前限制见 `README.md` 和 `CHANGELOG.md`。
