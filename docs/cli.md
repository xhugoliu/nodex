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
nodex ai expand <node-id> --dry-run [--emit-request path] [--emit-response-template path] [--format text|json]
nodex ai apply-response <file> [--dry-run] [--format text|json]
nodex ai run-external <node-id> <command> [--dry-run] [--format text|json]
```

说明：

- 当前只实现 `--dry-run`
- 这条命令不会调用真实模型，也不需要 API key
- 它会在本地组装 AI expand 请求上下文，并生成一份可审阅的 patch scaffold
- 请求上下文会做保守裁剪，不会把所有 source / evidence chunk 无限制拼进去
- prompt 会显式要求模型避免泛化标题，优先给出贴近节点语义的分支
- `--emit-request` 会导出稳定的 request bundle，供外部 AI runtime 消费
- `--emit-response-template` 会导出一份 contract 正确的 response template，方便外部流程替换其中的 patch
- `--format text` 会输出 prompt bundle、patch 预览和说明
- `--format json` 会返回结构化 dry-run 结果，便于后续 headless / agent 流程复用
- `ai apply-response <file> --dry-run` 会校验并预览外部 response 里的 patch
- `ai apply-response <file>` 会把外部 response 中的 patch 真正应用到当前工作区
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
- 成功和失败都会尽量写 `.meta.json`，方便之后排查一次调用到底发生了什么
- 这条命令当前仍然不内置任何 provider SDK；它只是本地执行桥
- 仓库内提供了一个最小 OpenAI runner：`python3 scripts/openai_runner.py`
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
nodex node cite-chunk <id> <chunk-id>
nodex node uncite-chunk <id> <chunk-id>
nodex node show <id> [--format text|json]
nodex node list [--format tree|json]
```

说明：

- `node add/update/move/delete` 并不是绕过 patch 引擎直接写库，而是走同一套结构化 patch 流程
- `node cite-chunk` / `node uncite-chunk` 是显式 evidence 引用的 convenience command，底层同样走 patch 引擎
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

- 真实 AI 生成 patch
- PDF 导入
- 完整来源与证据视图

所以这版 CLI 的定位是：

> 先把 patch-first 的本地工作区内核跑通
