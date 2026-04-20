# Docs

`docs/` 只保留长期有效的信息，不记录对话过程或执行日志。

## 文档分工

- `README.md`
  入口、当前状态、文档索引。
- `docs/product.md`
  这个项目想成为什么，不想成为什么。
- `docs/cli.md`
  当前 CLI 的推荐入口和最常用流。
- `docs/patch-model.md`
  canonical patch 的最小约束。
- `docs/data-model.md`
  `.nodex/`、SQLite 和 AI 工件的持久化边界。
- `docs/architecture.md`
  共享内核、脚本层、桌面壳之间的边界。
- `docs/next-steps.md`
  当前最值得继续推进的切口。
- `docs/desktop-v2.md`
  桌面端的信息架构与主路径约束。
- `docs/roadmap.md`
  长期阶段，不写短期执行细节。
- `docs/langchain-pilot.md`
  LangChain 核心路线与当前落地边界。

## 阅读顺序

1. `README.md`
2. `docs/product.md`
3. `docs/cli.md`
4. `docs/patch-model.md`
5. `docs/data-model.md`
6. `docs/architecture.md`
7. `AGENTS.md`

## 更新规则

- 旧说法失效时直接替换，不叠补丁。
- 推荐路径只保留一个，次优路径少写。
- 命令细节优先收敛到 `--help`、脚本或统一入口。
- 短期优先级写在 `docs/next-steps.md`，不要回灌到其他文档。
- 测试覆盖、实现细节、状态字段默认写摘要，不展开成长清单；细节以代码、测试和脚本输出为准。

## 提交约定

- 提交信息默认用简体中文，标题保持短、直、单一目的。
- 正文不是必填；需要写时，只保留 1-3 条对后续阅读真的有帮助的信息，例如行为变化、关键验证、未覆盖风险。
- 不把提交信息写成日报、长篇复盘或固定评审模板；默认不要展开 `Constraint`、`Rejected`、`Confidence`、`Directive` 这类段落。
- 如果使用 `$git-commit-message`，也以这里的项目风格为准，不盲目继承一次性异常历史样式。
