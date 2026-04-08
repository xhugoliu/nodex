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
- 调用 provider 调试辅助脚本
- 输出文本和 JSON 两种结果

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

AI request / response 编排层。

职责：

- 在本地组装 `ai expand` / `ai explore` 所需的节点、source 与 evidence 上下文
- 生成 prompt bundle 预览
- 生成可审阅的 patch scaffold
- 定义稳定的 request / response contract，供未来 runtime 对接
- 提供 external runner bridge，把 request / response 文件交给本地命令处理
- 校验外部 response，并把成功 apply 的 patch 继续复用到统一 patch 流程
- 生成 AI run 元数据，并把最小运行索引写进 SQLite
- 当前共享内核不直接内置 provider SDK，但已经支持通过 external runner 间接接入真实模型
- 桌面 draft 默认通过统一 `provider_runner.py` 调度 `codex`，仍可用 `NODEX_DESKTOP_AI_COMMAND` 显式覆盖

### `src/project.rs`

工作区发现与目录布局。

职责：

- 从当前目录向上发现 `.nodex/project.db`
- 统一 `runs/`、`snapshots/`、`sources/`、`exports/`、`ai/` 路径

### `scripts/`

本地 provider 调试工具层。

职责：

- 承载 `openai` / `codex` / `gemini` 的最小 runner
- 提供统一的 `provider_doctor` / `provider_runner` / `provider_smoke` 入口
- 收口 provider config 发现、环境变量冲突诊断、共享 contract 校验与 smoke 参数
- 继续保持 external runner 边界，而不是把 provider SDK 直接塞进 Rust 内核

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
- 也负责为桌面前端暴露 AI expand / explore dry-run draft 入口
- 也负责为桌面前端暴露 AI run 相关读取入口：
  - 最近运行记录
  - 单条 run 的 explanation / patch / request / response / metadata 汇总读取
  - patch 草案回放
  - run 与 run 的差异对比
  - request / response / metadata 工件查看
- desktop 默认 AI draft route 会走统一 `provider_runner.py --provider codex --use-default-args`
  - 对当前 codex provider entry 来说，这意味着模型仍跟随本机 Codex 配置，但 reasoning effort 会固定为 `low`
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
- 负责把 AI expand / explore 结果作为 patch 草案载入编辑器
- 负责在 patch 编辑器里展示当前草案是否来自某次 AI run
- 负责让 patch 编辑器和 Run Inspector 互相回跳，而不是把审计链路和草案链路割裂开
- 负责在节点详情里提供 Run Inspector：
  - 选中某条 AI run 后直接查看 explanation、patch、request / response / metadata
  - explanation 里的 direct evidence 可继续跳到对应 source chunk
  - 在同一处触发 replay dry-run
  - 在同一处比较两条 run 的差异，并把 compare 两侧的 patch 重新送回 patch 编辑器
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

## 表达层分层方向

在当前共享内核之外，Nodex 还保留一条明确的长期演化方向：

> 多种高层入口，一种低层统一内核。

这里的意思不是新增一套绕开 patch 的执行路径，而是把“如何表达修改意图”和“系统最终如何执行修改”分层。

建议长期收敛成三层：

### Intent Layer

面向：

- 用户
- GUI
- CLI convenience commands
- 未来 AI / agent

职责：

- 表达“想做什么”
- 尽量减少对底层 `node_id`、原始 patch JSON 的直接暴露
- 允许更贴近交互语义的动作，例如：
  - `add_subtree`
  - `expand_node`
  - `support_node_with_source`
  - `import_source_as_outline`

当前状态：

- 仓库里还没有一套通用、显式落盘的 Intent Document / Intent Compiler
- 但已经有一些“高层动作 -> 内层 patch”的雏形：
  - `node add/update/move/delete`
  - `source import`
  - desktop 中的 draft / preview / apply 入口

### Canonical Patch Layer

面向：

- 内核校验
- 执行
- patch history
- 审计归档

职责：

- 表达“系统实际怎么改”
- 作为唯一统一的执行格式
- 保持 patch-first

当前约束：

- 继续以当前 primitive patch 作为 canonical patch
- `version = 1` patch 仍然是当前真实执行和归档边界
- 即使未来引入 Intent Layer，也应该先编译到 canonical patch，再复用现有 validate / apply / archive 流程

### State Layer

面向：

- 本地工作区持久化
- 查询
- 恢复

职责：

- 保存当前状态
- 保存 patch history
- 保存 snapshots
- 保存 source / chunk / evidence 相关关系
- 保存 AI run 最小索引，并和本地 request / response / metadata 工件形成双层审计边界

当前约束：

- 继续保持 SQLite + 本地文件的 local-first 存储模型
- 继续保留 `ai_runs` + `.nodex/ai/*.json` 这类“结构化索引 + 原始工件”分层
- 不因为未来引入更高层表达，就改变当前 state layer 的基础职责

## 推荐链路

长期更适合的表达链路是：

```text
User / GUI / CLI / AI
          |
          v
    Intent Layer
          |
          v
Intent Resolver / Compiler
          |
          v
 Canonical Patch Layer
          |
          v
 validate + apply
          |
          +--> current workspace state
          +--> patch history
          +--> snapshots / exports / audits
```

这条链路当前还没有完整实现，但它描述了一个重要边界：

- 高层入口可以继续增加
- 底层执行路径不应该分叉

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

如果未来进一步引入 Intent Layer，也应继续保持：

- Intent：负责表达自然
- Canonical Patch：负责执行稳定
- State：负责 local-first 持久化

CLI、Tauri、AI runtime 都应该只是这些能力的不同入口。

## 当前还没落地的部分

从当前路线看，真正还没落地的核心部分主要是：

- 更完整的 AI 能力：来源问答 / 结果比较与解释 / 更稳定的 explore 策略
- 更完整的来源与证据模型
- PDF 导入
- 完整脑图式 Tauri 图形界面
- 通用 Intent Layer / selector resolver / authored intent history

当前已经有一层最小 AI dry-run 骨架：

- `nodex ai expand <node-id> --dry-run`
- `nodex ai explore <node-id> --by ... --dry-run`
- 本地 prompt bundle 预览
- 本地 patch scaffold 预览
- request bundle 导出与 response contract 回放
- `ai run-external` 本地执行桥
- desktop 中的 AI expand / explore draft 入口

当前也有一版开发用 provider runner：

- `scripts/openai_runner.py`
- `scripts/codex_runner.py`
- `scripts/gemini_runner.py`
- `scripts/provider_doctor.py`
- `scripts/provider_runner.py`
- `scripts/provider_smoke.py`
- 继续通过 external runner bridge 接入，而不是把 provider SDK 写进 Rust 内核
- `.nodex/ai/*.meta.json` 保存本地运行审计信息，便于排查 provider 调用过程

短期更适合继续补的，不是把 provider SDK 直接塞进共享内核，而是把这条真实 provider 路径的配置、状态、失败反馈和 apply 链路做得更可见、更顺手。

同理，短期更适合做的也不是直接发起一轮大规模“Intent Layer 重构”，而是先继续验证：

- 哪些高层动作真的值得从 patch 中抽出来
- 哪些 selector / 临时句柄能明显降低 GUI / AI authoring 成本
- 哪些历史字段值得同时保留 intent 和 compiled patch

其中资料导入已经有一版最小实现：

- `md` / `txt` import
- source 文件落盘
- 初始节点树生成
- chunk 级基础关联

目前已经有一层最小桌面壳，所以接下来更适合做的，不是“先把 GUI 做大”，而是让 GUI 继续薄、内核继续稳，并把 AI patch 能力接到同一套边界上。
