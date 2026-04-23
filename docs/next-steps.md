# 短期执行清单

## 用途

这里只写当前最值得继续推进的切口，不写历史过程。

## 当前主路径

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review -> apply -> 继续进入新增节点

对真实材料路径，当前主路是：

> source import -> 选中导入 root node -> 看懂来源上下文 -> 起草 AI draft -> review -> apply

## 当前减法原则

- 默认主界面只保留导航、画布、当前节点工作区和提交确认层
- 默认做减法：删除、合并、降级与主路径无关的桌面 surface，不以“实现期方便”或“信息更全”为理由长期保留
- run id、artifact、compare、raw payload、provider diagnostics、环境冲突细节这类信息不回填主舞台
- snapshot、patch history、AI replay、provider diagnostics 可以保留，但默认应作为次级入口
- 如果一个新 surface 不能直接缩短 `选中节点 -> 起草 -> review -> apply`，优先不加

## 当前优先级

- 先做桌面默认界面的减法重构，明确哪些内容留在主舞台、哪些下沉为次级入口、哪些直接删除
- 收口桌面三栏 IA：中栏固定画布，右栏改成节点作用域的 assistant workspace
- 守住右栏 `Context / Draft / Review` 语义，不让它滑回调试台或全局聊天窗口
- 左栏先维持轻导航、`Import Source` 和 source/browser 的最小职责，不抢中栏/右栏主舞台
- 守住 apply 后统一的 focus node 语义
- 守住 `source detail -> node context` 这条高频 handoff，不让 Review/apply 清理语义散回 App 分支
- 把 `Draft` 收紧为 node-scoped surface；`source detail -> Draft` 也走共享 handoff seam，而不是把 source detail 直接带进 Draft
- 守住右栏顶部的当前焦点 cue：始终看见当前 node；source 打开时明确当前来源；`Draft` 不把 source cue 扩成新的作用域
- 守住桌面默认 AI draft route 的可用性，但只把 LangChain 稳定化工作收敛为桌面默认路径的支撑面，不把底层 compare / artifact 细节抬到主舞台

## 当前回归门

默认路径统一回归门：

```bash
just default-path-gate
```

固定顺序：

1. `cargo fmt --check`
2. `cargo test`
3. `cd desktop && npm run test:logic`
4. `python3 scripts/desktop_flow_smoke.py --json`
5. `python3 scripts/provider_smoke.py --provider openai --scenario source-root --json`

如果当前环境没有安装 `just`，就直接按这 5 步手动执行。

其中：

- `cd desktop && npm run test:logic`
  作用：守右栏和相关 helper 的轻量语义。
  当前重点覆盖：
  - `Context / Draft / Review` 判定与 source-detail handoff seam
  - workspace load、source open、review/apply 的主路径 continuity
  - `update / add child / cite / uncite` 这几类高频 patch 的三栏收口
  - imported-root apply 后继续进入二级、三级节点时的连续收口
  - apply 末态统一 contract：focus node 对齐、右栏回到 `Context`、瞬时 Review/source detail 清空
- `python3 scripts/desktop_flow_smoke.py --json`
  作用：守桌面主流程闭环、`next_focus_candidate`、`ai_status`
- `python3 scripts/provider_smoke.py --provider openai --scenario source-root --json`
  作用：守真实材料路径里的 imported root draft/apply 闭环

`cd desktop && npm run check:all` 继续保留，但它是桌面开发 convenience superset，不是默认路径回归门。

## 下一轮最小切口

- 先列清楚桌面默认页面的保留项、次级入口项和移除项，并按这份清单做减法重构
- 先把右栏 assistant workspace 的 IA 和切换语义写清楚、做轻、测稳
- 把 `desktop_flow_smoke.py` 和 `npm run test:logic` 继续补到三栏主路径的 handoff / draft / review / apply 交接
- continuity 主线的 mounted 证据已基本封口，下一步优先转到 runner/runtime 稳定性与桌面默认 draft route 的真实验证
- 只在确实影响桌面默认 draft route 稳定性时，再做 LangChain compare / fallback / provider 路径补强
- 明确哪些底层信息只留在调试/CLI 层，不回填到默认桌面页面

## 后续推进顺序

- 第一优先级：继续做桌面默认界面的减法重构，让中栏画布、右栏 `Context / Draft / Review` 和左栏轻导航的职责更稳定、更可回归
- 第二优先级：继续稳定桌面默认 AI draft route，把 LangChain + external runner 的失败分类、凭据诊断、重试与 smoke 回归收紧到默认路径服务面
- 第三优先级：提升 patch review 可读性，让 inspect / apply 更清楚地说明影响范围、evidence 变化和 apply 后 focus 落点
  重点是：
  - Review 顶部先回答“改什么、为什么改、apply 后去哪”
  - provenance 要稳定可见，不只靠瞬时提示
  - node / source / chunk / citation 默认都显示人类可读语义，而不是 raw id
- 第四优先级：加强 `source detail -> node context -> cite/uncite -> Draft -> Review` 这条高频工作流的连续性
  source detail 里也应直接露出当前节点对已引用 chunk 的 citation kind / rationale
- 第五优先级：把 snapshot、patch history、AI replay 继续做成次级但好用的恢复入口，不回填成主舞台
  继续守住“只载入 Review、不直接 apply”的次级入口语义
- 横向持续项：继续补 `desktop_flow_smoke.py`、`provider_smoke.py`、`runner_compare.py` 和 `npm run test:logic`，把回归能力当成核心资产而不是收尾工作

## 当前不优先

- PNG / PDF 导出
- 新的 provider 接入路径
- 工作区级 AI runs / Activity / Run Inspector 回到主界面
- 为了照顾实现期调试而继续保留默认页面上的技术细节
- 绕过 patch 的桌面直写状态
- 大规模架构重整

## 更新规则

- 优先改“现在该做什么”
- 删除已不再关键的短期项
- 不记录提交清单或日报
