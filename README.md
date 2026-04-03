# Nodex

> 面向节点拓展的 AI 脑图工作台

Nodex 想做的不是“又一个带聊天框的画布工具”，而是一个以脑图为主界面、以节点拓展为核心交互、以结构化 patch 为编辑内核的本地优先工作台。

当前仓库已经有一版可运行的 Rust CLI 内核、最小桌面壳和 provider 调试工具链，用来先验证这几件事：

- 本地工作区初始化
- 结构化 patch 驱动的节点编辑
- 快照保存与恢复
- Markdown 大纲导出

## Quickstart

```bash
cargo run -- init
cargo run -- source import README.md --dry-run
cargo run -- source import README.md
cargo run -- node list
cargo run -- patch inspect examples/expand-root.json
cargo run -- patch apply examples/expand-root.json
cargo run -- snapshot save --label after-expand
cargo run -- export outline
```

## 当前状态

当前已经落地：

- patch-first CLI 内核：节点编辑、patch 应用、snapshot、outline 导出
- SQLite 本地工作区：`.nodex/`、patch history、AI run 审计、可恢复 snapshot
- Markdown / TXT source import：基础切片、source / node 双向来源链路
- evidence 最小语义：显式 citation、`direct` / `inferred`、rationale
- AI request / response contract：`expand` / `explore` dry-run、external runner bridge、解释层
- 多 provider 调试工具链：`openai` / `codex` / `gemini` runner，统一 `doctor` / `status` / `providers` / `smoke`
- 最小 Tauri 桌面壳：三栏工作台、AI draft 入口、AI 历史回看 / trace / 工件查看、原生菜单驱动的低频动作

当前还没落地：

- 更完整的 AI 能力：来源问答 / 更强的结果解释与比较 / 更稳定的 explore 策略
- PDF 导入与来源切片
- 完整来源追踪与证据视图
- 完整 Tauri 图形界面

## Docs

- [文档索引](./docs/README.md)
- [产品定位](./docs/product.md)
- [CLI 使用说明](./docs/cli.md)
- [Patch 模型](./docs/patch-model.md)
- [数据模型](./docs/data-model.md)
- [架构说明](./docs/architecture.md)
- [长期路线图](./docs/roadmap.md)
- [短期执行清单](./docs/next-steps.md)

## Agent Guide

这个项目高度依赖 AI / agent 协作开发，仓库级协作约束写在：

- [AGENTS.md](./AGENTS.md)

如果你是第一次进入这个仓库，建议阅读顺序是：

1. `README.md`
2. `docs/product.md`
3. `docs/cli.md`
4. `docs/patch-model.md`
5. `AGENTS.md`
