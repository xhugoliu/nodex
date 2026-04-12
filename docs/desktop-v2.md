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

## 当前实现状态

当前代码已经落下一版更硬的最小工作流切口：

- 没有长期驻场的 header / dashboard
- 左栏已收成可折叠导航轨
  - 导入 source 入口也已回到左栏主界面，而不是只留在桌面原生菜单
- 中栏已收成纯画布工作区
- 右栏只保留 `Context / Review`
- 选中节点后，画布节点卡片已直接承接：
  - `Expand`
  - `Explore`
  - `Add Child`
- 画布当前也已具备最小 view-state：
  - viewport 记忆
  - follow-selection
  - reset view
  - 节点展开 / 折叠
  - 局部聚焦模式
- `Review` 会直接显示：
  - 理由摘要
  - direct evidence
  - patch 预览
  - `Preview` / `Apply`
- 从桌面原生导入材料成功后，当前实现会优先选中导入得到的 source root node，
  让路径自然回到 `Context -> Expand/Explore -> Review -> Apply`
- apply 完成后，当前实现会：
  - 显示这次 patch 的结果反馈
  - 如果 patch 新增了节点，优先把用户带到第一个新增节点
- 当前节点摘要、来源上下文和按需编辑已经收回右栏 `Context`
- source detail 当前也不再只是静态切片列表，而开始允许从来源上下文继续打开关联节点与证据节点
- 在已有节点上下文时，source detail 也应允许直接起草 cite / uncite patch，把来源查看继续接回 review / apply 流
- 右栏现在也已有一层轻量 `AI draft route` 提示：
  - 当前 provider / runner / model / auth / env 状态
  - draft 失败时的下一步建议
  - 但它刻意保持为轻量状态层，而不是恢复一整块重型调试面板

这意味着当前实现已经明显偏离“调试 / 审计工作台”，开始进入“最小节点工作流”阶段。

同时也要明确：

- 当前 UI 里已经不再默认暴露工作区级 AI runs / Activity / Run Inspector
- 这些概念如果后续继续保留，应重新评估是否真的值得作为桌面入口存在
- 当前更缺的不是“再找地方把二级入口塞回来”，而是把来源摘要、apply 完成态和 smoke 回归做顺

## 当前接力推进范围

后续会话如果继续推进 desktop v2，默认优先收口当前主路径，而不是扩产品表面积。

当前最值得继续压实的是：

- 守住左栏 source import、右栏来源上下文和 apply 完成态这条已经收顺的主路径
- 把 `打开工作区 -> 选中节点 -> 起草 AI draft -> review -> apply -> 聚焦新增节点` 收成稳定 smoke
- 给轻量 `AI draft route` 提示补回归验证，防止 provider route / auth / env 提示再次静默消失
- 在上面这条闭环稳定后，再补一条 `source import -> 选中来源节点 -> AI expand -> review -> apply` 的真实材料路径
- 保持 source detail 继续是可推进的上下文层，而不是看完就结束的只读面板

当前不应抢占优先级的是：

- 把 `AI runs` / `Activity` / `Run Inspector` 重新放回主舞台
- 把 `AI draft route` 重新膨胀成厚重的调试 / 配置面板
- 为主界面恢复 raw patch、artifact、run-id 等低层概念
- 完整自由画布、复杂拖拽布局或新的状态写入路径
- 为了补视觉热闹度继续加 dashboard、header 或次级面板

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

## 画布引擎决策

桌面 v2 当前默认采用 `React Flow` 作为画布引擎。

这次选择解决的是“桌面端如何承接脑图式空间交互”，不是把 Nodex 改造成另一种状态内核。

当前选择它的原因是：

- 它更贴近节点型 UI，而不是通用白板模型
- 它能直接复用现有 `React` 前端和组件体系
- custom node / edge 足够灵活，适合承接 Nodex 的节点卡片、来源摘要和聚焦反馈
- 它更容易保持“前端是交互层，Rust 内核是状态真相源”这条边界

这条选择的职责边界也要写清楚：

- `React Flow` 负责：
  - 画布空间投影
  - viewport、selection、focus
  - 节点与边的渲染
- `React Flow` 不负责：
  - canonical workspace state
  - patch validate / apply
  - source / evidence / AI 审计存储

因此对 Nodex 来说，更合适的关系是：

