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
- `sources/`：预留给后续导入原始资料和切片
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

保存快照时，Nodex 会保存两类内容：

- 所有 `metadata`
- 所有 `nodes`

恢复快照时，会：

1. 先自动保存一个 `auto-before-restore-*` 安全快照
2. 清空当前 `metadata` 和 `nodes`
3. 用目标快照完整重建状态

所以快照现在是“全量恢复”，不是“三方合并”。

## 未来扩展方向

从产品目标看，后续至少还会加入这些数据：

- 来源文件
- 来源切片
- 节点与来源的引用关系
- 导出记录
- AI 运行记录

建议未来继续坚持两层存储：

- SQLite：结构化关系、查询、历史索引
- 本地文件：原始导入、快照归档、导出产物
