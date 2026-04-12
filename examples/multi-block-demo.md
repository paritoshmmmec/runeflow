---
name: multi-block-demo
description: Demonstrates multi-block runeflow files with scoped docs per section.
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  review: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Multi-block Demo

This top-level prose is the global docs — visible to any llm step that doesn't
have a section-specific block above it.

```runeflow
step branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}
```

## Draft the PR title

Keep the title under 72 characters. Lead with the type of change (feat/fix/chore).
Be specific — avoid vague titles like "update code" or "fix bug".

```runeflow
step draft_title type=llm {
  prompt: |
    Write a PR title for branch {{ steps.branch.branch }} targeting {{ inputs.base_branch }}.
    Changed files: {{ steps.diff.files }}
    Diff: {{ steps.diff.summary }}
  input: { diff: steps.diff.summary }
  schema: { title: string }
}
```

## Review the diff

Focus on risk, not style. Flag anything that touches auth, data migrations, or
public APIs. If the change looks safe, say so directly in one sentence.

```runeflow
step draft_review type=llm {
  prompt: |
    Review the diff for {{ steps.branch.branch }}.
    Files: {{ steps.diff.files }}
    Diff: {{ steps.diff.summary }}
  input: { diff: steps.diff.summary, files: "{{ steps.diff.files }}" }
  schema: { review: string }
}

output {
  title: steps.draft_title.title
  review: steps.draft_review.review
}
```
