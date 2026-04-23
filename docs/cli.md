# CLI 使用说明

## 快速开始

```bash
cargo run -- init
cargo run -- node list
cargo run -- source import README.md --dry-run
cargo run -- source import README.md
cargo run -- patch inspect examples/expand-root.json
cargo run -- patch apply examples/expand-root.json
cargo run -- snapshot save --label after-expand
cargo run -- export outline
```

## 顶层命令

```text
nodex init
nodex ai
nodex node
nodex patch
nodex source
nodex snapshot
nodex export
```

精确 flags 以 `nodex <command> --help` 为准。

## 推荐入口

### 节点与 patch

- `nodex node add|update|move|delete`
- `nodex node show`
- `nodex node list`
- `nodex patch inspect`
- `nodex patch apply`
- `nodex patch history`

### 来源

- `nodex source import`
- `nodex source list`
- `nodex source show`
- `nodex node cite-chunk`
- `nodex node uncite-chunk`

### 快照与导出

- `nodex snapshot save|list|restore`
- `nodex export outline`

### AI

- `nodex ai doctor`
- `nodex ai status`
- `nodex ai providers`
- `nodex ai smoke`
- `nodex ai expand`
- `nodex ai explore`
- `nodex ai run-external`
- `nodex ai history|show|artifact|patch|replay|compare`

## 当前推荐 AI 流

当前默认推荐 AI 主路是 `openai` provider 对应的 OpenAI-compatible LangChain 路径。

### 配置检查

```bash
cargo run -- ai doctor --provider openai --format json
cargo run -- ai smoke --provider openai --format json
```

当前 provider loader 会优先读取仓库内的 `.env.local` / `.env`，再回退到继承的 shell 环境变量；
`ai doctor` 仍会把继承进程里的 `OPENAI_*` / `ANTHROPIC_*` 等变量单独列出来，便于排查全局旧配置污染。

### dry-run 请求

```bash
cargo run -- ai expand <node-id> --dry-run
cargo run -- ai explore <node-id> --by risk --dry-run
```

### 外部 runner

```bash
cargo run -- ai run-external <node-id> "python3 scripts/provider_runner.py --provider openai --use-default-args" --dry-run
```

### provider smoke

```bash
python3 scripts/provider_smoke.py --provider openai --scenario source-root --json
python3 scripts/provider_smoke.py --provider openai --scenario source-context --json
```

### 审计与回放

```bash
cargo run -- ai history
cargo run -- ai show <run-id>
cargo run -- ai replay <run-id> --dry-run
cargo run -- ai compare <left-run-id> <right-run-id>
```

这些入口当前会保留并读取：

- runner retry / error 分类
- `used_plain_json_fallback`
- `normalization_notes`

`ai compare` / `scripts/runner_compare.py` 的定位是：

- 汇总 runner pair 是否可比较、哪里被 blocker 卡住
- 给出 patch / explanation / normalization 的结构级差异摘要
- 输出 machine-readable 的 readiness / metrics / difference kinds，方便回归和对照
- 对失败 lane，额外保留最小 provenance：
  `failure_source` 会说明分类来自 `history_metadata` 还是 `stderr`；
  如果当前工作区历史里能定位到对应的 failed run，也会继续带出 `failed_run_id`，并在线路被 blocker 卡住时透传到 blocked-comparison payload / 文本报告里

如果想在本地缺少 OpenAI 依赖或凭据时继续做 preset compare，也可以显式用：

```bash
python3 scripts/runner_compare.py --preset langchain-pilot --preset-offline openai --scenario source-root --json
python3 scripts/runner_compare.py --preset langchain-pilot --preset-offline openai --scenario source-context --json
```

这里的 `--preset-offline openai|all` 只作用于 compare：

- `openai` 只替换 `langchain-pilot` 里的两条 OpenAI lane
- `all` 替换整个 preset，主要给测试或无依赖回归使用
- 不改变默认 provider 路由，也不影响 `provider_smoke.py` 或桌面默认 draft route

## 当前默认路径回归门

如果目标是守住 Nodex 的默认桌面路径，优先跑同一个命名回归门：

```bash
just default-path-gate
```

它会按固定顺序执行这 5 步：

```bash
cargo fmt --check
cargo test
cd desktop && npm run test:logic
python3 scripts/desktop_flow_smoke.py --json
python3 scripts/provider_smoke.py --provider openai --scenario source-root --json
```

如果当前环境没有安装 `just`，就直接按上面这 5 步手动执行。

如果你已经在 `desktop/` 目录里，也可以跑同名的局部入口：

```bash
npm run default-path-gate
```

这个 `desktop` 侧入口只负责后 3 步桌面 / smoke 验证；根目录的 `just default-path-gate` 仍然是默认推荐入口，因为它会先补上 `cargo fmt --check` 和 `cargo test`。

`desktop_flow_smoke.py --json` 当前重点输出：

- `desktop_flow.imported_root_node`
- `desktop_flow.target_node`
- `desktop_flow.next_focus_candidate`
- `desktop_flow.checks`
- `ai_status`

默认不传 `--runner-command` 时，这条 smoke 会复用桌面真实默认 draft route：
`python3 scripts/provider_runner.py --provider openai --use-default-args`。
因此 `ai_status` 里的 provider / runner / route health 也属于这条回归入口要守住的 contract。

`cd desktop && npm run check:all` 仍然保留，但它是更偏桌面开发的 convenience superset：

- 会继续跑 `check` / `check:tauri` / `test:core`
- 不等价于上面的默认路径回归门
- 默认路径回归门仍以上面的 5 步顺序为准

## 工作区发现

Nodex 会从当前目录向上查找 `.nodex/project.db`。

## 当前边界

- CLI convenience commands 仍然复用 patch 引擎
- AI runtime 仍然通过 external runner 边界接入
- 桌面默认 draft route 属于桌面工作流说明，不是额外的状态边界
