# 路线图

本文把 Nodex 的推进拆成多个阶段，目的是避免“一次性把所有想法都实现”。

## 当前阶段

当前已经完成阶段一的最小内核，并且为后续几个阶段都跑出了一条最小验证切口。

目前可以把项目理解成：

- 阶段一：CLI 内核已经站住
- 阶段二：资料导入已经有最小落地
- 阶段三：AI patch 已经有 dry-run / external runner 的最小闭环
- 阶段四：来源与证据已经有最小语义分层
- 阶段五：Tauri 桌面链路已经完成最小验证，但当前壳仍偏调试 / 审计工作台

这对应的核心判断仍然是：

> patch-first 的本地工作区模型是否站得住

更细的短期执行顺序请看 [短期执行清单](./next-steps.md)，各阶段当前落地情况见下文。

## 跨阶段结构方向

除阶段推进外，还有一条跨阶段都应保持的结构方向：

> 高层入口可以多样，低层执行仍然统一收敛到 canonical patch。

长期可以把 Nodex 理解成三层：

- Intent Layer：面向 GUI / CLI convenience / 未来 AI / agent 的高层表达
- Canonical Patch Layer：唯一稳定的 validate / apply / archive 边界
- State Layer：SQLite + 本地文件的 local-first 存储

这里要特别区分两件事：

- 这是长期演化方向
- 这不是当前要立即展开的一轮大重构

当前仍然以现有 primitive patch 作为 canonical patch。

如果后面推进这条方向，更适合优先验证：

- `add_subtree` 这类高层动作是否真的降低 GUI / AI authoring 成本
- selector-based 节点寻址是否值得引入
- history 是否值得同时保留 authored intent 和 compiled patch
- source / evidence 的高层语义是否能保持 patch-first 而不损失可解释性

## 阶段一：CLI 内核

目标：

- 让本地工作区跑通
- 让 patch 成为统一的编辑入口
- 让状态历史可恢复

当前基础：

- 已形成一套 patch-first CLI 内核，覆盖节点编辑、patch 应用、snapshot、导出和基础查询输出
- CLI 已足够承担工作区验证、核心能力回归和后续壳层复用入口

后续延伸：

- 更稳定的 JSON 输出和错误码
- patch 模板与更好的树视图

## 阶段二：资料导入

目标：

- 从 Markdown / TXT / PDF 生成初始脑图
- 把导入资料纳入本地工作区

预期落地点：

- `nodex source import <file>`
- 来源文件落到 `./.nodex/sources/`
- 生成初始主题树
- 为节点保留来源关联占位

当前基础：

- 已支持 Markdown / TXT 导入、source 文件落盘、初始主题树生成和切片级关联
- source 和 node 两侧都已有基础来源链路可查看

关键问题：

- 初始脑图生成应该多激进
- 切片粒度如何定义
- 来源与节点关系如何表示

## 阶段三：AI 生成 patch

目标：

- 让 AI 输出结构化 patch，而不是直接重写状态

预期落地点：

- `nodex ai expand <node-id>`
- `nodex ai explore <node-id> --by risk|question|action|evidence`
- patch 预览后再应用

当前基础：

- 已有 `ai expand` / `ai explore` 的最小 dry-run 能力，可在本地组装上下文并预览 patch scaffold
- 已形成 request / response contract、external runner bridge 和最小 provider runner
- 已开始在同一条 external runner 边界上做 LangChain 最小试点，先验证它是否适合作为后续 AI runtime / 编排层
- 已把最小 explainability contract 接到 AI response：理由摘要、直接证据、推断建议
- 已能保存本地 AI 运行审计信息，并把最小运行索引写进 SQLite，供后续排查和查询扩展
- 已把 provider 调试工具链收口成：
  - `provider_doctor`
  - `provider_runner`
  - `provider_smoke`
