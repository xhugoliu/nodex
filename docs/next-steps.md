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

> 打开工作区 -> 选中一个节点 -> 看懂节点上下文与来源 -> 用 Anthropic-compatible LangChain 默认主路起草 AI draft -> 预览 patch -> 再决定是否应用

短期内，判断优先级时优先看这条路径是否更顺，而不是入口是否更多、界面是否更大。

## 当前判断

当前新的关键判断是：

- 共享内核已经足够支撑桌面端，问题不在内核
- 当前桌面壳虽然完成了复用验证，但整体更像调试 / 审计工作台，不适合作为长期产品基线
- 因此短期优先级应从“继续在现壳上补面板”转向“保留内核与边界，重做一版人类可用桌面端”

在这个判断下，当前最缺的不是“desktop 里能不能看 run / compare / replay / activity”，而是缺：

- 文档是否和当前实现完全对齐
- 桌面 v2 的主路径和信息架构是否清楚
- 真实 provider 路径是否有稳定、可回归的验证入口
- 默认链路是否足够清楚，而不是继续扩更多壳层入口
- LangChain 试点是否真正停留在 external runner 边界内，而不是过早长成第二套主链

另外有一条新的短期边界需要明确：

- 当前桌面壳的节点级 Run Inspector、工作区级 AI runs 和 Activity 视图，已经足够承担审计与回看任务
- 它们应继续保留，但更适合作为二级入口或调试入口，而不是主舞台
- 旧桌面壳进入 legacy / 维护态，只做最小修补、回归修复和与当前实现对齐的收口

因此这里优先描述“下一步该压实什么”，而不是继续把已完成的 desktop 能力当成待办。

## 当前执行顺序

### 1. 先收口桌面 v2 的边界与文档口径

状态：当前优先级最高

目标：

- 避免 README、架构、路线图和短期清单之间继续把当前桌面壳写成“继续叠代即可”的基线
- 明确写清：旧桌面壳是过渡性调试 / 审计壳，下一步是基于现有内核重做桌面端
- 明确写清：桌面重做保留 `Tauri`、共享 Rust 内核、patch-first、本地审计边界
- 删除已经失效的短期优先级描述，避免后续协作继续按旧方向在现壳上堆面板

下一轮最小切口：

- 同步这些文档里的当前桌面定位、边界和下一步方向：
  - `README.md`
  - `docs/product.md`
  - `docs/architecture.md`
  - `docs/roadmap.md`
  - `docs/next-steps.md`
- 落一份单独的 `docs/desktop-v2.md`，把主路径、信息架构、复用边界和实施顺序写成统一入口
- 优先保留：
  - 共享内核和 patch-first 的既有边界
  - 已验证的 AI 审计链路
  - 默认 Anthropic-compatible LangChain 试点链路
- 直接移除：
  - 把旧桌面壳误写成最终产品交互的旧表述
  - 暗示“继续扩几个面板就能变好用”的短期计划
  - 与“保留内核、重做交互壳”相冲突的描述

### 2. 基于现有内核重做一版人类可用桌面端

状态：文档收口后立即进入

目标：

- 保留 `Tauri`、共享 Rust 内核、patch-first、本地审计边界
- 把主界面从“调试 / 审计导向”改成“节点工作流导向”
- 降低主界面对 `patch` / `run-id` / artifact 等低层概念的直接暴露
- 把 Run Inspector、AI runs、Activity 收到二级入口，而不是继续占据主舞台

当前最小切口：

- 收敛一个唯一主路径：
  - 打开工作区
  - 选中节点
  - 查看节点上下文 / 来源
  - 起草 AI draft
  - 预览 patch
  - 应用 patch
- 为桌面补一层更贴近交互语义的 façade / intent-like 入口
- 不要求第一版就做完整画布；先把信息架构和高频节点工作流做顺
- 旧桌面壳与新壳并行期间，默认把旧壳视为 legacy，而不是继续在其上叠大块新交互
- 具体页面结构与阶段目标，以 `docs/desktop-v2.md` 为实现入口

### 3. 把默认 LangChain 主路和对照路径继续做成可比较验证

状态：与桌面重做并行推进

目标：

- 把现有 Anthropic-compatible LangChain 默认链路整理成可重复执行的 smoke / e2e 路径
- 让 `run-id -> artifact -> compare -> replay -> apply` 这条链路能做回归，而不是只靠手动演示
- 继续保持 external runner 边界，不把 provider SDK 直接塞进 Rust 内核
- 让 LangChain 试点继续作为同 contract 的默认试点主路和对照组存在

当前最小切口：

- 以 `langchain_anthropic_runner.py` 作为当前默认试点主路
- 再用 `openai_runner.py` 和 `langchain_openai_runner.py` 作为平行对照
- 也允许通过 `scripts/runner_compare.py --preset langchain-pilot` 把这条对照流程收成统一入口
- Anthropic 主路的 smoke 也应优先补到 `--scenario source-context` 这种真实来源节点，而不只停在 root 空树
- 优先覆盖这些动作的最小闭环：
  - `draft`
  - `show`
  - `artifact`
  - `compare`
  - `replay`
  - 可选的最终 apply
- 如果当前默认 Anthropic-compatible 路径需要先确认配置，优先先跑：
  - `nodex ai doctor --provider anthropic --format json`

### 4. 旧桌面壳只做必要维护

状态：legacy / 维护态

目标：

- 如果桌面重做前暴露出阻塞性问题，只做最小修补
- 不再继续主动增加新的 desktop 主视图或在现壳上大块重构

当前 scope 先冻结在这些已落地入口：

- 节点级 Run Inspector
- 工作区级 AI runs
- 工作区级 Activity
- patch 编辑器和 run inspector 的互跳

### 5. 再补来源能力与多 provider 抽象

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

- 继续在当前 legacy 桌面壳上扩主视图、补更多面板或做局部润色式“救火”
- 过早扩很多 AI 入口，但每条都不够可解释
- 把 evidence 语义一次性做成很重的文献系统
- 为未来能力提前铺太多空壳结构
- 在真实 provider 主路径还没顺之前，就发起一轮通用 Intent Layer 重构

## 更新要求

后续更新这份文档时：

- 直接重写“当前优先级”“当前最小切口”“当前阻塞点”
- 不记录按轮次累积的完成项
- 不把它写成开发日报或提交摘要
