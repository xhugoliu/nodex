# Desktop V2 蓝图

这份文档描述 Nodex 下一版桌面端的落地蓝图。

它服务的不是“远期愿景”，而是：

- 在保留现有共享 Rust 内核的前提下
- 重做一版真正面向人类高频使用的桌面端
- 让后续实现不再默认沿着当前 legacy 桌面壳继续堆面板

如果本文和这些文档冲突，以它们为准：

- 架构边界：`docs/architecture.md`
- 短期优先级：`docs/next-steps.md`
- patch 语义：`docs/patch-model.md`
- CLI / AI contract 当前行为：`docs/cli.md`

## 一句话目标

做一版“节点工作流优先”的桌面端，而不是“调试 / 审计入口优先”的桌面端。

当前主路径应收敛成：

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> 预览 patch -> 应用 patch

## 基本判断

当前桌面壳已经证明了这些事：

- 共享 Rust 内核可以被 Tauri 复用
- source import、snapshot、patch apply、AI run 审计链路都能接进桌面
- 当前 Anthropic-compatible LangChain 默认试点链路也能被桌面端调用

但当前桌面壳的问题也已经很明确：

- 主界面暴露了过多 `patch` / `run-id` / artifact 等低层概念
- Run Inspector、AI runs、Activity 这些调试 / 审计入口占据了过高层级
- 信息架构更像“内核演示台”，不像“人类工作台”

因此 v2 的核心不是重写内核，而是：

- 保留现有 `Tauri`
- 保留共享 Rust 内核
- 保留 patch-first / local-first / AI 审计边界
- 重做桌面交互层和信息架构

## 非目标

v2 第一版先不做这些事：

- 不重写 `src/store.rs`、`src/patch.rs`、`src/ai.rs` 的核心边界
- 不把 AI 直接改成绕开 external runner 的长期实现
- 不在第一版里强行做完整自由画布 / 自动布局系统
- 不把 evidence 一次性扩成很重的文献管理器
- 不在第一版里发起通用 Intent Layer 大重构

## 产品原则

### 1. 节点优先于面板

主界面首先服务“节点工作流”，而不是服务“系统调试能力展示”。

### 2. 审计存在，但退到二级

Run Inspector、AI runs、Activity 仍然保留，但默认不占主舞台。

### 3. patch 继续是确认层

人类不必先理解 patch JSON 才能工作，但任何真正写入仍然通过 patch 预览 / 应用边界完成。

### 4. 来源要进入主路径

source / evidence 不是高级功能，而是节点决策上下文的一部分。

### 5. 先做高频流，不先做全能流

先把 80% 高频动作做顺，再考虑完整画布、复杂 compare、多模式编辑。

## v2 信息架构

v2 第一版建议收敛为 4 个层级：

### 1. Workspace Home

作用：

- 打开或初始化工作区
- 最近工作区列表
- 明确当前 workspace 名称、节点数、来源数、最近活动摘要

这层解决的是“怎么进入工作台”，不是编辑本身。

### 2. Main Workbench

这是唯一主舞台。

建议由三块区域组成：

- 左栏：导航
  - 节点树 / 大纲
  - 搜索
  - 重要筛选，例如仅看有来源、仅看最近改动
- 中栏：当前节点工作区
  - 节点标题、正文、类型
  - 子节点概览
  - 关联来源 / evidence 摘要
  - 当前节点可执行动作
- 右栏：上下文面板
  - 默认显示来源 / evidence / AI 草案预览
  - 在不同动作间切换，但不退回“系统控制台式”布局

### 3. Review Layer

这是明确的确认层，而不是长期停留的编辑主界面。

包含：

- patch 预览
- AI 草案理由摘要
- direct evidence / inferred suggestions
- apply / cancel / back to node

### 4. Secondary Views

这些入口保留，但全部退为二级：

- Run Inspector
- Workspace AI Runs
- Activity
- 原始 request / response / metadata
- 原始 patch JSON 高级模式

## v2 主路径

### A. 打开工作区

用户进入后，应立即得到：

- 当前工作区名称
- 节点树
- 最近上下文
- 明确的“下一步可以做什么”

不应先面对：

- patch 编辑器
- 控制台
- 大量调试按钮

### B. 选中节点

选中节点后，中栏应立即可见：

- 节点标题
- 节点正文
- 节点类型
- 父节点 / 兄弟节点 / 子节点摘要
- 关联 source 与 evidence 的简洁摘要

### C. 理解上下文

右栏默认优先显示：

- 这个节点来自哪些 source
- 有哪些明确 evidence citation
- 哪些 chunk 最值得看

默认不优先显示：

- run-id
- 原始 artifact 文件路径
- patch run id

### D. 起草 AI draft

节点页直接提供两个主动作：

- `Expand`
- `Explore`

第一版 `Explore` 可继续保留：

- `risk`
- `question`
- `action`
- `evidence`

但交互上应先是“我要从哪个角度继续拓展”，而不是“我要查看 AI 审计系统”。

### E. 进入 Review Layer

起草完成后进入统一 review：

- 上半区：理由摘要 + evidence
- 下半区：patch 预览
- 底部动作：应用 / 返回继续修改

只有在用户主动展开时，才显示：

- 原始 request
- 原始 response
- metadata
- compare / replay

### F. 应用 patch

应用完成后回到节点工作区，并给出：

- 结构变化反馈
- 新子节点入口
- 必要时的“查看本次 AI run”二级链接

## 二级路径

这些路径继续保留，但默认不抢主路径：

