# 短期执行清单

这份文档只服务于当前几轮开发，不替代长期路线图。

它的用途是：

- 让不同对话可以快速接力
- 让短期优先级可以高频修正
- 避免把 `docs/roadmap.md` 写成过细的执行日志

如果这份文档和其他文档冲突，以这些文档为准：

- 已实现 CLI 行为：`docs/cli.md`
- patch 结构和语义：`docs/patch-model.md`
- 数据模型和 SQLite schema：`docs/data-model.md`
- 架构边界：`docs/architecture.md`
- 长期阶段规划：`docs/roadmap.md`

## 使用方式

- 每次开启新对话，先读这份文档，再读本次要改动对应的专项文档
- 只有当短期优先级、阻塞点或下一步切口发生变化时，才重写这份文档
- 这里优先记录“现在该做什么”，不要按对话轮次追加已完成事项
- 如果某项已经不再是短期重点，就从这里移走，保留到 `docs/roadmap.md`

## 当前主路径

当前最值得压实的产品路径是：

> 打开工作区 -> 选中一个节点 -> 看懂节点上下文与来源 -> 用 Anthropic-compatible LangChain 默认主路起草 AI draft -> 预览 patch -> 应用 patch -> 继续进入新增节点

对真实材料路径，当前默认收口应补上：

> source import -> 选中导入 root node -> 看懂来源上下文 -> 起草 AI draft -> review -> apply

短期内，判断优先级时优先看这条路径是否更顺，而不是入口是否更多、界面是否更大。

## 当前接力焦点

如果只再推进一天，默认继续压实这条桌面主路径，而不是扩更多能力面。

当前最值得接力的实现范围是：

- 守住左栏 `Import Source` 入口，避免真实材料路径又退回桌面原生菜单
- 守住右栏来源上下文的人话摘要、继续入口和 cite / uncite 工作流
- 守住 apply 后统一的 focus node 语义，避免前后端再次各自猜“下一步去哪”
- 把右栏轻量 `AI draft route` 提示继续收成“需要时可见、失败时有下一步”的状态层，而不是重新长回重型调试面板
- 把 `desktop_flow_smoke.py` 和 `test:logic` 继续当作当前两条默认回归门：
  - `desktop_flow_smoke.py` 守主流程闭环
  - `test:logic` 守右栏轻量 UI 语义

当前明确不抢优先级的内容：

- `PNG` / `PDF` 导出
- 完整拖拽布局或自由画布编辑
- 恢复工作区级 `AI runs` / `Activity` / `Run Inspector` 到主界面
- 新的 provider 接入路径
- 绕过 patch 的桌面直写状态
- 大规模架构重整

## 当前判断

当前新的关键判断是：

- 共享内核已经足够支撑桌面端，问题不在内核
- 当前桌面壳已经从“调试 / 审计工作台”进一步收成一版“可折叠导航轨 + 中栏纯画布 + 右栏上下文 / review”的最小节点工作流
- 但它仍然只是第一轮收口，不适合作为最终产品基线
- 因此短期优先级应从“继续砍入口”切到“把最小主流程做顺、做稳、做得更像人话”
- 桌面 v2 的画布层方向现在默认收敛到 `React Flow`；短期内不再把时间花在反复选型上

在这个判断下，当前最缺的不是“desktop 里能不能看 run / compare / replay / activity”，而是缺：

- apply 之后系统是否明确把用户带到下一步
- 来源卡片是否能解释“为什么值得看”，而不只是列 chunk 摘要
- AI draft 默认主路是否在主界面里足够可见，失败时是否给出下一步
- 真实 provider 路径是否有稳定、可回归的主流程 smoke
- 文档是否和当前最小实现完全对齐

另外有一条新的短期边界需要明确：

- 当前桌面主界面里已经不再暴露工作区级 AI runs、Activity 和 Run Inspector
- 这不是临时隐藏，而是当前明确的实现选择
- 如果后续要恢复这些入口，必须先证明它们对主流程有帮助，而不是默认回到调试壳

因此这里优先描述“下一步该压实什么”，而不是继续把已完成的 desktop 能力当成待办。

## 当前执行顺序

### 1. 先把最小主流程做顺

状态：当前优先级最高

目标：

- 让 `draft -> review -> apply -> next node` 这条链真正顺下来
- 让 apply 完成态不只是“成功了”，而是明确告诉用户“现在去哪”
- 让右侧 `Context` 不只是来源罗列，而是开始解释“为什么值得看”
- 保持主界面继续只服务主路径，而不是重新长回调试入口

下一轮最小切口：

- 守住 `test:logic` 当前已覆盖的三块右栏语义：
  - `AiDraftRouteSurface`
  - `SourceContextSurface`
  - `NodeContextSurface`
- 如果再推进一轮，优先补“左栏导入 -> 节点落点 -> 右栏上下文 / Review 切换”这组高频交接验证
- 继续避免在主界面回填任何 run-id、artifact、compare、history 式入口
- 如果某条信息不能帮助用户继续当前节点工作流，就不进入主界面

这一轮的最小验收标准：

