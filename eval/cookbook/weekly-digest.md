---
name: weekly-repo-digest
description: Summarize open PRs and stale issues from a GitHub repo and post a digest to Slack.
version: 0.1
inputs:
  owner: string
  repo: string
  slack_channel: string
  stale_days: number
outputs:
  pr_count: number
  stale_count: number
  digest: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Weekly Repo Digest

Every Monday morning, summarize the health of a GitHub repo and post it to Slack.
The LLM should write a digest that a busy engineer can read in 30 seconds.
Lead with the most urgent items. Flag anything that looks blocked or forgotten.

```runeflow
step list_prs type=tool {
  tool: github.count_open_prs
  with: { owner: inputs.owner, repo: inputs.repo }
  out: { count: number }
}

step list_stale type=tool {
  tool: github.list_stale_prs
  with: { owner: inputs.owner, repo: inputs.repo, days_since_update: inputs.stale_days }
  out: { pull_requests: [{ number: number, title: string, url: string, author: string, updated_at: string, days_since_update: number }] }
}

step draft_digest type=llm {
  prompt: |
    Write a weekly repo digest for {{ inputs.owner }}/{{ inputs.repo }}.

    Open PRs: {{ steps.list_prs.count }}
    Stale PRs ({{ inputs.stale_days }}+ days without update): {{ steps.list_stale.pull_requests }}

    Write a short Slack digest (3-5 bullet points) summarizing repo health.
    Flag any PRs that look blocked. Keep it scannable.
  input: {
    repo: "{{ inputs.owner }}/{{ inputs.repo }}",
    pr_count: steps.list_prs.count,
    stale_prs: "{{ steps.list_stale.pull_requests }}"
  }
  schema: { digest: string }
}

step post type=tool {
  tool: slack.post_message
  with: {
    channel: inputs.slack_channel,
    text: steps.draft_digest.digest
  }
  out: { ok: boolean, ts: string }
}

step counts type=transform {
  input: steps.list_stale.pull_requests
  expr: "{ stale_count: input.length }"
  out: { stale_count: number }
}

output {
  pr_count: steps.list_prs.count
  stale_count: steps.counts.stale_count
  digest: steps.draft_digest.digest
}
```