### Run Inspector

适用场景：

- 解释本次 AI draft 为什么这样生成
- 看 request / response / metadata
- replay dry-run
- compare 不同 run

建议入口：

- 节点页中的“查看本次 AI 运行详情”
- 工作区级 AI runs 页面

### Workspace AI Runs

适用场景：

- 跨节点审查最近 AI draft
- 查失败 run
- 从 run 回到节点

### Activity

适用场景：

- 查看 patch run、AI run、snapshot 的统一时间线
- 载入历史 patch
- 恢复 snapshot

## 现有能力复用清单

### 可直接复用

- Workspace 打开 / 初始化
- Node tree / node detail 查询
- Source detail 查询
- Source import preview / import
- Patch preview / apply
- Snapshot save / restore
- AI dry-run draft
- AI run history / show / artifact / patch / replay / compare

当前代码落点主要在：

- `src/store.rs`
- `src/store/queries.rs`
- `src/store/patching.rs`
- `src/store/source_import.rs`
- `src/ai.rs`
- `desktop/src-tauri/src/lib.rs`

### 应保留但降级为二级入口

- patch 编辑器长期驻场
- 工作区级 AI runs 作为主面板
- Activity 作为主面板
- request / response / metadata 直接暴露
- compare / replay 作为高频主动作

### v2 需要补的 façade

这里的 façade 指的是：

> 更贴近桌面交互语义的薄接口，而不是另一套状态内核

建议优先补这些能力：

- `get_workspace_home`
  - 返回 workspace 名称、节点数、来源数、最近 activity 摘要
- `get_node_workspace_context`
  - 在一个 payload 中返回节点详情、来源摘要、evidence 摘要、最近 AI run 摘要
- `draft_node_expand`
  - 封装现有 expand draft，并返回适合 review 层展示的数据
- `draft_node_explore`
  - 封装现有 explore draft，并带 angle 信息
- `apply_reviewed_patch`
  - 继续复用 patch apply，但返回更贴近节点工作流的结果摘要
- `get_recent_node_activity`
  - 针对当前节点返回 patch / AI / snapshot 相关摘要，而不是整个工作区时间线

这些 façade 的目标是：

- 让前端少拼装低层模型
- 让“节点工作流”天然成为 API 组织方式
- 保持内核不被前端细节反向污染

## 页面级蓝图

### 1. Workspace Start

第一版内容：

- 打开文件夹
- 初始化工作区
- 最近工作区

验收标准：

- 用户无需理解 `.nodex/`
- 能在 10 秒内进入已有 workspace

### 2. Main Workbench

第一版内容：

- 节点树导航
- 当前节点详情
- 来源 / evidence 摘要
- Expand / Explore 主动作
- 子节点快速查看与跳转

验收标准：

- 用户选中节点后，不需要打开任何二级面板，就能决定下一步是继续写、看来源还是起草 AI draft

### 3. Review Layer

第一版内容：

- AI 理由摘要
- direct evidence 列表
- inferred suggestions 列表
- patch 预览
- 应用 / 返回

验收标准：

- 用户能在同一层完成“看懂 -> 决定 -> 应用”
- 不必进入 raw patch JSON 才能确认改动

### 4. Secondary Views

第一版内容：

- AI runs
- Activity
- Run Inspector

验收标准：

- 调试与审计能力仍然可达
- 但不阻塞主路径

## 实施顺序

### Phase 0: 文档与切壳

输出：

- 本文档
- 旧桌面壳明确为 legacy
- 新桌面壳开发目录与入口策略确定

### Phase 1: 新壳骨架

输出：

- Workspace Start
- Main Workbench 基础布局
- 节点树与节点详情浏览

不做：

- Activity
- compare
- 原始 artifact 面板

### Phase 2: 节点主路径

输出：

- 节点来源摘要
- evidence 摘要
- Expand / Explore 动作入口

### Phase 3: Review Layer

输出：

- AI draft review
- patch preview
- apply 后回流节点页

### Phase 4: 二级审计入口回接

输出：

- Run Inspector
- Workspace AI Runs
- Activity

原则：

- 只作为 secondary views 回接
- 不重新占据主布局中心

## 迁移策略

建议采用“双壳并行，主路径逐步迁移”：

- 保留当前 legacy 桌面壳，直到 v2 的主路径闭环跑通
- 新壳先只接最小工作流
- 当 v2 主路径稳定后，再决定 legacy 的保留范围

不要采用：

- 在现壳中边救火边大重构
- 一次性替换所有桌面代码

## 设计约束

### 必须继续保留

- `Tauri`
- patch-first
- local-first
- SQLite 为核心状态存储
- external runner + 本地 AI 审计边界

### 不应继续默认暴露为主概念

- `patch` 原始 JSON
- `run-id`
- request / response / metadata 文件路径
- replay / compare

### 应提升为主概念

- 当前节点
- 来源上下文
- 证据支持
- 下一步拓展动作
- 结构变更确认

## Definition Of Done

当 v2 第一版完成时，应满足这些判断：

1. 新用户可以不理解 patch / run / artifact 就完成一次节点拓展。
2. 用户可以在主界面中看懂节点来源上下文，而不是只能看到树和编辑器。
3. AI draft 的理由、证据和 patch 预览可以在一个统一 review 流里完成。
4. Run Inspector、AI runs、Activity 仍然存在，但已经退为二级入口。
5. 整个流程继续复用现有共享 Rust 内核，而不是形成第二套状态实现。
