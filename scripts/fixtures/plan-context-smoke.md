# Delivery Plan

This fixture exercises a source-backed draft for task and milestone planning.

## Immediate Milestones

First, stabilize the Anthropic-compatible LangChain runner. Next, verify it on
real imported source nodes. Then, expand the regression set across multiple
document types.

## Risks And Dependencies

The main risks are schema drift, brittle patch shapes, and losing the
patch-first review boundary while trying to optimize the runtime too early.

## Success Criteria

The default AI path should keep producing local, reviewable patches with clear
rationale, direct evidence when available, and replay-friendly history.
