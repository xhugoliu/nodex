# 短期执行清单

## 用途

这里只写当前最值得继续推进的切口，不写历史过程。

## 当前主路径

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review -> apply -> 继续进入新增节点

对真实材料路径，当前主路是：

> source import -> 选中导入 root node -> 看懂来源上下文 -> 起草 AI draft -> review -> apply

## 当前优先级

- 收口桌面三栏 IA：中栏固定画布，右栏改成节点作用域的 assistant workspace
- 守住右栏 `Context / Draft / Review` 语义，不让它滑回调试台或全局聊天窗口
- 左栏先维持轻导航、`Import Source` 和 source/browser 的最小职责，不抢中栏/右栏主舞台
- 守住 apply 后统一的 focus node 语义
- 守住 `source detail -> node context` 这条高频 handoff，不让 Review/apply 清理语义散回 App 分支
- 把 `Draft` 收紧为 node-scoped surface；`source detail -> Draft` 也走共享 handoff seam，而不是把 source detail 直接带进 Draft
- 守住右栏顶部的当前焦点 cue：始终看见当前 node；source 打开时明确当前来源；`Draft` 不把 source cue 扩成新的作用域
- 守住桌面默认 AI draft route 的可用性，但只把 LangChain 稳定化工作收敛为桌面默认路径的支撑面，不把底层 compare / artifact 细节抬到主舞台

## 当前回归门

- `python3 scripts/desktop_flow_smoke.py`
  作用：守桌面主流程闭环、`next_focus_candidate`、`ai_status`
- `python3 scripts/provider_smoke.py --provider openai --scenario source-root --json`
  作用：守真实材料路径里的 imported root draft/apply 闭环
- `cd desktop && npm run test:logic`
  作用：守右栏和相关 helper 的轻量语义
  当前覆盖：
  - `AiDraftRouteSurface`
  - `SourceContextSurface`
  - `NodeContextSurface`
  - `app-helpers` 中 `Context / Draft / Review` 判定与 source-detail handoff seam
  - `WorkbenchSidePane` 在 handoff 后回到 node context 的可见态
  - mounted App 级 `back` handoff
  - mounted App 级 workspace load 后的 `Context` CTA / provenance / current focus
  - mounted App 级 source open 后的 node/source focus cue continuity
  - mounted App 级 source context -> review 的 node/source focus continuity
  - mounted App 级 source context -> review -> apply 的 focus 落点
  - mounted App 级导入落点后的 tree / main / side 交接
  - mounted App 级 `source import -> AI expand -> review -> apply` 闭环
  - mounted App 级 imported-root apply 后真实 right rail 的 generated-node focus
  - mounted App 级手工 `update node` patch 路径上的 tree / main / right rail 同节点收口
  - mounted App 级 `add child` patch 路径上的 tree / main / right rail 新节点收口
  - mounted App 级 `cite source chunk` 路径上的 tree / main / right rail 同节点 + evidence 收口
  - mounted App 级 `uncite source chunk` 路径上的 tree / main / right rail 同节点 + evidence 清理收口
  - mounted App 级同一 session 内 `imported-root apply -> generated node -> 手工 update -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `imported-root apply -> generated node -> add child -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `imported-root apply -> generated node -> source open/cite -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `imported-root apply -> generated node(with evidence) -> source open/uncite -> apply` 的连续三栏收口
  - mounted App 级生成节点上的 `source detail -> Review` focus continuity
  - mounted App 级生成节点上的 `source detail -> Draft` shared handoff seam
  - mounted App 级生成节点上的 `source detail -> Draft -> review/apply` 闭环
  - mounted App 级同一 session 内 `imported-root apply -> generated node -> source detail -> Draft -> review/apply -> second-level generated node -> 手工 update -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `... -> second-level generated node -> Draft -> review/apply -> third-level generated node` 的连续三栏收口
  - mounted App 级同一 session 内 `... -> second-level generated node -> source open/cite -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `... -> second-level generated node(with evidence) -> source open/uncite -> apply` 的连续三栏收口
  - mounted App 级 second-level generated node 上的 `source detail -> Review` focus continuity
  - mounted App 级 second-level generated node 上的 `source detail -> Draft` shared handoff seam
  - mounted App 级 second-level generated node 上的 `source detail -> Draft -> review/apply` 闭环
  - mounted App 级同一 session 内 `... -> third-level generated node -> 手工 update -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `... -> third-level generated node -> source open/cite -> apply` 的连续三栏收口
  - mounted App 级同一 session 内 `... -> third-level generated node(with evidence) -> source open/uncite -> apply` 的连续三栏收口
  - mounted App 级 third-level generated node 上的 `source detail -> Review` focus continuity
  - mounted App 级 third-level generated node 上的 `source detail -> Draft` shared handoff seam
  - mounted App 级 third-level generated node 上的 `source detail -> Draft -> review/apply` 闭环
  - 以上 apply 末态共用一套 mounted continuity contract：focus node 对齐、右栏回到 `Context`、瞬时 Review/source detail 清空、`Current focus` cue 保持成立

