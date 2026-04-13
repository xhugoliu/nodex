# LangChain 最小试点

## 当前定位

LangChain 当前只是一个 external runner 实现，不是新的状态边界。

它必须继续复用：

- `.nodex/ai/*.request.json`
- `.nodex/ai/*.response.json`
- `.nodex/ai/*.meta.json`
- SQLite `ai_runs`
- Rust 侧 patch validate / apply

## 当前脚本

- `python3 scripts/langchain_openai_runner.py`
- `python3 scripts/langchain_anthropic_runner.py`

其中 Anthropic-compatible 路径是当前默认推荐试点主路。

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
- 是否仍停留在 scripts / external runner 层，而不是进入 Rust core
