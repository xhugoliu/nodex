set positional-arguments

help:
    just -l

run *args:
    cargo run -- "$@"

fmt:
    cargo fmt

check:
    cargo check

test:
    cargo test

desktop-check:
    cargo check --manifest-path desktop/src-tauri/Cargo.toml

desktop-dev:
    cd desktop && npm run dev
