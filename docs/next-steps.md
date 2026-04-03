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

当前已经不再缺“能力是否存在”，而是缺“主路径是否足够顺手、默认路径是否足够清楚”。

因此这里不再逐条复述已完成项；已落地能力请以这些文档为准：

- `docs/cli.md`
- `docs/architecture.md`
- `README.md`

## 当前执行顺序

### 1. 把真实 provider 路径做成产品态

状态：当前优先级最高

目标：

- 不再停留在“桥接能力已存在但用户感知不强”的状态
- 把现有 external runner 路径做成默认可理解、默认可排查、默认可回看的真实运行路径
- 保持 external runner 边界，不急着把 provider SDK 写进 Rust 内核

下一轮最小切口：

- 把 Codex 这条调试链路继续压实成默认可用路径：
  - 让一次 Codex draft 的 request / response / patch / 最终 apply 状态更容易串起来看
  - 把 relay `502`、schema 输出不稳定、环境变量覆盖这三类问题区分清楚
- 继续收口“默认路径”：
  - 优先让桌面和 CLI 都更少依赖手写命令
  - 优先让用户看到当前 provider / runner / model / mode，而不是去猜
- 继续收口“排查动作”：
  - 让失败提示直接链接到更可执行的下一步
  - 让 request / response / metadata / patch run 之间的关系更少靠人工拼接

短期只关心这条流程是否顺手：

- 选节点
- 用真实 provider 起草 expand / explore
- 查看理由和证据
- 预览 patch
- 应用 patch
- 回看历史

补充说明：

- 当前更适合把 `codex_runner.py` 作为后端调试主路，而不是继续依赖裸 HTTP 的 `openai_runner.py`
- 如果同一机器上还保留 `OPENAI_*` 环境变量，优先先跑 `nodex ai doctor --provider codex --format json`

### 2. 串顺桌面主流程

状态：和 1 配套推进，但不抢前面优先级

目标：

- 用现有 Tauri 壳把核心链路串顺
- 不急着把 GUI 做大

当前最小关注点：

- 当前节点上下文在 draft / apply / refresh 之后保持稳定
- 节点详情里的最近 AI 运行记录、patch 编辑器和 apply 结果之间切换更自然
- AI run 相关信息优先在现有详情区和控制台里收口，不急着另起重型调试面板

### 3. 再补来源能力

状态：前面主路径顺了之后再进入

当前暂缓但明确在后面的项：

- `PDF import`
- 来源问答
- 更完整的 evidence 视图

### 3.5 推进多 provider 抽象

状态：在 Codex 链路稳定后立即进入，不晚于来源能力前期设计

目标：

- 不把当前 Codex 路径做成一次性的脚本特判
- 在保持 external runner 边界的前提下，为后续多 provider 接入预留稳定抽象

当前判断：

- `cc-switch` 的借鉴点主要不在“再写一个更重的代理”，而在：
  - 把 live config 读写当作一等能力
  - 把环境变量冲突当作显式诊断项
  - 把不同 provider 的 URL / auth / config 语义拆成独立适配层

进入这个阶段时，优先看这几个问题：

- 当前 provider 抽象是否已经能覆盖默认路径，而不是只覆盖脚本层
- `provider_runner.py` 是否已经足够承担统一入口，而不是继续叠 provider-specific 调用样式
- future runners 是否至少统一这些能力：
  - provider config 发现
  - auth/source 诊断
  - transient error 分类与重试
  - runner mode（schema / plain / fallback）

### 4. 最后再做更完整的脑图 GUI

状态：当前不是短期重点

说明：

- 画布、大型交互、完整脑图主界面都重要
- 但它们应该建立在“AI 节点拓展主路径已经足够可信和顺手”的前提上

## 暂不优先

下面这些方向没有被否定，只是当前不应抢占前面顺序：

- 先把桌面壳做成很重的完整应用
- 过早扩很多 AI 入口，但每条都不够可解释
- 把 evidence 语义一次性做成很重的文献系统
- 为未来能力提前铺太多空壳结构

## 更新要求

后续更新这份文档时：

- 直接重写“当前优先级”“当前最小切口”“当前阻塞点”
- 不记录按轮次累积的完成项
- 不把它写成开发日报或提交摘要
