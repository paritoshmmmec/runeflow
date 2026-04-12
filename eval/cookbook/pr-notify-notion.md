---
name: pr-notify-notion
description: Draft and open a GitHub PR, post the result to Slack, then log it in Notion. Uses multiple runeflow blocks with scoped docs per section.
version: 0.1
inputs:
  owner: string
  repo: string
  base_branch: string
  slack_channel: string
  notion_database_id: string
outputs:
  pr_number: number
  pr_url: string
  slack_ts: string
  notion_page_id: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# PR → Slack → Notion

Collect the current branch and diff, draft a PR with the LLM, open it on GitHub,
announce it in Slack, and log a record in Notion. Each section below scopes its
prose as docs for the LLM steps it contains.

```runeflow
step get_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step get_diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}
```

## Draft the PR

Keep the title under 72 characters and lead with the change type (feat/fix/chore).
The body should explain what changed and why in plain markdown.
Also produce a one-sentence `slack_message` for the channel announcement and a
short `notion_content` plain-text summary for the log entry.

```runeflow
step draft_pr type=llm {
  prompt: |
    Draft a pull request for branch {{ steps.get_branch.branch }} targeting {{ inputs.base_branch }}.

    Changed files: {{ steps.get_diff.files }}
    Diff summary:
    {{ steps.get_diff.summary }}
  input: {
    branch: steps.get_branch.branch,
    base_branch: inputs.base_branch,
    diff_summary: steps.get_diff.summary,
    changed_files: "{{ steps.get_diff.files }}"
  }
  schema: { title: string, body: string, slack_message: string, notion_content: string }
}
```

## Open the PR and notify

Open the pull request on GitHub, then post the Slack announcement and create the
Notion log entry in parallel.

```runeflow
step open_pr type=tool {
  tool: github.create_pr
  with: {
    owner: inputs.owner,
    repo: inputs.repo,
    title: steps.draft_pr.title,
    body: steps.draft_pr.body,
    head: steps.get_branch.branch,
    base: inputs.base_branch,
    draft: false
  }
  out: { number: number, url: string, state: string }
}

parallel notify {
  steps: [post_slack, log_notion]
}

step post_slack type=tool {
  tool: slack.post_message
  with: {
    channel: inputs.slack_channel,
    text: steps.draft_pr.slack_message
  }
  out: { ok: boolean, ts: string }
}

step log_notion type=tool {
  tool: notion.create_page
  with: {
    parent_id: inputs.notion_database_id,
    parent_type: "database",
    title: steps.draft_pr.title,
    content: steps.draft_pr.notion_content
  }
  out: { id: string, url: string }
}

output {
  pr_number: steps.open_pr.number
  pr_url: steps.open_pr.url
  slack_ts: steps.post_slack.ts
  notion_page_id: steps.log_notion.id
}
```
