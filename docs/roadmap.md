# 路线图

## 当前判断

项目已经不再是“只有 CLI 的原型”，而是：

- CLI 内核已站住
- source import 已有最小落地
- AI patch 已有 external runner 闭环
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
- external runner
- AI run 审计

### 4. 来源与证据

- source link
- chunk link
- evidence citation
- `direct` / `inferred` + rationale

### 5. 桌面端

- Tauri 命令桥
- 过渡性 workbench
- 纯画布 + `Context / Review`

## 当前优先级

长期路线里，当前最重要的不是再开新阶段，而是把桌面主路径做顺、做稳、做得更可回归。具体切口看 [短期执行清单](./next-steps.md)。

## 暂缓

- PDF import
- 重型 evidence 视图
- 通用 Intent Layer 大重构
- 桌面主舞台上的 AI runs / Activity / Run Inspector 回填
