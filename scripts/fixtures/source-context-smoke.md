# OpenAI LangChain Regression

This fixture is used to exercise a realistic source-backed AI draft path in Nodex.

## Provider Authentication Flow

The desktop default route now prefers the OpenAI-compatible LangChain runner.
Local configuration is expected to define `OPENAI_API_KEY`,
`OPENAI_BASE_URL`, and `OPENAI_MODEL`.

## Evidence Mapping Strategy

Imported chunks should stay attached to the generated nodes, and at least one
chunk should be cited as direct evidence before draft generation.

## Replay And Apply Checks

Successful drafts should still support show, compare, replay, and optional
apply without bypassing canonical patch validation.
