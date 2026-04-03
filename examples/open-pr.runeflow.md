---
name: prepare-pr
description: Prepare a pull request draft from the current local branch.
version: 0.2
inputs:
  base_branch: string
outputs:
  branch: string
  title: string
  body: string
  diff_summary: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Prepare PR

These operator notes stay in the same hybrid file as the executable flow. Runeflow projects
this prose to the `llm` step as `docs`, while the fenced `runeflow` block remains the
runtime-owned execution contract.

Use this workflow to draft a pull request for the current branch against `base_branch`.
The LLM should only rely on the resolved prompt, resolved input, and these operator notes.

```runeflow
step check_template type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}

step current_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step summarize_diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}

step draft_pr type=llm {
  prompt: |
    Prepare a pull request draft for branch {{ steps.current_branch.branch }}
    targeting {{ inputs.base_branch }}.

    PR template present: {{ steps.check_template.exists }}
    Changed files: {{ steps.summarize_diff.files }}

    Diff summary:
    {{ steps.summarize_diff.summary }}
  input: {
    branch: steps.current_branch.branch,
    base_branch: inputs.base_branch,
    template_exists: steps.check_template.exists,
    diff_summary: steps.summarize_diff.summary,
    changed_files: "{{ steps.summarize_diff.files }}"
  }
  schema: { title: string, body: string }
}

step finish type=tool {
  tool: util.complete
  with: {
    branch: steps.current_branch.branch,
    title: steps.draft_pr.title,
    body: steps.draft_pr.body,
    diff_summary: steps.summarize_diff.summary
  }
  out: {
    branch: string,
    title: string,
    body: string,
    diff_summary: string
  }
}

output {
  branch: steps.finish.branch
  title: steps.finish.title
  body: steps.finish.body
  diff_summary: steps.finish.diff_summary
}
```
