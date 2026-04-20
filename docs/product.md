# 产品定位

## Nodex 是什么

Nodex 是一个以脑图为主界面、以节点拓展为核心交互、以结构化 patch 为编辑边界的本地优先工作台。

它想解决的问题不是“怎么和 AI 多聊几轮”，而是：

- 怎么把一个节点继续做深
- 怎么在不推倒重来的前提下演进结构
- 怎么把来源、证据和历史留在本地工作区里

## 当前主张

- 脑图优先，不是聊天优先
- 节点拓展优先，不是一次性整图生成
- patch-first，不是直接回写状态
- local-first，不是云端依赖优先
- 来源可追溯，历史可恢复
- 少即是多，默认界面只保留节点工作流必需路径

## 非目标

当前不把 Nodex 做成：

- 通用聊天应用
- 以长聊天记录驱动主舞台的桌面工作台
- 自动生成完整脑图的工具
- 绕过 patch 的桌面直写系统
- 以调试面板为主界面的产品
- 把实现期技术状态直接暴露成产品主界面
- 为了开发 / 验证方便而长期保留过渡性 workbench 外壳

## 当前主路径

推荐理解当前产品方向用这条路径：

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review patch -> apply -> 继续进入新增节点

对真实材料路径，当前默认主路是：

> source import -> 选中导入 root node -> 看懂来源上下文 -> 起草 AI draft -> review -> apply

## 桌面端当前方向

- 桌面端的收口方向不是继续加入口，而是持续删除、合并、降级与主路径无关的 surface
- 中栏固定为画布主舞台
- 右栏是节点作用域的 assistant workspace，承接 `Context / Draft / Review`
- `Draft` 可以有对话感强的输入框和响应卡片，但不是全局聊天窗口
- 左栏暂时保持轻导航、`Import Source` 和 source/browser 职责，不扩成新的调试控制台
- run id、artifact、compare、history 这类底层细节默认不应回到主页面主视图

## 桌面端最终产品判断标准

- 用户在主界面默认只需要持续回答 3 个问题：当前围绕哪个节点行动、当前来源为什么值得看、apply 后会发生什么
- 默认主界面只保留导航、画布、当前节点工作区和提交确认层
- `Review` 更接近提交确认时刻，而不是长期并列的工具页
- `Source detail` 是当前节点的阅读镜头，不是新的主舞台
- diagnostics / compare / artifact / activity / raw payload 属于次级入口，不是默认内容
- 如果一个新增 surface 不能直接缩短 `选中节点 -> 起草 -> review -> apply` 这条路径，优先不加

## 技术边界

- `Tauri` 是桌面外壳
- `LangChain` 是当前默认 AI runtime / orchestration 主路；当前实现仍主要落在 external runner / scripts 层
- `SQLite` 是本地工作区核心存储

这三条边界在当前项目里都不是可随手替换的建议项。
