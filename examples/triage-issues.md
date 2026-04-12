---
name: triage-issues
description: Triage a batch of GitHub issues from a JSON file — classify, prioritize, and draft a summary.
version: 0.1
inputs:
  issues_file: string
  team_context: string
outputs:
  total: number
  triaged:
    - title: string
      priority: string
      label: string
      reason: string
  summary: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Issue Triage

These operator notes guide the LLM step. The runtime reads and filters the issues —
the model only sees the resolved list and this guidance.

Triage each issue with a priority (P0/P1/P2/P3) and a label from:
`bug`, `feature`, `docs`, `question`, `chore`, `security`.

- P0: production incident or data loss risk
- P1: significant user-facing breakage, no workaround
- P2: meaningful improvement or non-critical bug
- P3: nice-to-have, low urgency

Be concise. One sentence per reason. If the issue title is ambiguous, say so.

```runeflow
step read_issues type=tool {
  tool: file.read
  with: { path: inputs.issues_file }
  out: { content: string }
}

step parse_issues type=transform {
  input: steps.read_issues.content
  expr: "JSON.parse(input)"
  out: [{ number: number, title: string, body: string, labels: [string] }]
}

step filter_open type=transform {
  input: steps.parse_issues
  expr: "input.filter(i => !i.labels || !i.labels.includes('wontfix')).slice(0, 20)"
  out: [{ number: number, title: string, body: string, labels: [string] }]
}

step count type=transform {
  input: steps.filter_open
  expr: "{ count: input.length }"
  out: { count: number }
}

branch check_empty {
  if: steps.count.count == 0
  then: no_issues
  else: triage
}

step no_issues type=tool {
  tool: util.complete
  with: {
    total: steps.count.count,
    triaged: [],
    summary: "No open issues to triage."
  }
  out: {
    total: number,
    triaged: [],
    summary: string
  }
  next: finish
}

step triage type=llm {
  prompt: |
    Triage the following GitHub issues for the team.

    Team context: {{ inputs.team_context }}

    Issues ({{ steps.count.count }} total):
    {{ steps.filter_open }}
  input: {
    issues: "{{ steps.filter_open }}",
    team_context: inputs.team_context
  }
  schema: {
    triaged: [{ title: string, priority: string, label: string, reason: string }],
    summary: string
  }
}

step finish type=tool {
  tool: util.complete
  with: {
    total: steps.count.count,
    triaged: "{{ steps.triage.triaged }}",
    summary: steps.triage.summary
  }
  out: {
    total: number,
    triaged: [{ title: string, priority: string, label: string, reason: string }],
    summary: string
  }
}

output {
  total: steps.finish.total
  triaged: steps.finish.triaged
  summary: steps.finish.summary
}
```
