# CLI 使用说明

本文描述的是当前已经落地的 CLI MVP，而不是未来的完整产品形态。

## 快速开始

初始化一个工作区：

```bash
cargo run -- init
```

查看当前树：

```bash
cargo run -- node list
```

导入一个 Markdown 或文本文件：

```bash
cargo run -- source import README.md
```

预览导入将生成的 patch：

```bash
cargo run -- source import README.md --dry-run
```

预览示例 patch：

```bash
cargo run -- patch inspect examples/expand-root.json
```

应用示例 patch：

```bash
cargo run -- patch apply examples/expand-root.json
```

保存快照：

```bash
cargo run -- snapshot save --label after-expand
```

导出 Markdown 大纲：

```bash
cargo run -- export outline
```

## 命令总览

### AI

```text
nodex ai doctor [--provider openai|codex|gemini] [--format text|json]
nodex ai status [--provider openai|codex|gemini] [--format text|json]
nodex ai providers [--format text|json]
nodex ai smoke --provider openai|codex|gemini [--node-id <id>] [--apply] [--keep-workspace] [--format text|json] [-- <extra args...>]
nodex ai expand <node-id> --dry-run [--emit-request path] [--emit-response-template path] [--format text|json]
nodex ai explore <node-id> --by risk|question|action|evidence --dry-run [--emit-request path] [--emit-response-template path] [--format text|json]
nodex ai apply-response <file> [--dry-run] [--format text|json]
nodex ai history [--node-id <id>] [--format text|json]
nodex ai show <run-id> [--format text|json]
nodex ai artifact <run-id> --kind request|response|metadata [--format text|json]
nodex ai patch <run-id> [--format text|json]
nodex ai replay <run-id> [--dry-run|--apply] [--format text|json]
nodex ai compare <left-run-id> <right-run-id> [--format text|json]
nodex ai run-external <node-id> <command> [--capability expand|explore] [--by risk|question|action|evidence] [--dry-run] [--format text|json]
```

说明：

- `ai doctor` 会直接调用统一的 provider 诊断入口，优先用于确认本机 live config、auth 和环境变量冲突
- `ai doctor --provider codex --format json` / `ai doctor --provider openai --format json` 适合脚本化排查
- `ai status` 会基于统一 diagnostics 输出更短的结构化摘要，适合快速看某个 provider 是否 runnable / 是否有 auth / 是否有 env conflict
- `ai providers` 会列出当前所有 provider 的紧凑摘要视图
- `ai smoke` 会在临时工作区里串起：
  - `init`
  - 一次最小 `ai run-external`
  - 可选的真正 apply
- `ai smoke --format json` 会返回结构化 smoke 元数据，包含 preflight summary 和底层命令输出
- `ai smoke --provider codex` 当前会自动带上默认 smoke 参数：
  - `--mode plain`
  - `--reasoning-effort low`
  - `--max-retries 3`
- `ai expand` 本身只负责 dry-run request 预览，不直接调用模型
- `ai explore` 也同样只负责 dry-run request 预览，但会额外要求 `--by`
- 当前 `ai explore` 支持这些角度：
  - `risk`
  - `question`
  - `action`
  - `evidence`
- `ai run-external` 则可以通过外部 runner 触发真实模型调用，并在不传 `--dry-run` 时真正应用 patch
- 这套能力既支持“纯本地 dry-run”，也支持“真实 provider -> response -> patch”的最小闭环
- `ai expand` 会在本地组装 AI expand 请求上下文，并生成一份可审阅的 patch scaffold
- `ai explore` 会复用同一套 request / response / patch 边界，只是在 prompt 与 scaffold 上按 `--by` 角度收束
- 当前 AI request / response contract version 为 `2`
- response contract 现在除了 patch，还要求返回一层结构化解释：
  - `explanation.rationale_summary`
  - `explanation.direct_evidence`
  - `explanation.inferred_suggestions`
