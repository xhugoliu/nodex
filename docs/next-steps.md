# 短期执行清单

这份文档只服务于当前几轮开发，不替代长期路线图。

它的用途是：

- 让不同对话可以快速接力
- 让短期优先级可以高频修正
- 避免把 `docs/roadmap.md` 写成过细的执行日志

如果这份文档和其他文档冲突，以这些文档为准：

- 已实现 CLI 行为：`docs/cli.md`
- patch 结构和语义：`docs/patch-model.md`
- 数据模型和 SQLite schema：`docs/data-model.md`
- 架构边界：`docs/architecture.md`
- 长期阶段规划：`docs/roadmap.md`

## 使用方式

- 每次开启新对话，先读这份文档，再读本次要改动对应的专项文档
- 只有当短期优先级、阻塞点或下一步切口发生变化时，才重写这份文档
- 这里优先记录“现在该做什么”，不要按对话轮次追加已完成事项
- 如果某项已经不再是短期重点，就从这里移走，保留到 `docs/roadmap.md`

## 当前主路径

当前最值得压实的产品路径是：

> 选中一个节点 -> 用真实 provider 起草 AI draft -> 用户能看懂理由和证据 -> 预览 patch -> 再决定是否应用

短期内，判断优先级时优先看这条路径是否更顺，而不是入口是否更多、界面是否更大。

## 当前判断

当前已经不再缺“desktop 里能不能看 run / compare / replay / activity”，而是缺：

- 文档是否和当前实现完全对齐
- 真实 provider 路径是否有稳定、可回归的验证入口
- 默认链路是否足够清楚，而不是继续扩更多壳层入口

另外有一条新的短期边界需要明确：

- 当前桌面壳的节点级 Run Inspector、工作区级 AI runs 和 Activity 视图，已经足够承担当前审计与回看任务
- 短期内不再把“继续扩 desktop 主视图”作为优先级
- 如果桌面端再改，只做最小的修补、回归修复和与当前实现对齐的收口

因此这里优先描述“下一步该压实什么”，而不是继续把已完成的 desktop 能力当成待办。

## 当前执行顺序

### 1. 先收口文档与行为边界

状态：当前优先级最高

目标：

- 避免 README、CLI、架构、数据模型和短期清单之间出现实现漂移
- 把 desktop 当前已经落地的审计链路准确写清楚
- 删除已经失效的短期优先级描述，避免后续协作继续按旧方向推进

下一轮最小切口：

- 同步这些文档里的当前 desktop / AI run 审计描述：
  - `README.md`
  - `docs/cli.md`
  - `docs/architecture.md`
  - `docs/data-model.md`
  - `docs/next-steps.md`
- 优先保留：
  - 推荐路径
  - 已验证路径
  - 默认行为
- 直接移除：
  - 已不再推荐的 desktop 方向
  - 已经被实现替代的旧表述
  - 与当前行为冲突的短期计划

### 2. 把真实 provider 路径做成可回归验证

状态：文档收口后立即进入

目标：

- 把现有 `codex` 默认链路整理成可重复执行的 smoke / e2e 路径
- 让 `run-id -> artifact -> compare -> replay -> apply` 这条链路能做回归，而不是只靠手动演示
- 继续保持 external runner 边界，不把 provider SDK 直接塞进 Rust 内核

当前最小切口：

- 以 `codex` 作为真实验证主路
- 优先覆盖这些动作的最小闭环：
  - `draft`
  - `show`
  - `artifact`
  - `compare`
  - `replay`
  - 可选的最终 apply
- 如果同一机器上还保留 `OPENAI_*` 环境变量，优先先跑：
  - `nodex ai doctor --provider codex --format json`

### 3. 桌面壳只做必要修补

状态：维护态，不再主动扩新主视图

目标：

- 如果文档梳理或回归验证暴露出问题，只做最小修补
- 不再继续主动增加新的 desktop 审计面板或大块交互

当前 scope 先冻结在这些已落地入口：

- 节点级 Run Inspector
- 工作区级 AI runs
- 工作区级 Activity
- patch 编辑器和 run inspector 的互跳

### 4. 再补来源能力与多 provider 抽象

状态：前面两项压实后再进入

当前暂缓但明确在后面的项：

- `PDF import`
- 来源问答
- 更完整的 evidence 视图
- 多 provider 抽象的进一步统一
  - provider config 发现
  - auth/source 诊断
  - transient error 分类与重试
  - runner mode（schema / plain / fallback）

## 暂不优先

下面这些方向没有被否定，只是当前不应抢占前面顺序：

- 继续扩 desktop 主视图或把桌面壳做成更重的完整应用
- 过早扩很多 AI 入口，但每条都不够可解释
- 把 evidence 语义一次性做成很重的文献系统
- 为未来能力提前铺太多空壳结构
- 在真实 provider 主路径还没顺之前，就发起一轮通用 Intent Layer 重构

## 更新要求

后续更新这份文档时：

- 直接重写“当前优先级”“当前最小切口”“当前阻塞点”
- 不记录按轮次累积的完成项
- 不把它写成开发日报或提交摘要
