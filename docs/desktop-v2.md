# Desktop V2 蓝图

## 一句话目标

做一版“节点工作流优先”的桌面端，而不是“调试 / 审计入口优先”的桌面端。

更具体地说：

- 中栏固定为画布主舞台
- 右栏是节点作用域的 assistant workspace，而不是调试台
- 左栏先保持轻导航，不急着扩成复杂控制中心

## 当前主路径

> 打开工作区 -> 选中节点 -> 看懂节点上下文与来源 -> 起草 AI draft -> review -> apply -> 继续进入新增节点

## 从过渡性 workbench 到最终产品

- 当前实现已经证明共享内核、patch 链路和 AI 审计链路可以被桌面端复用
- 当前更需要解决的问题不是“能力不够多”，而是“实现期 surface 太容易留在默认界面”
- 接下来的桌面重构允许大刀阔斧调整信息架构，但不应绕开现有 `patch / store / ai` 内核
- 默认方向是做减法：删除、合并、降级与主路径无关的 surface，而不是继续补更多入口

## 收口原则

- 主界面长期只保留导航、画布、当前节点工作区和提交确认层
- 任何新 surface 在进入默认界面前，都应先证明自己不能被合并、下沉或删除
- 主要服务调试、审计、对照、开发验证的信息，默认留在 CLI、脚本层或次级入口
- 如果一个元素不能直接帮助用户推进 `选中节点 -> 起草 -> review -> apply`，优先不要常驻在主舞台
- 界面应持续回答 3 个问题：当前围绕哪个节点行动、当前来源为什么值得看、apply 后会发生什么

## 当前桌面 contract

- 左栏：先保持轻导航、`Import Source` 和 source/browser 的最小职责
  `Recovery` 只承接 `Save Snapshot`、最近 snapshot restore 和最近 patch 的 `Load to Review`；
  后续也应尽量收口为次级入口，而不是长期占据主舞台
- 中栏：固定为纯画布工作区
- 右栏：节点作用域的 assistant workspace，默认承接 `Context / Draft / Review`
- 画布高频动作放在节点卡片内
- 当前默认 AI draft route 以 OpenAI-compatible LangChain 为主路
- patch 仍然是确认层，不绕过 validate / apply
- AI draft route 状态与 provider 诊断继续服务可用性，但默认应以轻量提示或次级入口呈现，不抢 `Draft` 主内容

### 右栏 assistant workspace 的边界

- `Context`：看懂当前节点、来源、证据和“为什么值得看”，并明确提示下一步如何进入 `Draft`
  同时保留当前来源的本地 provenance（至少文件路径与导入时间），让这块更像稳定工作台而不是会话摘要
- `Draft`：允许使用更有对话感的 composer 和响应卡片，但执行语义仍绑定当前 node，不额外引入 source-scoped draft state
  当前 `Draft` 里可见的 draft-op 卡片也应复用 `Review` 同一套 node/source/chunk 人类化解释，不在进入 Review 前退回 raw id
- `Review`：仍然回到 patch inspect / apply 的确认层，并直接概括当前草案、操作数量、证据支撑，以及 apply 后可能落到的焦点
  长期形态上，`Review` 更接近一次提交确认时刻，而不是常驻第三个工具面板
  Review 的可读性长期只守 4 件事：
  - 一眼看懂这次改什么
  - 一眼看懂为什么改
  - 一眼看懂证据来自哪里
  - 一眼看懂 apply 后焦点落点
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
- 当某个 chunk 已经被当前节点引用时，source detail 里也应直接看见当前 citation kind 和 rationale，再决定是继续保留还是起草 uncite
- apply 成功后优先聚焦新增节点；若没有新增节点，则回到当前节点
- `Recovery -> Recent patches` 只允许把最近 patch 重新载入 `Review`，不直接 apply，也不把 history/activity 抬回主舞台
- 右栏来源信息应解释“为什么值得看”，而不只是列 chunk
- 右栏默认展示用户下一步该做什么，而不是底层运行细节列表
- 右栏在 `Context / Draft / Review` 和 source handoff 间都应继续说明“当前围绕哪个节点行动”

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
  守 helper seam、右栏 surface 和 mounted App 级主路径交接。
  当前重点覆盖：
  - workspace load、source open、review/apply 的主路径 continuity
  - `source detail -> Draft -> Review -> apply` 的共享 handoff seam
  - `update / add child / cite / uncite` 这几类高频 patch 的三栏收口
  - imported-root apply 后继续进入二级、三级节点时的连续收口
  - apply 末态统一 contract：tree / canvas / right rail 对齐同一 focus node，右栏回到 `Context`
- `python3 scripts/desktop_flow_smoke.py --json`
  守主流程闭环、`next_focus_candidate`、`ai_status`
- `python3 scripts/provider_smoke.py --provider openai --scenario source-root --json`
  守 imported root 上的真实材料 draft/apply 路径

`cd desktop && npm run check:all` 继续保留，但它属于更宽的桌面开发 convenience superset，不作为默认路径回归门命名。

## 如果继续推进

优先顺序：

1. 先做减法重构，明确哪些 surface 留在主舞台、哪些降为次级入口、哪些直接删除
2. 收口右栏 assistant workspace 的 IA，把 `Context / Draft / Review` 的职责和切换语义写实、测实
3. continuity 主线的 mounted 证据已基本封口，接下来优先转到 runner/runtime 稳定性与桌面默认 draft route 的真实验证
4. 把桌面默认 draft route 继续推到真实 provider 凭据下的手动 / 对照验证
5. 如果 App 侧再长出新副作用，再补更重的 mounted 交互回归

## 当前不做

- 恢复 AI runs / Activity / Run Inspector 到主舞台
- 把 `AI draft route` 变回厚重调试面板
- 为了保留实现期可观察性而长期把技术状态留在默认页面
- 在画布层引入新的状态边界
- 把右栏做成全局长聊天记录 UI
- 把 compare / artifact / raw payload 暴露成默认页面内容

## 技术边界

- `Tauri`：桌面外壳
- `React Flow`：画布呈现与视图状态
- 共享 Rust 内核：canonical state 与 patch apply