> workspace tree / query result -> `React Flow` node-edge projection -> 用户交互 -> façade / patch -> Rust apply

如果后续要补自动布局，也更适合作为这层画布之上的补充能力，例如 `ELKjs`，而不是重新回到一轮画布选型。

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

如果后续仍要保留 Run Inspector、AI runs、Activity，它们也只能作为二级入口存在。

### 3. patch 继续是确认层

人类不必先理解 patch JSON 才能工作，但任何真正写入仍然通过 patch 预览 / 应用边界完成。

### 4. 来源要进入主路径

source / evidence 不是高级功能，而是节点决策上下文的一部分。

### 5. 先做高频流，不先做全能流

先把 80% 高频动作做顺，再考虑完整画布、复杂 compare、多模式编辑。

## v2 信息架构

v2 第一版建议收敛为 3 个层级：

### 1. Main Workbench

这是唯一主舞台。

建议由三块区域组成：

- 左栏：导航
  - 节点树 / 大纲
  - 搜索
  - 可折叠导航轨
  - source import 入口
- 中栏：画布工作区
  - 基于 `React Flow` 的脑图 / 节点画布
  - 当前节点的子节点关系与结构走向
  - apply 后新增节点的聚焦与定位
  - 尽量把高频节点动作直接放在节点卡片内
  - 纯 view-state，例如展开 / 折叠和 focus，不应越界成另一套状态内核
- 右栏：上下文面板
  - 默认显示节点摘要、来源 / evidence、apply 完成态和按需编辑
  - 保留一层轻量的 AI draft route 状态与失败引导
  - 起草后切到 review
  - 不退回“系统控制台式”布局

### 2. Review Layer

这是明确的确认层，而不是长期停留的编辑主界面。

包含：

- patch 预览
- AI 草案理由摘要
- direct evidence / inferred suggestions
- apply

### 3. Secondary Views

这些入口当前不再进入主界面实现范围：

- Run Inspector
- Workspace AI Runs
- Activity
- 原始 request / response / metadata

## v2 主路径

### A. 打开工作区

用户进入后，应立即得到：

- 节点树
- 明确的“下一步可以做什么”

不应先面对：

- 大量调试按钮

### A1. 导入材料

从桌面原生导入材料成功后，界面应优先落到导入生成的 root node，而不是回退到通用 root 选择。

这样主路径会自然收敛成：

- import source
- 查看导入节点上下文与来源
- 直接从该节点发起 `Expand` / `Explore`
- 进入 review 并 apply

### B. 选中节点

选中节点后，中栏应立即可见：

- 画布里的节点位置与邻接关系
- 节点卡片上的高频拓展动作
- apply 后的结构变化焦点

用户应该既可以从左侧大纲选中节点，也可以直接从画布里选中节点。

节点标题、正文、来源摘要和按需编辑不再长期驻留中栏，而是进入右栏 `Context`。

### C. 理解上下文

右栏默认优先显示：

- 这个节点来自哪些 source
- 有哪些明确 evidence citation
- 哪些 chunk 最值得看
- 如果用户打开某个 source detail，也应能继续回到相关节点，而不是断在来源页

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
- 底部动作：应用

### F. 应用 patch

应用完成后回到节点工作区，并给出：

- 结构变化反馈
- 新子节点入口
- 如果新增了多个节点，至少能继续打开其中一个

### G. 当前闭环验收

当前最小桌面闭环应满足：

- 用户不需要离开主舞台，就能完成一次节点级 AI draft -> review -> apply
- apply 后的结果反馈不只是“成功”，而要能回答“改了什么、现在在哪、接下来去哪”
- 如果 patch 新增了节点，系统会优先把用户带到新增节点，并让这个焦点在画布或右栏上下文中可见
- 右栏来源信息应开始帮助用户判断“为什么值得看”，而不只是做来源列表
- 如果刚完成 source import，系统会优先把用户带到导入 root node，而不是回退到工作区根节点

## 现有能力复用清单

### 可直接复用

- Workspace 打开 / 初始化
- Node tree / node detail 查询
- Source detail 查询
- Source import preview / import
- Patch preview / apply
- Snapshot save / restore
- AI dry-run draft
- 最小 apply 结果反馈

当前代码落点主要在：

- `src/store.rs`
- `src/store/queries.rs`
- `src/store/patching.rs`
- `src/store/source_import.rs`
- `src/ai.rs`
- `desktop/src-tauri/src/lib.rs`

