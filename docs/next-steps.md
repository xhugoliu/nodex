# 短期执行清单

## 用途

这里只写当前最值得继续推进的切口，不写历史过程。

## 当前主路径

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review -> apply -> 继续进入新增节点

对真实材料路径，当前主路是：

> source import -> 选中导入 root node -> 看懂来源上下文 -> 起草 AI draft -> review -> apply

## 当前优先级

- 守住 Anthropic-compatible LangChain 这条默认 AI 主路
- 守住共享 LangChain runner helper，不让 OpenAI / Anthropic 的 contract shaping 和 fallback 行为继续分叉
- 守住左栏 `Import Source` 入口
- 守住右栏来源上下文、人话摘要和 cite / uncite 工作流
- 守住 apply 后统一的 focus node 语义
- 守住 `source detail -> node context` 这条高频 handoff，不让 Review/apply 清理语义散回 App 分支
- 守住右栏轻量 `AI draft route` 状态层，不恢复重型调试面板

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
  - `app-helpers` 中 `Context / Review` 判定与 source-detail handoff seam
  - `WorkbenchSidePane` 在 handoff 后回到 node context 的可见态
  - mounted App 级 `back` handoff
  - mounted App 级导入落点后的 tree / main / side 交接
  - mounted App 级 `source import -> AI expand -> review -> apply` 闭环

## 下一轮最小切口

- 把 source-root / source-context 的 compare 继续推进到更贴近真实 LangChain preset 的回归
- 把 compare 输出继续补到成功 pair 内更具体的差异归因；blocked pair / readiness 已经 machine-readable
- 视本地依赖与凭据情况，补 `langchain-openai` 的可运行 compare 路径
- 继续避免在主界面回填 run-id、artifact、compare、history 式入口

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
