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

### 配置检查

```bash
cargo run -- ai doctor --provider anthropic --format json
cargo run -- ai smoke --provider anthropic --format json
```

### dry-run 请求

```bash
cargo run -- ai expand <node-id> --dry-run
cargo run -- ai explore <node-id> --by risk --dry-run
```

### 外部 runner

```bash
cargo run -- ai run-external <node-id> "python3 scripts/provider_runner.py --provider anthropic --use-default-args" --dry-run
```

### 审计与回放

```bash
cargo run -- ai history
cargo run -- ai show <run-id>
cargo run -- ai replay <run-id> --dry-run
cargo run -- ai compare <left-run-id> <right-run-id>
```

## 当前桌面回归入口

如果目标是守住桌面主路径，不是看单条 CLI 命令，优先跑：

```bash
python3 scripts/desktop_flow_smoke.py --json
cd desktop && npm run test:logic
```

## 工作区发现

Nodex 会从当前目录向上查找 `.nodex/project.db`。

## 当前边界

- CLI convenience commands 仍然复用 patch 引擎
- AI runtime 仍然通过 external runner 边界接入
- 桌面默认 draft route 属于桌面工作流说明，不是额外的状态边界
