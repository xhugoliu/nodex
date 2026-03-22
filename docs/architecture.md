# 架构说明

## 目标

Nodex 的长期目标不是“做一个只活在 CLI 里的工具”，而是：

- 先用 CLI 把本地工作区内核跑通
- 再把同一个内核接到 Tauri 图形界面
- 最后再把 AI 导入、拓展、问答能力接进来

所以架构上要坚持：

> 先做稳定内核，再做交互壳

## 当前已经落地的结构

当前仓库虽然还是单二进制项目，但已经有了比较明确的分层：

### `src/main.rs`

命令入口和输出分发。

职责：

- 解析 CLI 参数
- 调用工作区层能力
- 输出人类可读结果

### `src/store.rs`

当前最接近“内核”的部分。

职责：

- 初始化工作区
- 管理 SQLite schema
- 应用 patch
- 保存和恢复快照
- 生成树视图和大纲导出

### `src/patch.rs`

结构化 patch 模型层。

职责：

- 定义 patch 文档结构
- 定义 patch 操作类型
- 生成预览文本
- 为缺失 id 的新增节点自动补全 UUID

### `src/source.rs`

资料导入解析层。

职责：

- 识别当前支持的 source 格式
- 把 Markdown / TXT 解析成初始节点树
- 生成基础 source chunk 草案

### `src/project.rs`

工作区发现与目录布局。

职责：

- 从当前目录向上发现 `.nodex/project.db`
- 统一 `runs/`、`snapshots/`、`sources/`、`exports/` 路径

## 当前架构图

```text
+-------------------+
|      CLI          |
|  command parsing  |
|  human output     |
+---------+---------+
          |
          v
+-------------------+
|    workspace      |
|  init / patch /   |
|  snapshot / export|
+---------+---------+
          |
          v
+-------------------+
|   patch model     |
|  patch document   |
|  patch ops        |
+---------+---------+
          |
          v
+-------------------+
|  local storage    |
|  SQLite + files   |
+-------------------+
```

## 未来建议演化

建议后续按这个方向继续拆：

### `nodex-core`

承载真正的产品内核：

- 节点树模型
- patch 应用
- snapshot
- 导出
- 来源引用

### `nodex-cli`

只负责命令行入口：

- 命令解析
- 文本输出
- JSON 输出

### `nodex-ai`

负责 AI 能力接入：

- 文档导入
- 节点拓展
- 来源问答
- 结构化 patch 生成

### `nodex-app`

负责 Tauri 图形界面：

- 画布
- 大纲
- patch 预览器
- 来源查看器

## 为什么这样拆

因为 Nodex 的长期价值不在“某一种界面”，而在：

- patch-first 的编辑模型
- 本地优先的数据模型
- 可追踪的结构演进

CLI、Tauri、AI runtime 都应该只是这些能力的不同入口。

## 当前还没落地的部分

从当前路线看，真正还没落地的核心部分主要是：

- AI 生成 patch
- 更完整的来源与证据模型
- PDF 导入
- Tauri 图形界面

其中资料导入已经有一版最小实现：

- `md` / `txt` import
- source 文件落盘
- 初始节点树生成
- chunk 级基础关联

所以接下来更适合做的，不是“从零开始做 import”，而是继续把 import、evidence 和 AI patch 往同一套内核边界里收敛。
