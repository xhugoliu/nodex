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
- 让 `Context` surface 明确给出进入 `Draft` 的下一步引导，而不是只停在说明态
- 守住桌面默认 AI draft route 的可用性，但只把 LangChain 稳定化工作收敛为桌面默认路径的支撑面，不把底层 compare / artifact 细节抬到主舞台

## 当前回归门

- `python3 scripts/desktop_flow_smoke.py`
  作用：守桌面主流程闭环、`next_focus_candidate`、`ai_status`
- `python3 scripts/provider_smoke.py --provider anthropic --scenario source-root --json`
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
  - mounted App 级导入落点后的 tree / main / side 交接
  - mounted App 级 `source import -> AI expand -> review -> apply` 闭环

## 下一轮最小切口

- 先把右栏 assistant workspace 的 IA 和切换语义写清楚、做轻、测稳
- 把 `source detail -> Draft` 的 handoff 收口到 node-scoped Draft，并用 mounted 回归锁住
- 把 `desktop_flow_smoke.py` 和 `npm run test:logic` 继续补到三栏主路径的 handoff / draft / review / apply 交接
- 只在确实影响桌面默认 draft route 稳定性时，再做 LangChain compare / fallback / provider 路径补强
- 明确哪些底层信息只留在调试/CLI 层，不回填到默认桌面页面

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