- 选中节点后，右栏能给出至少一层更接近人类判断的来源摘要，而不只是 chunk 标签拼接
- apply 成功后，界面文案能同时表达“变更结果”和“下一步入口”
- 如果 patch 新增了节点，系统会优先把用户带到新增节点，并且这个结果在 UI 上是可见的
- 如果从桌面原生路径导入 source，界面会优先选中导入得到的 root node，而不是回退到工作区根节点
- 如果 AI draft 路径不可用、缺 auth 或 env 冲突，右栏会给出轻量状态提示和下一步建议，而不是只剩一条报错
- 这条闭环不要求用户理解 run-id、artifact 或 raw patch JSON

### 2. 给当前主路径补一条稳定 smoke

状态：与第一项并行推进

目标：

- 把当前桌面主流程变成可回归的最小验证路径
- 防止后续 UI 收口时又把 apply 完成态、node focus 或来源上下文弄丢
- 让桌面主路径不只靠人工点一遍证明

当前最小切口：

- 优先覆盖：
  - 打开工作区
  - 选中节点
  - 起草 expand
  - review
  - apply
  - 聚焦新增节点
- 当前已落地统一入口：`python3 scripts/desktop_flow_smoke.py`
  - 默认复用 `provider_smoke` 的 `source-context` 场景，不新增状态边界
  - `--json` 输出会带 `next_focus_candidate`，用于回归 apply 后是否能继续进入新增节点
  - `--json` 输出当前也已带 `ai_status`，用于守住 desktop 默认 draft route 的 provider / auth / env 提示
- 这条 smoke 优先服务当前最小 UI，而不是覆盖已删除的二级视图

当前交付要求：

- 自动化 smoke 已收口到统一入口后，优先补测试和文档，避免脚本入口漂移
- `desktop/package.json` 的 `check:all` 当前也应继续带上 `test:logic`
  - 用来守住右栏轻量 `AI draft route` 的前端纯逻辑分支
  - 当前也已开始覆盖 `AiDraftRouteSurface` 的轻量静态渲染分支，而不是只测 helper
- `test:logic` 当前也已覆盖：
  - `SourceContextSurface`
  - `NodeContextSurface`
- 如果自动化还不稳，至少先把固定场景、固定步骤、预期结果写进项目文档，避免每次接力都重新摸索
- smoke 的默认目标不是“覆盖所有功能”，而是守住当前桌面主路径不回退

### 3. 继续压实纯画布主舞台

状态：与第一项并行推进，但不抢主流程收口

目标：

- 保持中栏继续只服务纯画布，不被节点详情和重复按钮重新占回去
- 继续把高频动作优先收回画布节点卡片
- 继续把左右栏收成更轻的导航 / 上下文承载层
- 保持画布层继续只做交互与呈现，不接管 canonical state

当前最小切口：

- 保持左栏继续可折叠，并让中栏稳定吃回腾出来的空间
- 保持右栏默认显示更轻的节点摘要、来源摘要和按需编辑
- 避免把 `Expand` / `Explore` / `Add Child` 这类高频动作重新搬回画布外
- 暂不在画布层直接引入绕过 patch 的结构写入
- 如果要试自动布局，优先作为画布层上的补充实验，而不是新的状态边界

### 4. 把默认 LangChain 主路和对照路径继续做成可比较验证

状态：与桌面重做并行推进

目标：

- 把现有 Anthropic-compatible LangChain 默认链路整理成可重复执行的 smoke / e2e 路径
- 让 `run-id -> artifact -> compare -> replay -> apply` 这条链路能做回归，而不是只靠手动演示
- 继续保持 external runner 边界，不把 provider SDK 直接塞进 Rust 内核
- 让 LangChain 试点继续作为同 contract 的默认试点主路和对照组存在

当前最小切口：

- 以 `langchain_anthropic_runner.py` 作为当前默认试点主路
- 再用 `openai_runner.py` 和 `langchain_openai_runner.py` 作为平行对照
- 也允许通过 `scripts/runner_compare.py --preset langchain-pilot` 把这条对照流程收成统一入口
- Anthropic 主路的 smoke 也应优先补到 `--scenario source-context` 这种真实来源节点，而不只停在 root 空树
- 优先覆盖这些动作的最小闭环：
  - `draft`
  - `show`
  - `artifact`
  - `compare`
  - `replay`
  - 可选的最终 apply
- 如果当前默认 Anthropic-compatible 路径需要先确认配置，优先先跑：
  - `nodex ai doctor --provider anthropic --format json`

### 5. 再补来源能力与多 provider 抽象

状态：前面两项压实后再进入

当前暂缓但明确在后面的项：

- `PDF import`
- 来源问答
- 更完整的 evidence 视图
- 多 provider 抽象的进一步统一
  - provider config 发现
  - auth/source 诊断
  - transient error 分类与重试
  - runner mode（schema / plain / fallback）

## 暂不优先

下面这些方向没有被否定，只是当前不应抢占前面顺序：

- 继续在当前 legacy 桌面壳上扩主视图、补更多面板或做局部润色式“救火”
- 过早扩很多 AI 入口，但每条都不够可解释
- 把 evidence 语义一次性做成很重的文献系统
- 为未来能力提前铺太多空壳结构
- 在真实 provider 主路径还没顺之前，就发起一轮通用 Intent Layer 重构

## 更新要求

后续更新这份文档时：

- 直接重写“当前优先级”“当前最小切口”“当前阻塞点”
- 不记录按轮次累积的完成项
- 不把它写成开发日报或提交摘要
