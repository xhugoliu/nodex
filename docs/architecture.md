# 架构说明

## 目标

Nodex 的长期目标不是“做一个只活在 CLI 里的工具”，而是：

- 先用 CLI 把本地工作区内核跑通
- 再把同一个内核接到 Tauri 图形界面
- 最后再把 AI 导入、拓展、问答能力接进来

所以架构上要坚持：

> 先做稳定内核，再做交互壳

## 当前已经落地的结构

当前仓库已经从单一 CLI 二进制，演化成“共享内核 + CLI + 最小桌面壳”的结构：

### `src/lib.rs`

共享内核入口。

职责：

- 暴露 `ai / model / patch / project / source / store` 给 CLI 和桌面壳复用

### `src/main.rs`

CLI 命令入口和输出分发。

职责：

- 解析 CLI 参数
- 调用共享内核
- 输出人类可读结果

### `src/store.rs`

共享工作区内核入口。

职责：

- 初始化工作区
- 管理 SQLite schema
- 汇总 `store` 子模块

当前 `store` 已进一步按职责拆到：

- `src/store/patching.rs`
- `src/store/queries.rs`
- `src/store/source_import.rs`
- `src/store/snapshots.rs`

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

### `src/ai.rs`

AI dry-run 预览层。

职责：

- 在本地组装 `ai expand` 所需的节点、source 与 evidence 上下文
- 生成 prompt bundle 预览
- 生成可审阅的 patch scaffold
- 定义稳定的 request / response contract，供未来 runtime 对接
- 提供 external runner bridge，把 request / response 文件交给本地命令处理
- 当前不负责真实模型调用

### `src/project.rs`

工作区发现与目录布局。

职责：

- 从当前目录向上发现 `.nodex/project.db`
- 统一 `runs/`、`snapshots/`、`sources/`、`exports/` 路径

### `desktop/src-tauri`

最小 Tauri 桌面壳后端。

职责：

- 暴露桌面命令给前端调用
- 复用 `nodex` 共享内核
- 负责 Tauri app 配置与窗口生命周期
- 维护原生 app menu，而不是把菜单逻辑放在前端模拟
- 把低频桌面动作映射成原生菜单事件：
  - 打开文件夹并自动“打开或初始化工作区”
  - source import preview / import
  - snapshot 保存 / 恢复
  - 历史 patch 载入
  - 语言切换
- 把菜单动作和工作区状态变化通过事件发回前端

### `desktop/src`

最小桌面壳前端，当前用 `React + Vite + TypeScript + Tailwind CSS` 组织。

职责：

- 维持单屏、薄壳的桌面工作台
- 提供三块核心区域：
  - 左栏：树视图
  - 中栏：详情摘要与底部控制台
  - 右栏：统一节点编辑器与 patch 编辑器
- 负责把节点编辑动作起草为 patch
- 负责 patch 预览与应用
- 监听原生菜单事件并更新页面状态
- 不再把所有低频入口都堆在页面里

### `desktop/index.html` + `desktop/vite.config.ts`

桌面前端入口与构建编排。

职责：

- 提供 Vite 入口页
- 管理前端开发服务器与生产构建
- 把 Tauri dev/build 接到前端产物

## 当前架构图

```text
+-------------------+      +----------------------------+
|      CLI          |      |       Tauri Shell          |
| command parsing   |      | native menu + thin UI      |
| human output      |      | desktop commands + events  |
+---------+---------+      +-------------+--------------+
          \                               /
           \                             /
            v                           v
           +-----------------------------+
           |         shared core         |
           | ai / model / patch / store  |
           | source / project            |
           +--------------+--------------+
                          |
                          v
           +-----------------------------+
           |        local storage        |
           |        SQLite + files       |
           +-----------------------------+
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

- 真实 AI 生成 patch
- 更完整的来源与证据模型
- PDF 导入
- 完整脑图式 Tauri 图形界面

当前已经有一层最小 AI dry-run 骨架：

- `nodex ai expand <node-id> --dry-run`
- 本地 prompt bundle 预览
- 本地 patch scaffold 预览
- request bundle 导出与 response contract 回放
- `ai run-external` 本地执行桥

当前也有一版开发用 provider runner：

- `scripts/openai_runner.py`
- 继续通过 external runner bridge 接入，而不是把 provider SDK 写进 Rust 内核
- `.nodex/ai/*.meta.json` 保存本地运行审计信息，便于排查 provider 调用过程

其中资料导入已经有一版最小实现：

- `md` / `txt` import
- source 文件落盘
- 初始节点树生成
- chunk 级基础关联

目前已经有一层最小桌面壳，所以接下来更适合做的，不是“先把 GUI 做大”，而是让 GUI 继续薄、内核继续稳，并把 AI patch 能力接到同一套边界上。
