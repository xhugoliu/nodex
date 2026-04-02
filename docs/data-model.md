# 数据模型

本文描述 Nodex 当前已经落地的本地工作区模型，而不是未来完整产品的所有数据。

## 工作区目录

初始化后，Nodex 会在项目根目录创建：

```text
.nodex/
  project.db
  runs/
  snapshots/
  sources/
  exports/
  ai/
```

当前这些目录的职责分别是：

- `project.db`：SQLite 主数据库
- `runs/`：归档已经应用过的 patch JSON
- `snapshots/`：归档快照 JSON
- `sources/`：归档导入过的原始资料文件
- `exports/`：导出结果
- `ai/`：归档 AI 运行过程中的 request / response / `.meta.json`

## 当前数据库表

### `metadata`

保存工作区级元信息。

当前已使用的 key 包括：

- `schema_version`
- `created_at`
- `workspace_name`
- `root_id`

当前 schema version 为 `3`。

### `nodes`

保存当前脑图状态。

字段：

- `id`
- `parent_id`
- `title`
- `body`
- `kind`
- `position`
- `created_at`
- `updated_at`

语义说明：

- `id` 是节点主键
- `parent_id` 为 `NULL` 的节点是根节点
- `position` 表示同级排序
- 当前只有一个根节点，默认 id 为 `root`

### `patch_runs`

保存已经应用的 patch 记录。

字段：

- `id`
- `summary`
- `origin`
- `patch_json`
- `file_name`
- `applied_at`

当前用途：

- 查看 patch 历史
- 记录 CLI convenience commands 和 `source import` 这类内部生成的结构化修改
- 将来接 AI 后保留每次模型修改提案

### `snapshots`

保存完整快照记录。

字段：

- `id`
- `label`
- `state_json`
- `file_name`
- `created_at`

快照当前存的是“完整状态”，不是增量 patch。

### `ai_runs`

保存 AI 运行的最小索引记录。

字段：

- `id`
- `capability`
- `explore_by`
- `node_id`
- `command`
- `dry_run`
- `status`
- `started_at`
- `finished_at`
- `request_path`
- `response_path`
- `exit_code`
- `provider`
- `model`
- `provider_run_id`
- `retry_count`
- `last_error_category`
- `last_error_message`
- `last_status_code`
- `patch_run_id`
- `patch_summary`

当前用途：

- 查询某个节点最近跑过哪些 AI draft
- 查看哪次成功、哪次失败
- 查看失败原因和最后一次错误分类
- 查看哪次最终落成了 patch run

### `sources`

保存导入过的来源文件记录。

字段：

- `id`
- `original_path`
- `original_name`
- `stored_name`
- `format`
- `imported_at`

当前用途：

- 记录来源文件已经被纳入工作区
- 让 CLI 能列出已导入来源
- 为后续来源切片和证据关联打基础

### `node_sources`

保存节点与来源文件的关联关系。

字段：

- `node_id`
- `source_id`

当前语义比较简单：

- 一次 `source import` 生成的节点都会挂到对应来源上
- 这种 source-level link 现在既可能来自 `source import`，也可能来自 `attach_source` / `detach_source` patch op

### `source_chunks`

保存来源文件切片。

字段：

- `id`
- `source_id`
- `ordinal`
- `label`
- `text`
- `start_line`
- `end_line`

当前语义：

- 切片在 `source import` 时自动生成
- `markdown` 导入默认按标题正文或段落生成切片
- `text` 导入默认按段落生成切片

### `node_source_chunks`

保存节点与来源切片的关联关系。

字段：

- `node_id`
- `chunk_id`

当前语义：

- 导入时，生成的节点会关联到对应的来源切片
- 这种 chunk-level link 现在既可能来自 `source import`，也可能来自 `attach_source_chunk` / `detach_source_chunk` patch op
- 这是一版“基础切片关联”，主要表达结构生成或一般性关联，不等于显式 evidence 引用

### `node_evidence_chunks`

保存节点对来源切片的显式 evidence 引用关系。

字段：

- `node_id`
- `chunk_id`
- `citation_kind`
- `rationale`

当前语义：

- 这层关系来自 `cite_source_chunk` / `uncite_source_chunk` patch op
- 它和 `node_source_chunks` 分离，避免把“导入生成时的来源关联”和“后续显式引用为证据”混在一起
- `citation_kind` 当前最小区分为：
  - `direct`
  - `inferred`
- `rationale` 用来表达“为什么引用这个 chunk”
- 当前还没有保存 quote span、摘录片段等更细粒度信息

## 当前节点类型

代码层面目前没有把 `kind` 限死成枚举，而是保留为字符串。

这意味着当前既支持：

- `topic`
- `question`
- `action`
- `evidence`

也支持你临时试验新的类型名。

这样做的好处是：

- 早期探索阶段更灵活
- 不需要频繁改 schema

代价是：

- 需要后续再定义稳定的类型集合和渲染语义

## 当前快照策略

保存快照时，Nodex 会保存这些内容：

- 所有 `metadata`
- 所有 `nodes`
- 所有 `sources`
- 所有 `node_sources`
- 所有 `source_chunks`
- 所有 `node_source_chunks`
- 所有 `node_evidence_chunks`

恢复快照时，会：

1. 先自动保存一个 `auto-before-restore-*` 安全快照
2. 清空当前内容状态相关数据
3. 用目标快照完整重建 `metadata`、`nodes`、`sources` 以及基础来源关联

当前“内容状态相关数据”包括：

- `metadata`
- `nodes`
- `sources`
- `node_sources`
- `source_chunks`
- `node_source_chunks`
- `node_evidence_chunks`

当前快照没有纳入：

- `patch_runs`
- 已有 `snapshots` 记录本身
- `.nodex/ai/` 下的 AI 运行文件

所以快照现在更接近“内容状态快照”：

- 恢复后会回到当时的节点树和 source/chunk/link 关系
- 不会把 patch history 一起回滚
- 也不是“三方合并”

## 未来扩展方向

从产品目标看，后续至少还会加入这些数据：

- 更完整的节点与来源引用关系
- 导出记录
- 更完整的 AI 运行记录索引

## 当前 AI 运行文件

当前 AI 运行记录还没有进 SQLite 表，而是先以本地文件形式保存到：

```text
.nodex/ai/
  <run-id>.request.json
  <run-id>.response.json
  <run-id>.meta.json
```

当前语义：

- `request.json`：一次 AI draft 请求的上下文与 contract，当前可能来自 `expand` 或 `explore`
- `response.json`：外部 runner 或 provider 返回的结构化 response
- `meta.json`：本地运行审计信息，例如 provider、model、provider run id、retry 次数、最后一次错误分类、patch run id

当前这些 AI 文件不会写入 snapshot，也还不属于 SQLite schema 的一部分。

建议未来继续坚持两层存储：

- SQLite：结构化关系、查询、历史索引
- 本地文件：原始导入、快照归档、导出产物
