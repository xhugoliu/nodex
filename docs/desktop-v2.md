# Desktop V2 蓝图

## 一句话目标

做一版“节点工作流优先”的桌面端，而不是“调试 / 审计入口优先”的桌面端。

更具体地说：

- 中栏固定为画布主舞台
- 右栏是节点作用域的 assistant workspace，而不是调试台
- 左栏先保持轻导航，不急着扩成复杂控制中心

## 当前主路径

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review -> apply -> 继续进入新增节点

## 当前桌面 contract

- 左栏：先保持轻导航、`Import Source` 和 source/browser 的最小职责
- 中栏：固定为纯画布工作区
- 右栏：节点作用域的 assistant workspace，默认承接 `Context / Draft / Review`
- 画布高频动作放在节点卡片内
- 当前默认 AI draft route 以 Anthropic-compatible LangChain 为主路
- patch 仍然是确认层，不绕过 validate / apply

### 右栏 assistant workspace 的边界

- `Context`：看懂当前节点、来源、证据和“为什么值得看”，并明确提示下一步如何进入 `Draft`
  同时保留当前来源的本地 provenance（至少文件路径与导入时间），让这块更像稳定工作台而不是会话摘要
- `Draft`：允许使用更有对话感的 composer 和响应卡片，但执行语义仍绑定当前 node，不额外引入 source-scoped draft state
- `Review`：仍然回到 patch inspect / apply 的确认层
- 右栏顶部持续显示当前焦点节点；如果来源上下文仍打开，也应同时标出当前来源
- `Draft` 仍只显示 node-scoped 焦点，不把来源提示重新暗示成新的执行作用域
- 不是全局聊天窗口
- 不默认暴露 run id、artifact、history、compare、raw payload 这类底层细节

## 当前必须保持的语义

- 导入 source 后优先选中导入 root node
- assistant 交互必须绑定当前节点；source detail 主要服务于 `Context` / cite / uncite 这类阅读与取证动作，不做全局闲聊
- 只要节点或打开的 source detail 发生变化，就清掉瞬时 Review/apply 状态并回到 `Context`
- 只有同一节点、同一 source detail 的刷新，才允许保留当前 Review 可见态
- `source detail -> node context` 的 handoff 语义已经收口到共享 helper，不应再散回 App 分支
- `source detail -> Draft` 也应先通过共享 helper 收口到 node-scoped Draft，不把打开的 source detail 直接带成新的 Draft 状态边界
- apply 成功后优先聚焦新增节点；若没有新增节点，则回到当前节点
- 右栏来源信息应解释“为什么值得看”，而不只是列 chunk
- 右栏默认展示用户下一步该做什么，而不是底层运行细节列表
- 右栏在 `Context / Draft / Review` 和 source handoff 间都应继续说明“当前围绕哪个节点行动”

## 当前回归门

- `python3 scripts/desktop_flow_smoke.py`
  守主流程闭环、`next_focus_candidate`、`ai_status`
- `python3 scripts/provider_smoke.py --provider anthropic --scenario source-root --json`
  守 imported root 上的真实材料 draft/apply 路径
- `cd desktop && npm run test:logic`
  守 helper seam、右栏 surface 和 mounted App 级主路径交接
  当前也已覆盖 `back` handoff、导入落点后的跨 pane 交接、`source import -> AI expand -> review -> apply`、
  workspace load 后的 `Context` CTA / provenance / current focus、source open 后的 node/source focus cue，
  source context -> review 后的 node/source focus continuity、
  source context -> review -> apply 后的 focus 落点、imported-root apply 后真实 right rail 的 generated-node 落点，
  手工 `update node` patch 路径上的 tree / canvas / right rail 同节点收口，
  `add child` patch 路径上的 tree / canvas / right rail 新节点收口，
  `cite source chunk` 路径上的 tree / canvas / right rail 同节点 + evidence 收口，
  `uncite source chunk` 路径上的 tree / canvas / right rail 同节点 + evidence 清理收口，
  以及同一 mounted session 内 `imported-root apply -> generated node -> 手工 update -> apply` 的连续收口；
  现在也已覆盖同一 mounted session 内 `imported-root apply -> generated node -> add child -> apply` 的连续收口；
  现在也已覆盖同一 mounted session 内 `imported-root apply -> generated node -> source open/cite -> apply` 的连续收口；
  现在也已覆盖同一 mounted session 内 `imported-root apply -> generated node(with evidence) -> source open/uncite -> apply` 的连续收口；
  现在也已覆盖同一 mounted session 内生成节点上的 `source detail -> Review` focus continuity，
  以及 `source detail -> Draft` 共享 handoff seam；
  现在也已覆盖同一 mounted session 内生成节点上的 `source detail -> Draft -> review/apply` 闭环；
  现在也已覆盖同一 mounted session 内
  `imported-root apply -> generated node -> source detail -> Draft -> review/apply -> second-level generated node -> 手工 update -> apply`
  的连续收口；
  现在也已覆盖同一 mounted session 内
  `... -> second-level generated node -> Draft -> review/apply -> third-level generated node`
  的连续收口；
  现在也已覆盖同一 mounted session 内
  `... -> second-level generated node -> source open/cite -> apply`
  的连续收口；
  现在也已覆盖同一 mounted session 内
  `... -> second-level generated node(with evidence) -> source open/uncite -> apply`
  的连续收口；
  现在也已覆盖 second-level generated node 上的 `source detail -> Review` focus continuity、
  `source detail -> Draft` shared handoff seam，
  以及 `source detail -> Draft -> review/apply` 闭环；
  现在也已覆盖同一 mounted session 内
  `... -> third-level generated node -> 手工 update -> apply`
  的连续收口；
  现在也已覆盖同一 mounted session 内
  `... -> third-level generated node -> source open/cite -> apply`
  和 `... -> third-level generated node(with evidence) -> source open/uncite -> apply`
  的连续收口；
  现在也已覆盖 third-level generated node 上的 `source detail -> Review` focus continuity、
  `source detail -> Draft` shared handoff seam，
  以及 `source detail -> Draft -> review/apply` 闭环；
  这些 apply 末态现在也共用一套 mounted continuity contract：
  tree / canvas / right rail 对齐同一 focus node，右栏回到 `Context`，瞬时 Review/source detail 清空，`Current focus` cue 继续成立

## 如果继续推进

优先顺序：

1. 收口右栏 assistant workspace 的 IA，把 `Context / Draft / Review` 的职责和切换语义写实、测实
2. continuity 主线的 mounted 证据已基本封口，接下来优先转到 runner/runtime 稳定性与桌面默认 draft route 的真实验证
3. 把桌面默认 draft route 继续推到真实 provider 凭据下的手动 / 对照验证
4. 如果 App 侧再长出新副作用，再补更重的 mounted 交互回归

## 当前不做

- 恢复 AI runs / Activity / Run Inspector 到主舞台
- 把 `AI draft route` 变回厚重调试面板
- 在画布层引入新的状态边界
- 把右栏做成全局长聊天记录 UI
- 把 compare / artifact / raw payload 暴露成默认页面内容

## 技术边界

- `Tauri`：桌面外壳
- `React Flow`：画布呈现与视图状态
- 共享 Rust 内核：canonical state 与 patch apply
