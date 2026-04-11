# Nodex Agents Guide

这份文件是给在本仓库内工作的 AI / agent / 自动化协作者看的。

Nodex 当前是一个高度依赖 AI/agent 生成代码的个人项目，所以代码一致性、文档同步和最小验证非常重要。你应该把这份文件当成项目级约束，而不是建议。

## 项目目标

Nodex 的目标不是做“通用聊天应用”，而是做一个：

- 脑图优先
- 节点拓展优先
- patch-first
- local-first
- 历史可追踪、可恢复

的工作台。

任何实现都应该服务于这个方向。如果一个改动虽然“能做”，但会让项目偏向“聊天驱动 UI”或“模型直接接管状态”，那通常不是正确方向。

## 当前技术事实

截至当前版本，仓库已经落地的是“共享 Rust CLI 内核 + 过渡性桌面壳 + provider 调试工具链 + LangChain 最小试点”：

- 工作区目录：`./.nodex/`
- SQLite 数据库：`./.nodex/project.db`
- patch 归档目录：`./.nodex/runs/`
- snapshot 归档目录：`./.nodex/snapshots/`
- source 归档目录：`./.nodex/sources/`
- 导出目录：`./.nodex/exports/`
- AI 运行目录：`./.nodex/ai/`

当前代码的真实能力，以 `src/`、`desktop/` 和 `docs/cli.md` 为准。

这里对 `desktop/` 还有一条额外判断需要明确：

- 当前桌面壳已经证明共享内核、patch 编辑链路和 AI 审计链路可以被桌面端复用
- 但它整体更接近调试 / 审计工作台，不应继续被默认当作最终产品交互方案
- 如果要推进桌面端，优先保留共享内核与 `Tauri` 命令桥，重做前端信息架构和高层交互，而不是绕开现有 `patch / store / ai` 内核

未来目标里提到但尚未实现的内容，以 `docs/roadmap.md` 为准，不要把它们误当成已经存在的能力。

## 架构红线

### 1. Patch-first

所有结构编辑都应优先通过 patch 模型表达。

这意味着：

- 不要新增一条完全绕过 patch 语义的编辑路径
- CLI convenience commands 可以存在，但底层应复用 patch 引擎
- AI 能力未来也应输出 patch，而不是直接回写最终状态

### 1.5 技术栈红线

当前有 3 个明确钦定、默认不应被 agent 自行替换的技术栈：

- `Tauri`
- `LangChain`
- `SQLite`

它们不是“暂时参考”，而是当前项目级决策：

- `Tauri`：未来桌面应用外壳
- `LangChain`：AI 运行时与结构化 patch 编排层
- `SQLite`：本地优先的结构化工作区存储

这意味着：

- 不要擅自把桌面路线改成别的应用壳
- 不要把 AI 层写成绕开 `LangChain` 的长期实现
- 不要把存储层改成不以 `SQLite` 为核心的方案

当前针对 `LangChain` 的默认落点也更明确：

- 先把 LangChain 放在 external runner / scripts 层做最小试点
- 先复用现有 request / response contract、patch validate / apply 和本地审计链
- 不要把 Rust 内核或 SQLite schema 直接改成 LangChain 依赖
- 如果桌面默认 draft route 选择了某条 LangChain 路径，也应继续停留在 external runner / scripts 层，而不是把 provider SDK 直接塞进共享内核

如果任务真的需要触碰这些边界，应先暂停并更新相关文档，而不是直接实现替换。

### 2. Local-first

默认假设工作区是本地优先的。

这意味着：

- 本地状态必须完整可用
- 核心工作流不能依赖云端服务才能成立
- 即使后面接入模型，工作区状态、patch 历史、snapshot 也应保留在本地

### 3. 内核先于壳

先做稳定内核，再做 UI 壳。

这意味着：

- 优先把能力沉到 workspace / patch / data model 层
- 不要为了未来 Tauri UI 提前引入大量前端耦合设计
- 未来如果要做 app 或 AI runtime，尽量复用已有核心能力
- 如果要重做桌面壳，默认重做的是交互层，而不是共享内核

## 文档同步要求

这个仓库的文档不是装饰品，必须随行为变化一起维护。

如果你改了下面这些内容，必须同步更新对应文档：

