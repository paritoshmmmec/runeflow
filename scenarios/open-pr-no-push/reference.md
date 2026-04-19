---
name: draft-pr-notes
description: Draft PR title and body from current branch vs base. No push, no PR open.
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  body: string
---

# Draft PR notes

Reads the current git branch and a diff summary against the base branch, then
drafts a PR title and body. No push, no PR open.

```runeflow
step branch type=cli {
  command: "git rev-parse --abbrev-ref HEAD"
}

step diff type=cli {
  command: "git diff --stat {{ inputs.base_branch }}...HEAD"
}

step draft type=llm {
  prompt: |
    Branch: {{ steps.branch.stdout }} → {{ inputs.base_branch }}
    Diff summary:
    {{ steps.diff.stdout }}

    Draft a PR title (under 72 chars, leading with feat:/fix:/chore:) and a
    plain-markdown body explaining what changed and why.
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
```
