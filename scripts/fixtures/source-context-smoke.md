# Anthropic LangChain Regression

This fixture is used to exercise a realistic source-backed AI draft path in Nodex.

## Provider Authentication Flow

The desktop default route now prefers the Anthropic-compatible LangChain runner.
Local configuration is expected to define `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, and `ANTHROPIC_MODEL`.

## Evidence Mapping Strategy

Imported chunks should stay attached to the generated nodes, and at least one
chunk should be cited as direct evidence before draft generation.

## Replay And Apply Checks

Successful drafts should still support show, compare, replay, and optional
apply without bypassing canonical patch validation.
