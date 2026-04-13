# Desktop V2 蓝图

## 一句话目标

做一版“节点工作流优先”的桌面端，而不是“调试 / 审计入口优先”的桌面端。

## 当前主路径

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review -> apply -> 继续进入新增节点

## 当前桌面 contract

- 左栏：导航轨 + `Import Source`
- 中栏：纯画布工作区
- 右栏：只保留 `Context / Review`
- 画布高频动作放在节点卡片内
- patch 仍然是确认层，不绕过 validate / apply

## 当前必须保持的语义

- 导入 source 后优先选中导入 root node
- 只要节点或打开的 source detail 发生变化，就清掉瞬时 Review/apply 状态并回到 `Context`
- 只有同一节点、同一 source detail 的刷新，才允许保留当前 Review 可见态
- `source detail -> node context` 的 handoff 语义已经收口到共享 helper，不应再散回 App 分支
- apply 成功后优先聚焦新增节点；若没有新增节点，则回到当前节点
- 右栏来源信息应解释“为什么值得看”，而不只是列 chunk

## 当前回归门

- `python3 scripts/desktop_flow_smoke.py`
  守主流程闭环、`next_focus_candidate`、`ai_status`
- `cd desktop && npm run test:logic`
  守 helper seam、右栏 surface 和 handoff 可见态
  当前也已覆盖 mounted App 级 `back` handoff 和导入落点后的跨 pane 交接

## 如果继续推进

优先顺序：

1. 把 `desktop_flow_smoke.py` 继续补到更多主路径交接语义
2. 真实材料路径 `source import -> AI expand -> review -> apply`
3. 如果 App 侧再长出新副作用，再补更重的 mounted 交互回归

## 当前不做

- 恢复 AI runs / Activity / Run Inspector 到主舞台
- 把 `AI draft route` 变回厚重调试面板
- 在画布层引入新的状态边界
- 把桌面端改成聊天驱动 UI

## 技术边界

- `Tauri`：桌面外壳
- `React Flow`：画布呈现与视图状态
- 共享 Rust 内核：canonical state 与 patch apply
