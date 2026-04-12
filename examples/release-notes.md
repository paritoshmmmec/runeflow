---
name: draft-release-notes
description: Draft structured release notes from commits since the last git tag.
version: 0.1
inputs:
  base_ref: string
outputs:
  tag: string
  title: string
  highlights:
    - string
  breaking_changes:
    - string
  full_notes: string
const:
  provider: cerebras
  model: qwen-3-235b-a22b-instruct-2507
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Release Notes

These operator notes guide the LLM step. The runtime owns all git operations and data
assembly — the model only sees the resolved prompt, the commit log, and this guidance.

Write release notes for a technical audience. Lead with the most impactful changes.
Group by: highlights (user-facing improvements), breaking changes (if any), and a
full changelog. Be concise — one sentence per item. Skip merge commits and version bumps.

```runeflow
step current_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_ref }
  out: { base: string, summary: string, files: [string] }
}

step filter_files type=transform {
  input: steps.diff.files
  expr: "input.filter(f => !f.match(/^(package-lock\\.json|yarn\\.lock|\\.(png|jpg|svg))$/))"
  out: [string]
}

step draft type=llm {
  prompt: |
    Draft release notes for {{ steps.current_branch.branch }} since {{ inputs.base_ref }}.

    Changed files:
    {{ steps.diff.files }}

    Diff summary:
    {{ steps.diff.summary }}
  input: {
    branch: steps.current_branch.branch,
    base_ref: inputs.base_ref,
    diff_summary: steps.diff.summary,
    changed_files: "{{ steps.filter_files }}"
  }
  schema: {
    title: string,
    highlights: [string],
    breaking_changes: [string],
    full_notes: string
  }
}

step finish type=tool {
  tool: util.complete
  with: {
    tag: inputs.base_ref,
    title: steps.draft.title,
    highlights: "{{ steps.draft.highlights }}",
    breaking_changes: "{{ steps.draft.breaking_changes }}",
    full_notes: steps.draft.full_notes
  }
  out: {
    tag: string,
    title: string,
    highlights: [string],
    breaking_changes: [string],
    full_notes: string
  }
}

output {
  tag: steps.finish.tag
  title: steps.finish.title
  highlights: steps.finish.highlights
  breaking_changes: steps.finish.breaking_changes
  full_notes: steps.finish.full_notes
}
```