- 请求上下文会做保守裁剪，不会把所有 source / evidence chunk 无限制拼进去
- prompt 会显式要求模型避免泛化标题，优先给出贴近节点语义的分支
- `--emit-request` 会导出稳定的 request bundle，供外部 AI runtime 消费
- `--emit-response-template` 会导出一份 contract 正确的 response template，方便外部流程替换其中的 patch
- `--format text` 会输出 prompt bundle、patch 预览、解释骨架和说明
- `--format json` 会返回结构化 dry-run 结果，便于后续 headless / agent 流程复用
- `ai apply-response <file> --dry-run` 会校验并预览外部 response 里的 patch 与 explanation
- `ai apply-response <file>` 会把外部 response 中的 patch 真正应用到当前工作区
- `ai history` 会读取 SQLite 里的 AI 运行索引，而不是重新扫描 `.nodex/ai/*.json`
- `ai history --node-id <id>` 可只看某个节点的运行记录
- `ai history --format text` 现在会直接显示：
  - request / response / derived metadata 路径
  - provider run id、retry count、exit code
  - 关联 patch run 与 patch summary（如果有）
- `ai show <run-id>` 会汇总一条运行记录，并在 response 可读时继续显示 explanation、patch 预览和 response notes
- `ai artifact <run-id> --kind ...` 会直接读取该次运行的 request / response / metadata 工件
- `ai patch <run-id>` 会优先读取关联 `patch_run_id` 对应的最终 patch；如果这次运行只是 dry-run，则回退到 response 里的 patch
- `ai replay <run-id>` 会把这次运行对应的 patch 重新送回统一 patch 引擎：
  - 默认是安全的 dry-run 预览
  - `--apply` 才会真正写入当前工作区
  - 如果这条 AI run 原本还是 dry-run，`--apply` 后会把新产生的 patch run 反链回这条 `ai_runs` 记录
  - 如果原始 patch 已经落盘到 `patch_runs`，replay 会先把其中 concrete 的新增节点 id 重映射成一组新 id，避免直接撞上旧节点
- `ai compare <left-run-id> <right-run-id>` 会把两条运行记录并排展开，并汇总这些关键差异：
  - node / capability / provider / model / status
  - explanation.rationale_summary
  - patch summary 与 patch preview
  - response notes
- `ai apply-response` 和 `ai run-external --format text` 会直接显示：
  - 理由摘要
  - 直接证据
  - 推断建议
- `ai run-external --capability explore --by risk` 可以直接走完整的 explore 外部 runner 路径
- `--by` 只有在 `--capability explore` 时才合法
- `ai run-external` 会在 `.nodex/ai/` 下写入 request / response 文件，并通过环境变量调用一个本地命令：
  - `NODEX_AI_REQUEST`
  - `NODEX_AI_RESPONSE`
  - `NODEX_AI_META`
  - `NODEX_AI_WORKSPACE`
  - `NODEX_AI_NODE_ID`
- 外部命令只需要读取 request JSON，并把符合 contract 的 response JSON 写到 `NODEX_AI_RESPONSE`
- CLI 会额外生成一份 `.meta.json`，记录：
  - provider
  - model
  - provider run id
  - retry count
  - 最后一次错误分类
  - patch run id（如果真正 apply）
- `ai run-external` 成功或失败后，都会把这次运行的最小索引写进 SQLite `ai_runs` 表
- 成功和失败都会尽量写 `.meta.json`，方便之后排查一次调用到底发生了什么
- 这条命令当前仍然不内置任何 provider SDK；它只是本地执行桥
- 仓库内提供了一个最小 OpenAI runner：`python3 scripts/openai_runner.py`
- 如果你的 provider 已经通过本机 `codex login` 和 `~/.codex/config.toml` 跑通，也可以改用：
  - `python3 scripts/codex_runner.py`
- Gemini 路径现在也有最小 runner：
  - `python3 scripts/gemini_runner.py`
- 如果你想收敛命令面，也可以通过统一入口转发到具体 provider runner：
  - `python3 scripts/provider_runner.py --provider openai`
  - `python3 scripts/provider_runner.py --provider codex`
  - `python3 scripts/provider_runner.py --provider gemini`
  - `python3 scripts/provider_runner.py --list`
- `codex_runner.py` 会复用本机 Codex CLI 的登录态和 provider 配置，而不是直接手写 Bearer 请求
- `codex_runner.py` 默认优先读取：
  - `~/.codex/config.toml` 里的 `model` / `model_reasoning_effort`
  - `codex login status` 当前登录态
