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
