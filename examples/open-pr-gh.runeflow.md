---
name: open-pr-gh
description: Draft and open a GitHub pull request for the current branch using the gh CLI.
version: 0.1
inputs:
  base_branch: string
outputs:
  branch: string
  title: string
  pr_url: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Open PR with gh

This skill drafts a PR title and body using the diff, then opens it with `gh pr create`.
The LLM only sees the diff — the runtime handles all git and CLI operations.

Requires `gh` to be installed and authenticated (`gh auth login`).

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

step check_template type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}

step draft type=llm {
  prompt: |
    Draft a pull request for branch {{ steps.branch.branch }} targeting {{ inputs.base_branch }}.

    PR template present: {{ steps.check_template.exists }}
    Changed files: {{ steps.diff.files }}

    Diff summary:
    {{ steps.diff.summary }}
  input: {
    branch: steps.branch.branch,
    base_branch: inputs.base_branch,
    diff_summary: steps.diff.summary,
    changed_files: "{{ steps.diff.files }}"
  }
  schema: { title: string, body: string }
}

step create_pr type=cli cache=false {
  command: "gh pr create --title '{{ steps.draft.title }}' --body '{{ steps.draft.body }}' --base {{ inputs.base_branch }}"
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: {
    branch: steps.branch.branch,
    title: steps.draft.title,
    pr_url: steps.create_pr.stdout
  }
  out: { branch: string, title: string, pr_url: string }
}

output {
  branch: steps.finish.branch
  title: steps.finish.title
  pr_url: steps.finish.pr_url
}
```