- CLI 行为变化：更新 `docs/cli.md`
- patch 结构或语义变化：更新 `docs/patch-model.md`
- 工作区目录、SQLite schema、snapshot 语义变化：更新 `docs/data-model.md`
- 架构边界变化：更新 `docs/architecture.md`
- 产品方向或优先级变化：更新 `docs/product.md` 或 `docs/roadmap.md`
- 如果 `Tauri` / `LangChain` / `SQLite` 的角色、边界或约束发生变化：同时更新 `README.md`、`docs/product.md`、`docs/architecture.md`、`docs/roadmap.md` 和本文件

根 `README.md` 只保留入口信息，不要再把长篇产品说明塞回去。

### 文档反哺与收口规则

- 后面再遇到真实踩坑，请优先反哺到最接近当前行为来源的文档里，而不是临时散落在对话里。
- 新经验如果会推翻旧说法，直接替换旧说法，不要继续叠加互相矛盾的补丁说明。
- 优先保留“推荐路径”“已验证路径”“统一入口”，删除失效入口、旧脚本名和一次性试错过程。
- 避免把文档写成排障流水账；重复命令收敛到脚本或统一入口，文档只保留入口、约束、状态判断。
- 涉及时效信息时优先写绝对信息，例如明确路径、命令、schema version、数据目录，不写“现在”“最近”这类相对表述。
- 每次改文档时，顺手检查并清理：
  - 过时的能力边界
  - 重复段落
  - 已不推荐的路径
  - 与相邻文档冲突的说法

## 对 AI/agent 的实现要求

### 1. 小步提交，少做无关重写

- 优先做小而完整的改动
- 不要为了“顺手整理”而大面积重写不相关代码
- 不要随意重命名、搬运或格式化大量文件，除非任务明确需要

### 2. 先用真实能力，再补想象中的能力

- 不要假设未来模块已经存在
- 不要在文档里把未实现能力写得像已完成
- 不要引入“先占位以后再实现”的空壳复杂度，除非任务明确要求

### 3. 保持数据语义清晰

- 节点编辑、patch 历史、snapshot 恢复必须可解释
- 错误消息应尽量说明是哪个节点、哪个 patch、哪个约束失败
- 如果行为对用户可见，优先让输出能帮助排查问题

### 4. 避免静默破坏历史

- 不要删除已有 patch 归档或 snapshot 归档逻辑
- 恢复 snapshot 时，保留安全快照的行为应继续成立
- 如果需要变更历史策略，先同步文档

## Rust / CLI 约定

- 优先保持实现简单、直接、可读
- 避免过早抽象
- 错误统一用 `anyhow` 往上抛，并补上下文
- 命令输出默认先保证可读；如果以后要加 `--json`，也应作为显式模式，而不是破坏当前可读输出
- 新增命令时，优先考虑是否属于：
  - `node`
  - `patch`
  - `snapshot`
  - `export`
  - 未来可能的 `source` / `ai`

## 测试与验证

代码改动后，至少做这些检查：

- `cargo fmt`
- `cargo test`

如果改动涉及 CLI 行为，尽量再补一条最小 smoke test 思路：

- `init`
- 一个最小 patch / node 操作
- `node list` 或 `export outline`

如果是纯文档改动，不需要跑全套测试，但要保证文档之间不互相矛盾。

## 改动前建议阅读顺序

如果你准备修改这个仓库，建议至少读这些文件：

1. `README.md`
2. `docs/product.md`
3. `docs/cli.md`
4. `docs/patch-model.md`
5. 本文件 `AGENTS.md`

如果任务涉及数据或架构，再继续看：

- `docs/data-model.md`
- `docs/architecture.md`
- `docs/roadmap.md`

## 当前最重要的判断标准

当你不确定一个实现是否合适时，用这几个问题检查：

1. 这是否强化了 patch-first，而不是绕开 patch-first？
2. 这是否保持了 local-first，而不是偷偷把核心能力推向云端依赖？
3. 这是否仍然尊重 `Tauri` / `LangChain` / `SQLite` 这三条技术栈红线？
4. 这是否让工作区历史更清晰，而不是更难追踪？

如果答案是否定的，优先停下来重想实现方式。
