# 架构说明

## 核心原则

Nodex 当前坚持：

- 先做稳定内核，再做交互壳
- 高层入口可以多样，低层执行统一收敛到 canonical patch
- 本地状态和历史保留在 SQLite + 本地文件

## 当前分层

### 共享 Rust 内核

- `src/store.rs` 与 `src/store/*`
  工作区、查询、patching、snapshot、source import
- `src/patch.rs`
  patch 结构与预览
- `src/ai.rs`
  AI request / response contract、external runner bridge、AI run 审计
- `src/project.rs`
  工作区发现与路径布局

### CLI

- `src/main.rs`
  命令解析、输出分发、脚本调试入口

### 脚本层

- `scripts/provider_runner.py`
- `scripts/provider_doctor.py`
- `scripts/provider_smoke.py`
- `scripts/langchain_*_runner.py`

这层当前承载 provider 调试与 LangChain 主路落地。
LangChain 已被确认为默认 AI 主路和正式核心能力方向，但当前实现仍主要停留在 scripts / external runner 层，不直接进入 Rust core。

### 桌面端

- `desktop/src-tauri`
  Tauri 命令桥与原生菜单
- `desktop/src`
  React workbench：左栏导航、中栏画布、右栏 `Context / Review`

## 当前边界

- `Tauri` 是桌面壳，不替代共享内核
- `LangChain` 当前以 scripts / external runner 形态承担默认 AI 主路
- `React Flow` 只负责画布呈现和视图状态，不持有 canonical workspace state
- 结构编辑仍应回到 patch validate / apply

## 当前推荐路径

- CLI：工作区验证、核心能力回归、provider 调试
- 桌面端：最小节点工作流验证
- AI：Anthropic-compatible LangChain 默认主路 + external runner + 本地 request / response / metadata 审计

## 当前不做

- 把 provider SDK 直接塞进 Rust core
- 让桌面端绕过 patch 直接写状态
- 继续把重型调试面板放在主舞台
- 现在就展开一轮通用 Intent Layer 重构
