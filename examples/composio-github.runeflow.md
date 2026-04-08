---
name: composio-github
description: Read-only GitHub workflow through Composio
version: 0.1
inputs:
  owner: string
  repo: string
outputs:
  successful: boolean
  branch_count: number
---

# Composio GitHub Example

This example uses the Composio adapter plugin to call GitHub through a connected Composio account.

Required environment:

- `COMPOSIO_API_KEY`
- `COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID`
- `COMPOSIO_GITHUB_USER_ID` or `COMPOSIO_ENTITY_ID`
- `COMPOSIO_TOOLKIT_VERSION_GITHUB` recommended for stable execution

```runeflow
step list_branches type=tool {
  tool: composio.github.list_branches
  with: {
    owner: inputs.owner,
    repo: inputs.repo,
    per_page: 3,
    page: 1
  }
  out: {
    content: [any],
    isError: boolean,
    raw: {
      successful: boolean,
      error: any,
      data: {
        details: [any]
      }
    }
  }
}

step branch_count type=transform {
  input: steps.list_branches.raw.data.details
  expr: "{ count: input.length }"
  out: { count: number }
}

output {
  successful: steps.list_branches.raw.successful
  branch_count: steps.branch_count.count
}
```
