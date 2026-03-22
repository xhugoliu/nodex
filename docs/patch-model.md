# Patch 模型

本文描述 Nodex 当前的结构化 patch 模型，以及后续扩展的方向。

## 为什么要 patch-first

Nodex 的编辑核心不是“直接替换整张图”，而是“对现有结构提交一组可审查的操作”。

这个模型有几个直接好处：

- 可以先预览，再应用
- 可以把每次修改记成历史
- 可以围绕局部节点迭代，而不是总是重写整张图
- 后续更容易接入 AI，因为模型只需要生成 patch，而不是接管整个状态

## Patch 文档结构

当前 patch 文件是一个 JSON 文档：

```json
{
  "version": 1,
  "summary": "Expand the root topic into three first-level branches",
  "ops": [
    {
      "type": "add_node",
      "parent_id": "root",
      "title": "Problem",
      "kind": "topic",
      "body": "What are we trying to understand or solve?"
    }
  ]
}
```

字段说明：

- `version`：patch 版本，目前固定为 `1`
- `summary`：可选的人类可读摘要
- `ops`：结构化操作列表，按顺序执行

## 当前支持的操作

### `add_node`

```json
{
  "type": "add_node",
  "id": "optional-id",
  "parent_id": "root",
  "title": "Problem",
  "kind": "topic",
  "body": "Optional text",
  "position": 0
}
```

说明：

- `id` 可省略；省略时由系统自动生成 UUID
- `parent_id` 必填，且必须存在
- `kind` 可省略；省略时默认为 `topic`
- `position` 可省略；省略时自动追加到父节点末尾

### `update_node`

```json
{
  "type": "update_node",
  "id": "node-id",
  "title": "New title",
  "body": "New body",
  "kind": "question"
}
```

说明：

- 至少要提供一个要修改的字段
- 当前支持更新 `title`、`body`、`kind`

### `move_node`

```json
{
  "type": "move_node",
  "id": "node-id",
  "parent_id": "new-parent-id",
  "position": 1
}
```

说明：

- 不能把节点移动到自己下面
- 不能制造循环引用
- 不能移动根节点

### `delete_node`

```json
{
  "type": "delete_node",
  "id": "node-id"
}
```

说明：

- 删除节点时会一并删除它的后代
- 不能删除根节点

## Patch 生命周期

### 1. 编写或生成 patch

patch 可以来自：

- 手写 JSON
- CLI convenience commands，例如 `nodex node add`
- 未来的 AI 结构化输出

### 2. 预览

使用：

```bash
nodex patch inspect <file>
nodex patch apply <file> --dry-run
```

两者差异：

- `inspect`：只解释 patch 内容
- `apply --dry-run`：除了预览，还会走完整校验流程

### 3. 校验

当前会校验：

- `version` 是否支持
- `ops` 是否为空
- 目标节点或父节点是否存在
- `position` 是否合法
- 根节点是否被非法移动或删除
- `move_node` 是否会产生环

当前还有一个重要边界：

- 校验是基于 apply 前的工作区状态进行的
- 不会模拟同一份 patch 里前序 op 带来的临时结果
- 这意味着后续 op 目前不能引用同一 patch 里刚 `add_node` 出来的新节点

### 4. 应用

真正应用时：

- patch 会先做 `resolved`，为缺失 `id` 的 `add_node` 自动补 UUID
- patch 原文会归档到 `./.nodex/runs/`
- patch 元信息会写入 `patch_runs` 表
- 节点状态会更新到 SQLite

## 当前限制

这版 patch 模型还比较小，只覆盖了“结构编辑”。

还没有纳入 patch 的内容包括：

- 来源关联
- 证据节点与来源切片绑定
- 节点合并
- 节点拆分
- 批量重排
- 跨图引用

此外，当前 multi-op patch 虽然支持多个操作顺序执行，但校验阶段仍然要求每个 op 的目标都已经存在于 apply 前的工作区里。

## 下一步扩展建议

后续可以在不破坏 `version = 1` 的情况下逐步扩展新操作，例如：

- `attach_source`
- `merge_nodes`
- `split_node`
- `set_node_meta`
- `reorder_children`

如果后面 patch 语义出现明显不兼容变化，再引入 `version = 2`。
