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
nodex node list [--format tree|json]
```

说明：

- `node add/update/move/delete` 并不是绕过 patch 引擎直接写库，而是走同一套结构化 patch 流程
- `node list --format tree` 返回人类可读树
- `node list --format json` 返回结构化树

### Patch 操作

```text
nodex patch inspect <file>
nodex patch apply <file> [--dry-run]
nodex patch history
```

说明：

- `inspect` 只读 patch 并输出人类可读预览
- `apply --dry-run` 做校验和预览，不修改工作区
- `apply` 会把 patch 文件内容归档到 `./.nodex/runs/`
- `history` 用来查看已经应用过的 patch

### Snapshot 操作

```text
nodex snapshot save [--label ...]
nodex snapshot list
nodex snapshot restore <snapshot-id>
```

说明：

- `save` 会把当前完整状态保存到 `./.nodex/snapshots/`
- `restore` 会在真正恢复前自动保存一份 `auto-before-restore-*` 快照

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

- AI 生成 patch
- 文档导入
- 来源与证据管理

所以这版 CLI 的定位是：

> 先把 patch-first 的本地工作区内核跑通
