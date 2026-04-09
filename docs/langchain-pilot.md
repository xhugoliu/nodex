# LangChain 最小试点

这份文档描述 Nodex 当前这轮 LangChain 试点的真实边界。

它当前表达的是：

> LangChain 已经开始作为一个最小外部 runtime 接入，并且当前默认推荐试点主路优先是 Anthropic-compatible 路径。

## 试点目标

这轮试点只验证三件事：

- LangChain 能否稳定消费现有 `nodex_ai_*` request contract
- LangChain 能否继续产出可校验的 canonical patch response
- LangChain 路径是否值得进入后续真实 provider 对比与回归

当前不验证这些事：

- 不把 Rust 内核改成直接依赖 LangChain
- 不把 LangChain 直接提升成新的 SQLite / patch / history 边界
- 不在这轮试点里展开多步 agent / intent compiler 重构

## 试点边界

当前 LangChain 试点严格复用已有边界：

- 请求输入仍然是 `.nodex/ai/*.request.json`
- 返回结果仍然必须满足 `nodex_ai_patch_response`
- 最终写入工作区时，仍然复用 Rust 侧 canonical patch validate / apply / archive
- 本地审计仍然写回：
  - `.nodex/ai/*.response.json`
  - `.nodex/ai/*.meta.json`
  - SQLite `ai_runs`

换句话说，LangChain 在这轮里只是：

> 一个可替换的 external runner 实现

而不是新的状态核心。

## 当前脚本

当前仓库里的最小试点脚本有两条：

- `python3 scripts/langchain_openai_runner.py`
- `python3 scripts/langchain_anthropic_runner.py`

它们当前的定位是：

- 基于 `langchain-openai` 或 `langchain-anthropic`
- 复用现有 `OPENAI_*` 或 `ANTHROPIC_*` / `API_TIMEOUT_MS` 环境变量
- 通过 LangChain 的 structured output 路径返回 Nodex contract JSON
- 仍然由 `nodex ai run-external` 驱动

当前已经接进这些默认入口：

- `nodex ai doctor --provider anthropic`
- `nodex ai status --provider anthropic`
- `nodex ai providers`
- `nodex ai smoke --provider anthropic`
- desktop 默认 draft route

## 安装

LangChain 试点当前不额外改仓库级 Python 依赖管理，按需本机安装即可：

```bash
python3 -m pip install -U langchain-openai
python3 -m pip install -U langchain-anthropic
```

OpenAI 版本默认复用现有 OpenAI 配置：

```bash
cp .env.example .env.local
# 编辑 .env.local，填入 OPENAI_API_KEY
```

Anthropic-compatible 版本则可直接吃这类配置：

```bash
cp .env.example .env.local
# 编辑 .env.local，填入：
# ANTHROPIC_AUTH_TOKEN=...
# ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
# ANTHROPIC_MODEL=glm-5.1
```

## 最小运行方式

先准备一个本地 workspace：

```bash
cargo run -- init
```

然后走现有 external runner 边界：

```bash
cargo run -- ai run-external root "python3 scripts/langchain_openai_runner.py" --dry-run
cargo run -- ai run-external root "python3 scripts/langchain_anthropic_runner.py" --dry-run
```

如果你想直接走当前默认推荐试点主路，也可以优先使用：

```bash
cargo run -- ai doctor --provider anthropic --format json
cargo run -- ai smoke --provider anthropic --format json
```

如果你想看这次运行的审计工件：

```bash
cargo run -- ai history
cargo run -- ai show <run-id>
cargo run -- ai artifact <run-id> --kind request
cargo run -- ai artifact <run-id> --kind response
```

如果你想和当前最小 OpenAI runner 对比，可以各跑一轮再比较：

```bash
cargo run -- ai run-external root "python3 scripts/openai_runner.py" --dry-run
cargo run -- ai run-external root "python3 scripts/langchain_openai_runner.py" --dry-run
cargo run -- ai compare <left-run-id> <right-run-id>
```

如果你想在国产 Anthropic-compatible 路径上验证 LangChain，也可以单独跑：

```bash
cargo run -- ai run-external root "python3 scripts/langchain_anthropic_runner.py" --dry-run
```

如果你想把这条对照流程直接收成一次统一执行，也可以使用：

```bash
python3 scripts/runner_compare.py --preset langchain-pilot
python3 scripts/runner_compare.py --preset langchain-pilot --json
```

这条脚本会：

- 在临时 workspace 里初始化 Nodex
- 对同一个节点依次运行多条 external runner 命令
- 自动收集每条运行的 `run-id`
- 自动读取 `ai show`
- 对成功的运行自动做两两 `ai compare`

如果你只想比较两条显式 runner，也可以手动指定：

```bash
python3 scripts/runner_compare.py \
  --runner 'openai=python3 scripts/openai_runner.py' \
  --runner 'langchain-openai=python3 scripts/langchain_openai_runner.py'
```

## 当前判断标准

这轮试点是否值得继续推进，优先看这些问题：

1. 它是否仍然强化 patch-first，而不是绕开 patch-first
2. 它是否继续保留本地 request / response / history 审计边界
3. 它是否在真实 provider 路径上带来更好的可控性、可解释性或可维护性
4. 它是否只是外部 runtime 的实现改进，而不是把复杂度过早塞回内核
