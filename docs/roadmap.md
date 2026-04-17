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

## 下一阶段开发方向

在当前阶段判断下，后续更值得继续投入的方向主要有 6 类：

### 1. 桌面三栏主路径收口

- 核心目标不是再扩工作台，而是把三栏职责压实
- 中栏继续固定为画布主舞台
- 右栏继续收紧为 node-scoped assistant workspace
- 左栏保持轻导航和 source/browser 的最小职责

### 2. 默认 AI draft route 稳定化

- LangChain + external runner 继续作为默认 AI 主路
- 更值得补的是失败分类、凭据诊断、重试提示、provider smoke 和真实默认路径验证
- 目标是把默认 draft route 做稳，而不是扩更多平行 AI 表面

### 3. Patch review 体验升级

- patch-first 的价值不只在底层校验，也在用户是否能看懂 review
- 后续可以继续加强 patch inspect / apply 的摘要、影响范围、evidence 变化和 focus 落点解释
- 这类工作应该继续服务 patch confirm 层，而不是绕开 patch

### 4. Source / Evidence 工作流加强

- 继续把来源阅读、显式取证和节点拓展收成一条连续工作流
- 优先补强 `source detail -> node context -> cite/uncite -> Draft -> Review -> apply`
- 重点是让来源信息更能解释“为什么值得看”，而不只是列 chunk

### 5. 历史与恢复能力产品化

- snapshot、patch history、AI replay 已有底层能力
- 后续更值得做的是轻量、次级、可解释的恢复入口
- 这类入口应继续保持辅助性质，不抢画布和节点工作流主舞台

### 6. 回归与稳定性体系继续加厚

- 这个项目的核心风险不只在功能缺失，也在多链路回归失真
- 所以桌面 flow smoke、provider smoke、runner compare 和桌面逻辑测试应继续被当作主线工作
- 目标是让桌面默认路径、AI runner 路径和 patch-first 主路径都更可回归

这些方向之间的推荐顺序是：

1. 先收口桌面三栏主路径
2. 再稳定默认 AI draft route
3. 然后提升 patch review 可读性
4. 再补强 source / evidence 连续工作流
5. 再把历史与恢复入口做轻、做好用
6. 回归与稳定性体系作为全程持续项并行推进

## 暂缓

- PDF import
- 重型 evidence 视图
- 通用 Intent Layer 大重构
- 桌面主舞台上的 AI runs / Activity / Run Inspector 回填
