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
- 每完成一个小步，就更新这份文档里的状态、顺序或阻塞点
- 这里优先记录“下一步做什么”，不要把已经落地的实现细节无限堆回这里
- 如果某项已经不再是短期重点，就从这里移走，保留到 `docs/roadmap.md`

## 当前主路径

当前最值得压实的产品路径是：

> 选中一个节点 -> 用真实 provider 起草 AI draft -> 用户能看懂理由和证据 -> 预览 patch -> 再决定是否应用

短期内，判断优先级时优先看这条路径是否更顺，而不是入口是否更多、界面是否更大。

## 当前基线

下面这些能力已经有最小落地，后续以 `docs/cli.md` 和相关专项文档为准，这里不再展开重复：

- `ai expand` 可解释化最小闭环
- `ai explore` 最小 CLI / external runner / desktop draft 入口
- evidence 最小语义：citation rationale + `direct` / `inferred`
- AI 运行历史最小索引：`ai_runs` + `nodex ai history`

## 当前执行顺序

### 1. 把真实 provider 路径做成产品态

状态：当前优先级最高

目标：

- 不再停留在“桥接能力已存在但用户感知不强”的状态
- 把现有 external runner + 最小 OpenAI runner 做成清晰可用的真实运行路径
- 保持 external runner 边界，不急着把 provider SDK 写进 Rust 内核

当前基础：

- 真实 OpenAI provider 已可通过 `ai run-external` 和桌面 draft 入口跑通
- 已有 request / response contract、解释层、evidence 最小语义、运行审计和 `ai_runs` 索引
- 已新增可复用本机 `codex login` / `~/.codex/config.toml` 的 `scripts/codex_runner.py`
- 已新增 `scripts/codex_doctor.py`，可排查 Codex live config 与 `OPENAI_*` 环境变量冲突
- 已开始抽离 shared provider runtime / codex context，避免后续 runner 再重复实现 env 冲突、backoff 和 live config 发现逻辑
- 已为 OpenAI 路径补上第二个最小 skeleton：`openai_context.py` / `openai_doctor.py`
- 已为 Gemini 路径补上第三个最小 skeleton：`gemini_context.py` / `gemini_doctor.py`
- 已新增统一入口 `provider_doctor.py`，可聚合查看 Codex / OpenAI / Gemini 三条线的本地诊断结果
- 已新增 `provider_runner.py` 作为统一 runner 入口的最小壳，先收口 `openai` / `codex`
- 已将 Gemini 从 diagnostics-only 推进到最小 runnable provider：`scripts/gemini_runner.py`
- 已新增 `provider_smoke.py`，可在临时工作区里统一跑 provider smoke
- 已为 provider 工具链补上最小离线回归测试，覆盖 registry / doctor / smoke 列表等关键路径
- 已将 request contract / response schema / runner error 基础能力抽到共享模块，避免其他 provider 继续依赖 `openai_runner.py`

下一轮最小切口：

- 把 Codex 这条调试链路继续压实成默认可用路径：
  - 固定一条稳定的 `plain + low + retries` smoke 命令
  - 让一次 Codex draft 的 request / response / patch / 最终 apply 状态更容易串起来看
  - 把 relay `502`、schema 输出不稳定、环境变量覆盖这三类问题区分清楚
- 让当前 provider 是否已配置、正在使用哪个 runner / model 更可见
- 让失败原因和下一步动作更清楚，而不是只暴露底层错误

短期只关心这条流程是否顺手：

- 选节点
- 用真实 provider 起草 expand / explore
- 查看理由和证据
- 预览 patch
- 应用 patch
- 回看历史

补充说明：

- 当前更适合把 `codex_runner.py` 作为后端调试主路，而不是继续依赖裸 HTTP 的 `openai_runner.py`
- 如果同一机器上还保留 `OPENAI_*` 环境变量，优先先跑 `python3 scripts/codex_doctor.py`

### 2. 串顺桌面主流程

状态：和 1 配套推进，但不抢前面优先级

目标：

- 用现有 Tauri 壳把核心链路串顺
- 不急着把 GUI 做大

当前最小关注点：

- 当前节点上下文在 draft / apply / refresh 之后保持稳定
- 节点详情里的最近 AI 运行记录、patch 编辑器和 apply 结果之间切换更自然

### 3. 再补来源能力

状态：前面主路径顺了之后再进入

当前暂缓但明确在后面的项：

- `PDF import`
- 来源问答
- 更完整的 evidence 视图

### 3.5 推进多 provider 抽象

状态：在 Codex 链路稳定后立即进入，不晚于来源能力前期设计

目标：

- 不把当前 Codex 路径做成一次性的脚本特判
- 在保持 external runner 边界的前提下，为后续多 provider 接入预留稳定抽象

当前判断：

- `cc-switch` 的借鉴点主要不在“再写一个更重的代理”，而在：
  - 把 live config 读写当作一等能力
  - 把环境变量冲突当作显式诊断项
  - 把不同 provider 的 URL / auth / config 语义拆成独立适配层

下一轮最小切口：

- 抽一层 shared provider diagnostics / config context，避免 `codex_runner.py` 变成孤例
- 至少再让一个非 Codex provider 落到同一套结构上，验证抽象不是假抽象
- 下一步优先考虑把第三条线从“doctor/context”推进到“最小 runnable provider”
- 同时继续收敛操作面，优先从多个 provider-specific 脚本收敛到更少的统一入口
- 后续可以考虑让 `provider_runner.py` 直接承接默认 smoke 命令，逐步替代手写具体脚本路径
- Gemini runnable 路径落地后，下一轮更适合补共享测试样例或统一 runner mode 能力，而不是继续加第四条线
- 统一 smoke 入口落地后，下一轮更适合补共享测试样例或统一 runner mode 能力，而不是继续加第四条线
- 约定 future runners 至少统一这些能力：
  - provider config 发现
  - auth/source 诊断
  - transient error 分类与重试
  - runner mode（schema / plain / fallback）
- 文档上明确区分：
  - 真实调试主路
  - provider-specific workaround
  - 长期可复用抽象

### 4. 最后再做更完整的脑图 GUI

状态：当前不是短期重点

说明：

- 画布、大型交互、完整脑图主界面都重要
- 但它们应该建立在“AI 节点拓展主路径已经足够可信和顺手”的前提上

## 暂不优先

下面这些方向没有被否定，只是当前不应抢占前面顺序：

- 先把桌面壳做成很重的完整应用
- 过早扩很多 AI 入口，但每条都不够可解释
- 把 evidence 语义一次性做成很重的文献系统
- 为未来能力提前铺太多空壳结构

## 交接时建议补充的信息

如果某次开发完成或中断，最好顺手把这些信息写回这份文档：

- 当前做到第几项
- 本轮实际改了什么
- 哪个点还卡住
- 下一轮最小可继续的切口是什么
