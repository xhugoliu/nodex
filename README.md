# Nodex

> 面向节点拓展的 AI 脑图工作台

Nodex 想做的不是“又一个带聊天框的画布工具”，而是一个以脑图为主界面、以节点拓展为核心交互、以结构化 patch 为编辑内核的本地优先工作台。

当前仓库已经有一版可运行的 Rust CLI MVP，用来先验证这几件事：

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

- patch-first CLI 内核
- SQLite 工作区
- Markdown / TXT source import 与基础来源切片关联
- source / node 双向查看来源链路
- 显式 evidence 引用：将证据引用与导入关联分离
- `nodex ai expand <node-id> --dry-run` 本地预览骨架
- AI request / response contract：可导出 request，并回放外部 response
- external runner bridge：可通过本地命令完成 request -> response -> patch 预览
- 开发用最小 OpenAI runner：`scripts/openai_runner.py`
- patch 历史归档
- snapshot 保存与恢复
- Markdown outline 导出
- 基于 React + Vite + TypeScript + Tailwind CSS 的最小 Tauri 桌面壳
- 单屏三栏桌面工作台：树 / 详情摘要 / 统一编辑器
- 工作区入口收敛为“打开文件夹后自动打开或初始化”
- 由原生 Tauri 菜单栏承载低频动作：语言、source import、snapshot、历史 patch
- 可从来源详情为上下文节点起草 cite / uncite patch

当前还没落地：

- 真实 AI 生成 patch
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
- [路线图](./docs/roadmap.md)

## Agent Guide

这个项目高度依赖 AI / agent 协作开发，仓库级协作约束写在：

- [AGENTS.md](./AGENTS.md)

如果你是第一次进入这个仓库，建议阅读顺序是：

1. `README.md`
2. `docs/product.md`
3. `docs/cli.md`
4. `docs/patch-model.md`
5. `AGENTS.md`
