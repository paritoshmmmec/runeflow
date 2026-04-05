---
name: stale-pr-triage
description: Runeflow benchmark for stale pull request triage.
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

Use this benchmark to compare raw multi-turn prompting against a runtime-owned workflow.

The runtime should gather stale PR data first, then the model should produce the maintainer-facing summary and recommended actions.

```runeflow
step list_stale type=tool {
  tool: github.list_stale_prs
  with: {
    owner: inputs.owner,
    repo: inputs.repo,
    days_since_update: inputs.days_since_update,
    limit: 5
  }
}

step summarize type=llm {
  prompt: |
    Summarize the stale pull request situation for {{ inputs.owner }}/{{ inputs.repo }}.

    Recommend the top follow-up actions for a maintainer.
  input: {
    owner: inputs.owner,
    repo: inputs.repo,
    days_since_update: inputs.days_since_update,
    stale_pull_requests: "{{ steps.list_stale.pull_requests }}"
  }
  schema: {
    summary: string,
    top_actions: [string]
  }
}

output {
  summary: steps.summarize.summary
  top_actions: steps.summarize.top_actions
}
```
