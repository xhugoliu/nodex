# 路线图

本文把 Nodex 的推进拆成多个阶段，目的是避免“一次性把所有想法都实现”。

## 当前阶段

当前已经落地的是第一阶段的最小内核：

- 项目初始化
- SQLite schema
- 基础 patch 应用
- 快照保存与恢复
- Markdown 大纲导出

此外，阶段二已经开始，有一版最小的 `source import`：

- 支持 `md` / `txt`
- 复制来源文件到 `./.nodex/sources/`
- 生成初始节点树
- 生成基础来源切片并关联到导入节点

阶段五也已经开始了一层最小桌面壳：

- Tauri app 骨架
- 打开文件夹后自动“打开或初始化工作区”
- 单屏三栏工作台：树 / 详情摘要 / 统一编辑器
- 节点编辑 patch 起草与 patch 预览 / 应用
- 由原生 app menu 承载的低频入口：
  - source import preview / import
  - snapshot 保存 / 恢复
  - 历史 patch 载入
  - 语言切换
- 当前桌面里也已经能对选中节点起草 AI expand dry-run patch，并显示本次运行元数据

这对应的核心问题是：

> patch-first 的本地工作区模型是否站得住

阶段四也已经开始了一层最小 evidence 语义：

- patch 支持 `cite_source_chunk` / `uncite_source_chunk`
- 显式 evidence 引用与导入时的 source chunk 关联分离
- `node show` / `source show` 可查看 evidence 引用

## 阶段一：CLI 内核

目标：

- 让本地工作区跑通
- 让 patch 成为统一的编辑入口
- 让状态历史可恢复

当前已完成：

- `nodex init`
- `nodex node add/update/move/delete/list`
- `nodex node cite-chunk/uncite-chunk`
- `nodex patch inspect/apply/history`
- `nodex snapshot save/list/restore`
- `nodex export outline`
- `node show` / `source list` / `source show` / `patch history` / `snapshot list` 的基础 JSON 输出

阶段一还可以继续补：

- 更完整的 JSON 输出模式
- 更完整的错误码和退出码
- patch 文件模板生成
- 更好的树视图

## 阶段二：资料导入

目标：

- 从 Markdown / TXT / PDF 生成初始脑图
- 把导入资料纳入本地工作区

预期落地点：

- `nodex source import <file>`
- 来源文件落到 `./.nodex/sources/`
- 生成初始主题树
- 为节点保留来源关联占位

当前已落地的最小版本：

- `nodex source import <file>`
- 支持 `md` / `txt`
- 生成初始节点树
- 为导入生成的节点保留切片级来源关联
- `source show` / `node show` 可查看双向来源链路

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

当前已落地的最小版本：

- `nodex ai expand <node-id> --dry-run`
- 本地组装 expand 所需的节点、source 与 evidence 上下文
- 返回 prompt bundle 和 patch scaffold 预览，不调用真实模型
- 可导出 request bundle，并通过 `ai apply-response` 回放外部 response
- 可通过 `ai run-external` 调用本地 runner，打通 request -> response -> patch 预览
- 开发用 `scripts/openai_runner.py` 已可通过 external runner 接入真实 OpenAI Responses API
- `.nodex/ai/*.meta.json` 已记录 provider / model / provider run id / retry 次数等运行审计信息

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

当前已落地的最小版本：

- `cite_source_chunk` / `uncite_source_chunk`
- 显式 evidence 引用与基础 source/chunk 关联分离
- `node show` / `source show` 可查看切片被哪些节点显式引用

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

当前已落地的最小版本：

- `desktop/src-tauri` + `desktop/src` 最小壳工程
- 前端已切到 `React + Vite + TypeScript + Tailwind CSS`
- 复用共享 Rust 内核，而不是前端单独维护状态语义
- 原生 app menu
- 打开文件夹后自动“打开或初始化工作区”
- 单屏三栏桌面工作台
- 中栏压缩后的详情摘要与底部控制台
- 右栏统一节点编辑器与 patch 编辑器
- source import / snapshot / 历史 patch / 语言切换通过原生菜单进入
- 可从 source detail 为上下文节点起草 `cite_source_chunk` / `uncite_source_chunk`
- 可从当前节点起草 AI expand patch，并在控制台查看 provider / model / retry 等运行元数据

关键问题：

- CLI 内核和 GUI 之间的边界如何保持清晰
- 画布操作是否也统一映射到 patch
- 哪些动作是实时写入，哪些动作需要显式应用

## 当前最重要的三个验证问题

在进入大规模功能实现之前，优先验证：

1. 脑图作为主界面是否足够高频
2. 节点拓展是否真的比聊天更高效
3. patch 驱动的 AI 编辑是否能带来更可信的体验