- 它会在启动 `codex exec` 前忽略父进程里的 `OPENAI_*` 环境变量，避免当前 shell 配置覆盖 Codex live config
- 可通过这些参数或环境变量覆盖默认行为：
  - `--mode auto|schema|plain`
  - `--model ...` 或 `CODEX_RUNNER_MODEL`
  - `--reasoning-effort ...` 或 `CODEX_RUNNER_REASONING_EFFORT`
  - `--max-retries ...` 或 `CODEX_RUNNER_MAX_RETRIES`
- 开发时可复制根目录 `.env.example` 到 `.env.local`，填入 `OPENAI_API_KEY`
- 默认模型是 `gpt-5.4-mini`，也可以通过 `OPENAI_MODEL` 覆盖
- runner 默认会对可重试错误做指数退避重试：
  - `429` rate limit
  - `408/409`
  - `5xx`
  - 网络错误 / timeout
- 可通过这些环境变量调节：
  - `OPENAI_TIMEOUT_SECONDS`
  - `OPENAI_MAX_RETRIES`
  - `OPENAI_BACKOFF_SECONDS`
  - `OPENAI_MAX_BACKOFF_SECONDS`
- 常见错误会带分类前缀，例如：
  - `[rate_limit]`
  - `[quota]`
  - `[auth]`
  - `[permission]`
  - `[invalid_request]`
  - `[server_error]`
  - `[network]`
  - `[timeout]`
  - `[refusal]`
  - `[schema_error]`
  - `[parse_error]`

一个最小开发命令示例：

```bash
cp .env.example .env.local
# 编辑 .env.local，填入 OPENAI_API_KEY

cargo run -- ai run-external root "python3 scripts/openai_runner.py" --dry-run
```

如果当前机器上的 `codex exec` 已经能正常调用目标 provider，也可以直接复用它：

```bash
codex login status
cargo run -- ai run-external root "python3 scripts/codex_runner.py --reasoning-effort medium" --dry-run
```

建议先做一次本地诊断，确认 `~/.codex` live config 和环境变量没有冲突：

```bash
python3 scripts/provider_doctor.py --provider codex
```

如果你想一次看完当前机器上的 Codex / OpenAI / Gemini 三条 provider 诊断，也可以直接跑统一入口：

```bash
python3 scripts/provider_doctor.py --json
```

现在也可以直接通过 CLI 入口调用：

```bash
cargo run -- ai doctor --provider codex --format json
cargo run -- ai status --provider codex --format json
cargo run -- ai providers
```

如果你想直接在临时工作区里跑一轮 provider smoke，也可以使用统一 smoke 入口：

```bash
python3 scripts/provider_smoke.py --provider codex
python3 scripts/provider_smoke.py --provider openai
python3 scripts/provider_smoke.py --provider gemini
```

`provider_smoke.py` 会先做一层 provider preflight；如果当前 provider 没有可用 auth，会直接提示先跑对应的 `provider_doctor.py`。

现在也可以直接通过 CLI 入口调用：

```bash
cargo run -- ai smoke --provider codex --format json
```

如果自定义 relay 对 `--output-schema` 路径不稳定，可以优先用 plain 模式：

```bash
cargo run -- ai run-external root "python3 scripts/codex_runner.py --mode plain --reasoning-effort low --max-retries 3" --dry-run
```

如果你想统一 runner 入口，也可以这样调用：

```bash
cargo run -- ai run-external root "python3 scripts/provider_runner.py --provider codex --mode plain --reasoning-effort low --max-retries 3" --dry-run
```

### 初始化

```text
nodex init
```

在当前目录创建一个 Nodex 工作区，并初始化：

- `./.nodex/project.db`
- `./.nodex/runs/`
- `./.nodex/snapshots/`
- `./.nodex/sources/`
- `./.nodex/exports/`

同时会自动创建：

- 根节点 `root`
- 一份初始快照 `initial`

### 节点操作

