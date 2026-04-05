---
name: prepare-pr-raw
description: Raw Markdown baseline for pull request drafting.
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  body: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Prepare PR

This is the raw-skill baseline for pull request drafting.

The host loads this Markdown guidance into model context and provides resolved repository context in the same prompt exchange. The model should draft a useful pull request title and body from the provided branch information, changed files, and diff summary.

Keep the title concise. Make the body useful to a human reviewer. Treat the repository context as the source of truth.
