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
```

当前这些目录的职责分别是：

- `project.db`：SQLite 主数据库
- `runs/`：归档已经应用过的 patch JSON
- `snapshots/`：归档快照 JSON
- `sources/`：归档导入过的原始资料文件
- `exports/`：导出结果

## 当前数据库表

### `metadata`

保存工作区级元信息。

当前已使用的 key 包括：

- `schema_version`
- `created_at`
- `workspace_name`
- `root_id`

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
- 这种 source-level link 现在既可能来自 `source import`，也可能来自 `attach_source` patch op

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
- 这种 chunk-level link 现在既可能来自 `source import`，也可能来自 `attach_source_chunk` patch op
- 这是一版“基础切片关联”，还不是完整的证据系统

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

当前快照没有纳入：

- `patch_runs`
- 已有 `snapshots` 记录本身

所以快照现在更接近“内容状态快照”：

- 恢复后会回到当时的节点树和 source/chunk/link 关系
- 不会把 patch history 一起回滚
- 也不是“三方合并”

## 未来扩展方向

从产品目标看，后续至少还会加入这些数据：

- 节点与来源的引用关系
- 导出记录
- AI 运行记录

建议未来继续坚持两层存储：

- SQLite：结构化关系、查询、历史索引
- 本地文件：原始导入、快照归档、导出产物
