# 数据模型

## 工作区目录

当前工作区根目录下会有：

```text
.nodex/
  project.db
  runs/
  snapshots/
  sources/
  exports/
  ai/
```

- `project.db`：SQLite 主库
- `runs/`：已应用 patch 归档
- `snapshots/`：快照归档
- `sources/`：导入原始资料
- `exports/`：导出结果
- `ai/`：AI request / response / metadata 工件

## 当前 SQLite 表

- `metadata`
  工作区元信息；当前 `schema_version` 为 `5`
- `nodes`
  当前脑图状态
- `patch_runs`
  已应用 patch 历史
- `snapshots`
  完整快照记录
- `ai_runs`
  AI 运行索引；当前也保留 runner fallback 标记与 normalization note 摘要
- `sources`
  导入来源文件
- `node_sources`
  节点到 source 的关联
- `source_chunks`
  source 切片
- `node_source_chunks`
  节点到 chunk 的一般关联
- `node_evidence_chunks`
  节点到 chunk 的显式 evidence citation

## 当前语义

- 只有一个根节点
- `nodes.position` 表示同级顺序
- `node_source_chunks` 和 `node_evidence_chunks` 分开保存
  目的：区分“一般来源关联”和“显式证据引用”
- `citation_kind` 当前最小区分：
  - `direct`
  - `inferred`

## 快照

当前 snapshot 保存的是完整状态，不是增量 patch。

恢复 snapshot 时会先自动保存一份 `auto-before-restore-*` 安全快照。

## AI 工件

`.nodex/ai/` 当前保存：

- `*.request.json`
- `*.response.json`
- `*.meta.json`

SQLite `ai_runs` 只保存最小索引和关键路径，不代替这些工件文件。
但当前 `ai_runs` 也会索引：

- runner retry / error 分类
- `used_plain_json_fallback`
- `normalization_notes`
