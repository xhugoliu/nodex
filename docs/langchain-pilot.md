# LangChain 核心路线

## 当前定位

LangChain 已经从“可选试点”切到“当前默认 AI runtime / orchestration 主路”，并按正式核心能力方向推进。

当前还没有变化的是：

- 它仍然复用现有 external runner 边界
- 它还没有直接进入 Rust core 或 SQLite schema
- 它仍然必须服从 patch-first、local-first 和本地审计约束

它必须继续复用：

- `.nodex/ai/*.request.json`
- `.nodex/ai/*.response.json`
- `.nodex/ai/*.meta.json`
- SQLite `ai_runs`
- Rust 侧 patch validate / apply

## 当前脚本

- `python3 scripts/langchain_runner_common.py`
- `python3 scripts/langchain_openai_runner.py`
- `python3 scripts/langchain_anthropic_runner.py`

其中 Anthropic-compatible 路径是当前默认推荐主路。
两个 LangChain runner 现在共享一层 repo 内部的 output-handling helper，用来收口：

- structured output normalize
- plain JSON fallback
- contract response completion
- expand / explore patch normalization
- runner metadata 中的 fallback / normalization 标记

Anthropic-specific 的质量约束仍保留在 `langchain_anthropic_runner.py`，不把默认主路经验硬塞进所有 provider。
这些标记现在也已经进入 `provider_smoke.py` / `runner_compare.py` 的 quality summary / runner metrics，并进入本地 `ai_runs` 索引与 `ai show` / `ai compare` 读取链路，不再只留在 sidecar `*.meta.json` 里。

## 最小使用方式

```bash
cargo run -- ai doctor --provider anthropic --format json
cargo run -- ai smoke --provider anthropic --format json
cargo run -- ai run-external root "python3 scripts/langchain_anthropic_runner.py" --dry-run
```

如果只想做 runner 对照：

```bash
python3 scripts/runner_compare.py --preset langchain-pilot --json
python3 scripts/runner_compare.py --preset langchain-pilot --scenario source-root --json
```

## 继续推进的判断标准

- 是否继续强化 patch-first
- 是否继续保留本地审计边界
- 是否比当前最小 runner 更可控、更可解释或更稳定
- 是否在不破坏当前边界的前提下，把更多共享编排能力从“脚本级默认路径”推进到“正式核心能力”

## 下一轮更值得补的回归

当前已经补上的脚本级回归：

- `load_anthropic_context` / `load_openai_context` 的配置发现优先级
- OpenAI / Anthropic runner-entry 的 plain-JSON fallback metadata
- OpenAI invoke 路径的 no-broad-fallback 错误分类约束
- smoke / compare summary 对 fallback / normalization metadata 的透传
- `ai compare` 对 fallback / normalization metadata 一致性的直接摘要

下一轮更值得补的仍然是：

- `runner_compare.py` 在 `source-root` / `source-context` 上更贴近真实 LangChain preset 的 compare 回归
- compare 输出继续往真实 LangChain preset 的失败 / 差异归因收口，而不只停在 metadata 层