- 已让 `codex` / `openai` / `gemini` 三条线都接入同一套 diagnostics / runner 抽象
- 已把这些能力接进 CLI：
  - `nodex ai doctor`
  - `nodex ai status`
  - `nodex ai providers`
  - `nodex ai smoke`

当前短期重点：

- 不是再发明一条新的 provider 接入路径
- 而是把现有 external runner + 多 provider 调试工具链做成更清晰的真实运行体验
- 同时继续把 LangChain 控制在“最小外部试点”范围内；即使当前默认推荐主路已经切到 Anthropic-compatible LangChain，也仍然不新增状态边界
- 包括配置状态、运行状态、失败反馈和 patch apply 链路的可见性

长期方向补充：

- 当前 AI contract 仍然直接产出 canonical patch，这条边界先继续保留
- LangChain 如果后续继续推进，也应该优先作为这条 contract 的 runtime / orchestration 层，而不是新的状态边界
- 等真实 provider 主路径足够稳定后，再评估是否让 AI authored output 上移到更高层 intent，再编译回 canonical patch

关键问题：

- 如何约束模型只输出合法 patch
- 如何把来源上下文安全地传给模型
- 如何让 patch 结果足够可读、可审查

## 阶段四：来源与证据

目标：

- 让节点不只是结构，还能带证据

预期落地点：

- 来源切片
- 节点与来源的引用关系
- Evidence 视图
- 基于来源的问答

当前基础：

- 已把显式 evidence 引用与一般 source / chunk 关联分层
- 已补上 citation rationale 与 `direct` / `inferred` 的最小区分
- 已能从 node 和 source 两侧查看基础 evidence 链路

关键问题：

- 切片与节点的关系是一对多还是多对多
- 引用是复制文本还是引用定位
- 证据视图如何避免把脑图变成文献管理器

## 阶段五：Tauri 图形界面

目标：

- 让脑图真正成为主界面

预期落地点：

- 画布
- 大纲
- patch 预览器
- 来源查看器
- 快照恢复入口

当前基础：

- 已有复用共享 Rust 内核的过渡性 Tauri 桌面壳
- 已形成“可折叠导航轨 + 中栏纯画布 + 右栏上下文 / review”的基础工作台，并保留 patch preview / apply 边界
- 已接通 source import、snapshot、history、evidence draft 和 AI draft 的最小入口
- 已验证桌面端可以复用现有 patch、source 和 AI 审计链路
- 桌面 v2 的画布层方向当前已收敛到 `React Flow`，但它仍只承担交互与呈现，不替代 patch / store / ai 边界
- 当前画布层也已开始承接纯 view-state，例如节点展开 / 折叠、局部聚焦、viewport 和记忆化导航状态
- 但当前前端仍暴露较多底层概念，更接近调试 / 审计壳，不应被视为已经达到“人类可用桌面产品”目标

长期方向补充：

- GUI 主工作流不应长期停留在“直接编辑 primitive patch”
- 更适合让 GUI 动作逐步提升为高层 intent，patch 预览作为确认层，原始 patch JSON 退到高级模式或调试模式
- 短期内更合理的方向不是继续在现壳上叠更多面板，而是保留共享内核与 Tauri 命令桥，重做一版更贴近人类高频使用的桌面端
- 这轮桌面重做默认以 `React Flow` 承接画布层；如果后续补自动布局，也更适合作为其上的补充能力，而不是重新发起一轮画布选型

关键问题：

- CLI 内核和 GUI 之间的边界如何保持清晰
- 画布操作是否也统一映射到 patch
- 哪些动作是实时写入，哪些动作需要显式应用
- 哪些桌面高层动作需要先抽成 façade / intent-like 入口，避免继续把 `patch` / `run-id` / artifact 直接暴露给主界面

## 当前最重要的三个验证问题

在进入大规模功能实现之前，优先验证：

1. 脑图作为主界面是否足够高频
2. 节点拓展是否真的比聊天更高效
3. patch 驱动的 AI 编辑是否能带来更可信的体验