### v2 需要补的 façade

这里的 façade 指的是：

> 更贴近桌面交互语义的薄接口，而不是另一套状态内核

当前已经落下这些能力：

- `get_node_workspace_context`
  - 返回当前节点详情和来源上下文
- `draft_node_expand`
  - 封装现有 expand draft，并返回 review 所需 payload
- `draft_node_explore`
  - 封装现有 explore draft，并带 angle 信息
- `apply_reviewed_patch`
  - 继续复用 patch apply，并返回 apply 后的最小结果摘要

下一步最值得补的不是再扩 façade 数量，而是把这些结果做得更贴近人类语义：

- 来源卡片里的“为什么值得看”
- apply 完成后的下一步引导
- 一条稳定的主流程 smoke

如果只做一轮很小的接力实现，优先顺序默认是：

1. 来源卡片摘要
2. apply 完成态与下一步引导
3. 主流程 smoke
4. 真实材料导入后的同一路径回归

这些 façade 的目标是：

- 让前端少拼装低层模型
- 让“节点工作流”天然成为 API 组织方式
- 保持内核不被前端细节反向污染

## 页面级蓝图

### 1. Workspace Start

第一版内容：

- 打开文件夹
- 初始化工作区

验收标准：

- 用户无需理解 `.nodex/`
- 能在 10 秒内进入已有 workspace

### 2. Main Workbench

第一版内容：

- 节点树导航
- `React Flow` 画布主舞台
- 大纲和画布的双向选中同步
- 画布节点卡片上的 `Expand` / `Explore` / `Add Child`
- 可折叠导航轨
- 右栏 `Context` 承担节点详情、来源摘要和按需编辑

验收标准：

- 用户选中节点后，不需要离开画布就能决定下一步是继续拓展还是进入 review
- apply 后如果新增了节点，画布会把用户带到新节点附近，而不是把变化藏起来

### 3. Review Layer

第一版内容：

- AI 理由摘要
- direct evidence 列表
- inferred suggestions 列表
- patch 预览
- 应用
- apply 后回流到最合适的节点

验收标准：

- 用户能在同一层完成“看懂 -> 决定 -> 应用”
- 不必进入 raw patch JSON 才能确认改动

### 4. Secondary Views

第一版内容：

- 当前不进入 UI 实现范围

验收标准：

- 主路径不依赖它们
- 文档不再默认假设它们会立即回接

## 实施顺序

### Phase 0: 文档与切壳

输出：

- 本文档
- 旧桌面壳明确为 legacy
- 新桌面壳开发目录与入口策略确定

### Phase 1: 新壳骨架

输出：

- Main Workbench 基础布局
- 节点树与右栏详情浏览
- `React Flow` 画布投影
- 大纲 / 画布共享选中态

不做：

- Secondary Views
- compare
- 原始 artifact 面板
- 画布直写结构编辑

### Phase 2: 节点主路径

输出：

- 画布节点卡片上的 `Expand` / `Explore` / `Add Child`
- 右栏节点来源摘要
- 右栏 evidence 摘要
- 更少但更稳定的默认可见信息
- apply 后画布聚焦新增节点
- review 完成后稳定回流到画布上下文

### Phase 3: Review Layer

输出：

- AI draft review
- patch preview
- apply 后回流节点页
- apply 后聚焦新增节点

## 迁移策略

建议采用“双壳并行，主路径逐步迁移”：

- 保留底层共享内核与命令桥
- 继续把桌面前端收成更薄的主路径
- 如果后续要恢复二级入口，也应在主路径稳定后再单独评估

不要采用：

- 在现壳中边救火边大重构
- 一次性替换所有桌面代码

## 设计约束

### 必须继续保留

- `Tauri`
- `React Flow` 作为桌面 v2 默认画布层
- patch-first
- local-first
- SQLite 为核心状态存储
- external runner + 本地 AI 审计边界

### 不应继续默认暴露为主概念

- `patch` 原始 JSON
- `run-id`
- request / response / metadata 文件路径
- replay / compare
- AI runs / Activity / Run Inspector

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
4. apply 后系统会明确告诉用户这次结构变化，并把用户继续带到下一个节点。
5. 整个流程继续复用现有共享 Rust 内核，而不是形成第二套状态实现。
6. 画布层继续只是 `React Flow` 投影与交互层，而不是新的状态真相源。
