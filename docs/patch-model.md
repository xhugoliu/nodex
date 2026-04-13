# Patch 模型

## 为什么是 patch-first

Nodex 的编辑边界不是“直接改整张图”，而是“提交一组可预览、可校验、可应用的结构化操作”。

直接收益：

- 先预览再应用
- 保留 patch 历史
- 更适合局部演进
- AI 只需要产出 patch，不接管状态

## 文档结构

当前 patch 是 JSON：

```json
{
  "version": 1,
  "summary": "Optional human summary",
  "ops": []
}
```

- `version` 当前固定为 `1`
- `summary` 可选
- `ops` 按顺序执行

## 当前支持的操作

节点结构：

- `add_node`
- `update_node`
- `move_node`
- `delete_node`

来源关联：

- `attach_source`
- `detach_source`
- `attach_source_chunk`
- `detach_source_chunk`

显式证据：

- `cite_source_chunk`
- `uncite_source_chunk`

## 当前规则

- 根节点不能删除或移动
- `move_node` 不能制造循环
- chunk / citation 相关操作要求目标 source 或 chunk 已存在
- `attach_source_chunk` / `cite_source_chunk` 之前，节点必须已挂到对应 source
- `detach_source` 之前，必须先移除该 source 下的 chunk link 和 citation
- 校验按 `ops` 顺序模拟中间状态，而不是只看起始状态

## 生命周期

patch 可以来自：

- 手写 JSON
- CLI convenience commands
- `source import`
- AI request / response contract

常用流：

```bash
nodex patch inspect <file>
nodex patch apply <file> --dry-run
nodex patch apply <file>
```

## 当前边界

- patch 仍然是 canonical edit boundary
- 高层入口可以多样，但最终应收敛到 patch
- 当前还没有更高层的 intent 取代 canonical patch
