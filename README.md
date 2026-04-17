# Nodex

> patch-first、local-first 的节点拓展工作台

Nodex 不是聊天驱动的画布工具。它当前的核心是：

- 共享 Rust CLI 内核
- 结构化 patch 编辑
- 本地工作区与 SQLite 存储
- source / evidence 最小链路
- external runner + LangChain 默认 AI 主路
- 一版过渡性 Tauri 桌面壳

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

- CLI 内核已可用：`node` / `patch` / `source` / `snapshot` / `export`
- AI 主路已可用：OpenAI-compatible LangChain 作为当前默认推荐路径，继续复用 external runner、AI run 审计和 patch replay 边界
- 桌面端已可验证主路径，但仍是过渡性工作台，不是最终产品形态
- 当前短期重点是桌面三栏主路径收口：
  中栏固定画布，右栏做节点作用域的 assistant workspace，而不是继续扩底层调试入口或面板

## 文档入口

- [文档索引](./docs/README.md)
- [产品定位](./docs/product.md)
- [CLI 使用说明](./docs/cli.md)
- [Patch 模型](./docs/patch-model.md)
- [数据模型](./docs/data-model.md)
- [架构说明](./docs/architecture.md)
- [短期执行清单](./docs/next-steps.md)
- [Desktop V2 蓝图](./docs/desktop-v2.md)
- [路线图](./docs/roadmap.md)

## Agent Guide

仓库级协作约束在 [AGENTS.md](./AGENTS.md)。
