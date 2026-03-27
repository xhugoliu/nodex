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
- 工作区打开 / 初始化
- 树视图与节点 / source 详情查看
- 节点编辑 patch 起草
- source import 预览 / 导入
- patch 预览 / 应用
- patch history 回填
- snapshot 列表与恢复入口

这对应的核心问题是：

> patch-first 的本地工作区模型是否站得住

## 阶段一：CLI 内核

目标：

- 让本地工作区跑通
- 让 patch 成为统一的编辑入口
- 让状态历史可恢复

当前已完成：

- `nodex init`
- `nodex node add/update/move/delete/list`
- `nodex patch inspect/apply/history`
- `nodex snapshot save/list/restore`
- `nodex export outline`

阶段一还可以继续补：

- JSON 输出模式
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
- 工作区打开 / 初始化
- 树视图、节点详情、source 详情
- 节点编辑 patch 起草
- source import preview / import
- patch preview / apply
- patch history 回填查看
- snapshot list / restore

关键问题：

- CLI 内核和 GUI 之间的边界如何保持清晰
- 画布操作是否也统一映射到 patch
- 哪些动作是实时写入，哪些动作需要显式应用

## 当前最重要的三个验证问题

在进入大规模功能实现之前，优先验证：

1. 脑图作为主界面是否足够高频
2. 节点拓展是否真的比聊天更高效
3. patch 驱动的 AI 编辑是否能带来更可信的体验
