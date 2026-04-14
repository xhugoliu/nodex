# 路线图

## 当前判断

项目已经不再是“只有 CLI 的原型”，而是：

- CLI 内核已站住
- source import 已有最小落地
- AI patch 已有 external runner 闭环
- LangChain 已从“可选试点”切到“当前默认 AI 主路与核心能力方向”
- 来源与证据已有最小语义
- 桌面端已验证可复用共享内核，但仍是过渡性壳层

当前长期问题仍然是：

> patch-first 的本地工作区模型是否足够支撑 GUI、AI 和来源链路

## 阶段

### 1. CLI 内核

- 工作区初始化
- 节点编辑
- patch 应用
- snapshot
- outline 导出

### 2. 资料导入

- Markdown / TXT 导入
- 初始节点树
- source / chunk 基础关联

### 3. AI 生成 patch

- `ai expand` / `ai explore`
- request / response contract
- LangChain 主路 + external runner
- AI run 审计

### 4. 来源与证据

- source link
- chunk link
- evidence citation
- `direct` / `inferred` + rationale

### 5. 桌面端

- Tauri 命令桥
- 过渡性 workbench
- 纯画布 + 节点作用域的 assistant workspace

## 当前优先级

长期路线里，当前最重要的是先把桌面端的信息架构和主路径收口，再让 LangChain 主路为这条桌面默认 draft route 服务：

- 把桌面三栏主路径做顺、做稳、做得更可回归
- 把右栏做成 node-scoped assistant workspace，而不是底层调试台或聊天主界面
- 把 LangChain 主路继续作为桌面默认 AI draft route 的支撑能力推进，而不是继续优先扩独立的调试表面

具体切口看 [短期执行清单](./next-steps.md)。

## 暂缓

- PDF import
- 重型 evidence 视图
- 通用 Intent Layer 大重构
- 桌面主舞台上的 AI runs / Activity / Run Inspector 回填
