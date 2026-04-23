set positional-arguments

help:
    just -l

provider-doctor:
    python3 scripts/provider_doctor.py

provider-doctor-json:
    python3 scripts/provider_doctor.py --json

provider-smoke provider extra="":
    python3 scripts/provider_smoke.py --provider {{provider}} {{extra}}

run *args:
    cargo run -- "$@"

fmt:
    cargo fmt

check:
    cargo check

test:
    cargo test

default-path-gate:
    cargo fmt --check
    cargo test
    cd desktop && npm run default-path-gate

desktop-check:
    cargo check --manifest-path desktop/src-tauri/Cargo.toml

desktop-dev:
    cd desktop && npm run dev

ai-openai node_id="root":
    cargo run -- ai run-external {{node_id}} "python3 scripts/openai_runner.py" --dry-run

ai-gemini node_id="root":
    cargo run -- ai run-external {{node_id}} "python3 scripts/gemini_runner.py" --dry-run

ai-provider provider node_id="root" extra="":
    cargo run -- ai run-external {{node_id}} "python3 scripts/provider_runner.py --provider {{provider}} {{extra}}" --dry-run

openai-doctor:
    python3 scripts/openai_doctor.py

openai-doctor-json:
    python3 scripts/openai_doctor.py --json

gemini-doctor:
    python3 scripts/gemini_doctor.py

gemini-doctor-json:
    python3 scripts/gemini_doctor.py --json

codex-doctor:
    python3 scripts/codex_doctor.py

codex-doctor-json:
    python3 scripts/codex_doctor.py --json

ai-codex node_id="root" effort="low" retries="3":
    cargo run -- ai run-external {{node_id}} "python3 scripts/codex_runner.py --mode plain --reasoning-effort {{effort}} --max-retries {{retries}}" --dry-run

ai-codex-apply node_id="root" effort="low" retries="3":
    cargo run -- ai run-external {{node_id}} "python3 scripts/codex_runner.py --mode plain --reasoning-effort {{effort}} --max-retries {{retries}}"
