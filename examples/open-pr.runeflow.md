---
name: open-pr
description: Create and publish a pull request from the current branch.
version: 0.1
inputs:
  base_branch: string
  draft: boolean
outputs:
  pr_url: string
---

# Open PR

This runeflow shows how to mix operator-facing notes with executable workflow steps.

```runeflow
step check_template type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}

step draft_pr type=llm retry=1 fallback=abort_missing_llm {
  prompt: "Draft a PR title and body for the current branch changes."
  input: { template_exists: steps.check_template.exists }
  schema: { title: string, body: string }
}

step push_branch type=tool {
  tool: git.push_current_branch
  out: { branch: string, remote: string }
}

branch continue_or_abort {
  if: steps.draft_pr.title != ""
  then: create_pr
  else: abort_empty_title
}

step create_pr type=tool {
  tool: github.create_pr
  with: {
    title: steps.draft_pr.title,
    body: steps.draft_pr.body,
    base: inputs.base_branch,
    draft: inputs.draft,
    draft_result_path: steps.draft_pr.result_path
  }
  out: { pr_number: number, pr_url: string }
  next: finish
}

step abort_empty_title type=tool {
  tool: util.fail
  with: { message: "PR title must not be empty." }
  out: { message: string }
  next: fail
  fail_message: "Generated PR title was empty."
}

step abort_missing_llm type=tool {
  tool: util.fail
  with: { message: "Unable to generate a PR description." }
  out: { message: string }
  next: fail
  fail_message: "LLM drafting failed."
}

step finish type=tool {
  tool: util.complete
  with: { pr_url: steps.create_pr.pr_url }
  out: { pr_url: string }
}

output {
  pr_url: steps.finish.pr_url
}
```
