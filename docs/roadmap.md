# 路线图

本文把 Nodex 的推进拆成多个阶段，目的是避免“一次性把所有想法都实现”。

## 当前阶段

当前已经完成阶段一的最小内核，并且为后续几个阶段都跑出了一条最小验证切口。

目前可以把项目理解成：

- 阶段一：CLI 内核已经站住
- 阶段二：资料导入已经有最小落地
- 阶段三：AI patch 已经有 dry-run / external runner 的最小闭环
- 阶段四：来源与证据已经有最小语义分层
- 阶段五：Tauri 桌面壳已经有最小工作台

这对应的核心判断仍然是：

> patch-first 的本地工作区模型是否站得住

更细的短期执行顺序请看 [短期执行清单](./next-steps.md)，各阶段当前落地情况见下文。

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

- 已有 `ai expand` 的最小 dry-run 能力，可在本地组装上下文并预览 patch scaffold
- 已形成 request / response contract、external runner bridge 和最小 provider runner
- 已能保存本地 AI 运行审计信息，供后续排查和索引扩展

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

- 已有复用共享 Rust 内核的最小 Tauri 桌面壳
- 已形成树、详情和编辑器组成的基础工作台，并保留 patch preview / apply 边界
- 已接通 source import、snapshot、history、evidence draft 和 AI draft 的最小入口

关键问题：

- CLI 内核和 GUI 之间的边界如何保持清晰
- 画布操作是否也统一映射到 patch
- 哪些动作是实时写入，哪些动作需要显式应用

## 当前最重要的三个验证问题

在进入大规模功能实现之前，优先验证：

1. 脑图作为主界面是否足够高频
2. 节点拓展是否真的比聊天更高效
3. patch 驱动的 AI 编辑是否能带来更可信的体验
