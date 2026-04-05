---
name: stale-pr-triage-raw
description: Raw multi-turn benchmark for stale pull request triage.
version: 0.1
inputs:
  owner: string
  repo: string
  days_since_update: number
outputs:
  summary: string
  top_actions:
    - string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Stale PR Triage

This is the raw-skill baseline for stale pull request triage.

The host should load this document into the model context and allow the model to decide what information to fetch and how to sequence the work.

Task:

1. Find stale pull requests for the target repository.
2. Review the returned list.
3. Produce a short maintainer summary.
4. Recommend the top follow-up actions.

The response must be valid JSON with:

- `summary`: string
- `top_actions`: string[]

The benchmark should be judged on:

- factual correctness
- usefulness to a maintainer
- total tokens across all turns
- number of turns required to finish