## 下一轮最小切口

- 先把右栏 assistant workspace 的 IA 和切换语义写清楚、做轻、测稳
- 把 `desktop_flow_smoke.py` 和 `npm run test:logic` 继续补到三栏主路径的 handoff / draft / review / apply 交接
- continuity 主线的 mounted 证据已基本封口，下一步优先转到 runner/runtime 稳定性与桌面默认 draft route 的真实验证
- 只在确实影响桌面默认 draft route 稳定性时，再做 LangChain compare / fallback / provider 路径补强
- 明确哪些底层信息只留在调试/CLI 层，不回填到默认桌面页面

## 后续推进顺序

- 第一优先级：继续收口桌面三栏 IA，让中栏画布、右栏 `Context / Draft / Review` 和左栏轻导航的职责更稳定、更可回归
- 第二优先级：继续稳定桌面默认 AI draft route，把 LangChain + external runner 的失败分类、凭据诊断、重试与 smoke 回归收紧到默认路径服务面
- 第三优先级：提升 patch review 可读性，让 inspect / apply 更清楚地说明影响范围、evidence 变化和 apply 后 focus 落点
  当前右栏 `Review` 也应直接先说明草案摘要、操作数量和 apply 后大概率聚焦到哪，而不是只堆变更列表
  进入 Review 后也应直接看见当前草案来自哪条 AI run 或哪条 patch history，不要把 provenance 只留给瞬时提示
  手工起草的 add child / update / cite / uncite 也应保留来源提示，避免 Review 变成脱离动作上下文的纯 patch JSON
  cite / uncite 草案里还应直接说清楚受影响的 source/chunk，避免 Review 退化成只看 chunk id 的低可读状态
  下一步继续把节点结构变化和 evidence 变化也收成一眼可读的 summary，而不是只留在逐条 op 文本里
- 第四优先级：加强 `source detail -> node context -> cite/uncite -> Draft -> Review` 这条高频工作流的连续性
  source detail 里也应直接露出当前节点对某个已引用 chunk 的 citation kind / rationale，避免 cite/uncite 前还要靠记忆回想
- 第五优先级：把 snapshot、patch history、AI replay 继续做成次级但好用的恢复入口，不回填成主舞台
  当前左栏 `Recovery` 已接上 `Save Snapshot`、最近 snapshot restore 和最近 3 条 patch 的 `Load to Review`
  后续继续守住“只载入 Review、不直接 apply”的次级入口语义
- 横向持续项：继续补 `desktop_flow_smoke.py`、`provider_smoke.py`、`runner_compare.py` 和 `npm run test:logic`，把回归能力当成核心资产而不是收尾工作

## 当前不优先

- PNG / PDF 导出
- 新的 provider 接入路径
- 工作区级 AI runs / Activity / Run Inspector 回到主界面
- 绕过 patch 的桌面直写状态
- 大规模架构重整

## 更新规则

- 优先改“现在该做什么”
- 删除已不再关键的短期项
- 不记录提交清单或日报
