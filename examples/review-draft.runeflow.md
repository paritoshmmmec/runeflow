---
name: draft-review
description: Draft high-level code review notes for the current local branch.
version: 0.2
inputs:
  base_branch: string
outputs:
  branch: string
  summary: string
  risks:
    - string
  test_focus:
    - string
llm:
  provider: anthropic
  router: false
  model: claude-3-7-sonnet-latest
---

# Draft Review

These operator notes explain what kind of review to produce. The runtime owns execution and
projects this guidance to the `llm` step as `docs`.

Focus on reviewer-facing notes, not implementation. Prefer actionable risks and test areas over
stylistic comments. If the diff looks low risk, say so directly.

```runeflow
step current_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step summarize_diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}

step draft_review type=llm {
  llm: {
    provider: cerebras,
    router: false,
    model: qwen-3-235b-a22b-instruct-2507
  }
  prompt: |
    Draft code review notes for branch {{ steps.current_branch.branch }}
    against {{ inputs.base_branch }}.

    Changed files: {{ steps.summarize_diff.files }}

    Diff summary:
    {{ steps.summarize_diff.summary }}
  input: {
    branch: steps.current_branch.branch,
    base_branch: inputs.base_branch,
    changed_files: "{{ steps.summarize_diff.files }}",
    diff_summary: steps.summarize_diff.summary
  }
  schema: {
    summary: string,
    risks: [string],
    test_focus: [string]
  }
}

step finish type=tool {
  tool: util.complete
  with: {
    branch: steps.current_branch.branch,
    summary: steps.draft_review.summary,
    risks: "{{ steps.draft_review.risks }}",
    test_focus: "{{ steps.draft_review.test_focus }}"
  }
  out: {
    branch: string,
    summary: string,
    risks: [string],
    test_focus: [string]
  }
}

output {
  branch: steps.finish.branch
  summary: steps.finish.summary
  risks: steps.finish.risks
  test_focus: steps.finish.test_focus
}
```
