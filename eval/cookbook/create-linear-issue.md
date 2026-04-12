---
name: create-linear-issue-from-failure
description: Draft and create a Linear bug ticket from a CI failure, with human confirmation before submitting.
version: 0.1
inputs:
  failure_summary: string
  team_id: string
outputs:
  confirmed: boolean
  issue_id: string
  issue_url: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Create Linear Issue from Failure

Given a CI failure summary, draft a Linear bug ticket and ask for confirmation before
creating it. The LLM should produce a clear, actionable title and description.
Keep the title under 80 characters. The description should include reproduction steps
if they can be inferred from the failure summary.

```runeflow
step draft type=llm {
  prompt: |
    Draft a Linear bug ticket for the following CI failure:

    {{ inputs.failure_summary }}

    Produce a short title and a markdown description with what failed and suggested next steps.
  input: { failure_summary: inputs.failure_summary }
  schema: { title: string, description: string }
}

step confirm type=human_input {
  prompt: "Create Linear issue: {{ steps.draft.title }}?"
  choices: ["yes", "no"]
  default: "no"
}

branch check_confirm {
  if: steps.confirm.answer == "yes"
  then: create_issue
  else: skip
}

step create_issue type=tool {
  tool: linear.create_issue
  with: {
    team_id: inputs.team_id,
    title: steps.draft.title,
    description: steps.draft.description
  }
  out: { id: string, url: string }
}

step skip type=tool {
  tool: util.complete
  with: { id: "", url: "" }
  out: { id: string, url: string }
}

output {
  confirmed: steps.confirm.answer == "yes"
  issue_id: "{{ steps.create_issue.id }}{{ steps.skip.id }}"
  issue_url: "{{ steps.create_issue.url }}{{ steps.skip.url }}"
}
```