```text
nodex node add <title> [--parent root] [--kind topic] [--body ...] [--position N]
nodex node update <id> [--title ...] [--body ...] [--kind ...]
nodex node move <id> --parent <id> [--position N]
nodex node delete <id>
nodex node cite-chunk <id> <chunk-id> [--citation-kind direct|inferred] [--rationale ...]
nodex node uncite-chunk <id> <chunk-id>
nodex node show <id> [--format text|json]
nodex node list [--format tree|json]
```

说明：

- `node add/update/move/delete` 并不是绕过 patch 引擎直接写库，而是走同一套结构化 patch 流程
- `node cite-chunk` / `node uncite-chunk` 是显式 evidence 引用的 convenience command，底层同样走 patch 引擎
- `node cite-chunk` 现在支持最小 evidence 元数据：
  - `--citation-kind direct|inferred`
  - `--rationale ...`
- `node show` 用来查看节点详情、来源关联，以及显式 evidence 引用
- `node show --format json` 返回结构化节点详情
- `node list --format tree` 返回人类可读树
- `node list --format json` 返回结构化树

### Patch 操作

```text
nodex patch inspect <file>
nodex patch apply <file> [--dry-run]
nodex patch history [--format text|json]
```

说明：

- `inspect` 只读 patch 并输出人类可读预览
- `apply --dry-run` 做校验和预览，不修改工作区
- `apply` 会把 patch 文件内容归档到 `./.nodex/runs/`
- `history` 用来查看已经应用过的 patch
- `history --format json` 返回结构化 patch run 列表
- multi-op patch 会按顺序基于前序 op 的结果继续校验和执行，所以后续 op 可以引用同一 patch 里新建出来的节点
- 当前 patch 除了节点结构编辑，也支持：
  - `attach/detach source`
  - `attach/detach source chunk`
  - `cite/uncite source chunk`
- 目前还没有单独的 `evidence` convenience command；显式 evidence 引用先通过 patch 表达

### Source 操作

```text
nodex source import <file> [--dry-run] [--emit-patch path]
nodex source list [--format text|json]
nodex source show <source-id> [--format text|json]
```

说明：

- 当前只支持 `md` / `txt`
- 导入的原文件会复制到 `./.nodex/sources/`
- 导入时会生成一个初始节点树
- 导入生成的节点结构会复用 patch 引擎，并写入 `patch history`
- 导入时会自动生成基础来源切片，并把生成节点和切片建立关联
- `--dry-run` 会预览并校验导入将生成的 patch，但不会修改工作区
- `--emit-patch path` 会把导入生成的 patch preview 写到指定 JSON 文件，也不会执行真正导入
- `--dry-run` 和 `--emit-patch` 可以一起用
- `source list` 用来查看已经导入的来源文件
- `source show` 用来查看一个来源的切片、结构关联节点，以及显式引用它作为 evidence 的节点
- `source show` 的文本输出现在也会显示 citation kind 和 rationale（如果有）
- `source list/show --format json` 返回结构化来源信息

### Snapshot 操作

```text
nodex snapshot save [--label ...]
nodex snapshot list [--format text|json]
nodex snapshot restore <snapshot-id>
```

说明：

- `save` 会把当前完整状态保存到 `./.nodex/snapshots/`
- `list --format json` 返回结构化 snapshot 列表
- `restore` 会在真正恢复前自动保存一份 `auto-before-restore-*` 快照
- 当前 snapshot 会保存节点树、已导入 source、source chunks 以及基础关联
- 当前 restore 不会回滚 `patch history`

### 导出

```text
nodex export outline [--output path]
```

说明：

- 默认导出到 `./.nodex/exports/outline-<timestamp>.md`
- 如果传 `--output`，支持相对路径和绝对路径

## 工作区发现规则

除了 `init` 以外，其他命令都会从当前目录开始向上查找 `.nodex/project.db`。

这意味着你可以：

- 在工作区根目录执行命令
- 在工作区子目录执行命令

只要上层目录存在合法的 `.nodex/project.db`，CLI 都能找到对应工作区。

## 当前边界

当前 CLI 还没有实现：

- 来源问答
- PDF 导入
- 完整来源与证据视图

所以这版 CLI 的定位是：

> 先把 patch-first 的本地工作区内核跑通
