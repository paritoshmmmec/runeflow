---
name: ship
description: |
  Ship a branch: run tests, review diff, bump version, update CHANGELOG,
  commit, push, and open a PR. Use when code is ready to land.
version: 0.1
inputs:
  base_branch: string
outputs:
  pr_url: string
  version: string
llm:
  provider: cerebras
  model: qwen-3-235b-a22b-instruct-2507
---

# Ship

Review the diff, bump the version, write the CHANGELOG entry, and open a PR.
Be concise. One line per finding. Fix what you can automatically; ask only for
critical issues that need a human decision.

```runeflow
step branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string], insertions: number, deletions: number }
}

step log type=tool {
  tool: git.log
  with: { base: inputs.base_branch }
  out: { commits: [string] }
}

step version type=tool {
  tool: file.read
  with: { path: "VERSION" }
  out: { content: string }
}

step review type=llm {
  prompt: |
    Review this diff for critical issues only (security, data loss, race conditions).
    Branch: {{ steps.branch.branch }} → {{ inputs.base_branch }}
    Files changed: {{ steps.diff.files }}
    Diff summary: {{ steps.diff.summary }}
  input: {
    diff_summary: steps.diff.summary,
    files: steps.diff.files
  }
  schema: {
    issues: [string],
    verdict: string,
    safe_to_ship: boolean
  }
}

branch gate {
  if: steps.review.safe_to_ship == true
  then: draft_changelog
  else: abort
}

step abort type=fail {
  message: "Review found blocking issues: {{ steps.review.issues }}"
  data: { issues: steps.review.issues, verdict: steps.review.verdict }
}

step draft_changelog type=llm {
  prompt: |
    Write a CHANGELOG entry for version bump.
    Commits: {{ steps.log.commits }}
    Diff summary: {{ steps.diff.summary }}
    Current version: {{ steps.version.content }}
  input: {
    commits: steps.log.commits,
    diff_summary: steps.diff.summary,
    current_version: steps.version.content
  }
  schema: {
    new_version: string,
    entry: string,
    bump_type: string
  }
}

step write_version type=tool {
  tool: file.write
  with: {
    path: "VERSION",
    content: steps.draft_changelog.new_version
  }
  out: { written: boolean }
}

step write_changelog type=tool {
  tool: file.write
  with: {
    path: "CHANGELOG.md",
    content: steps.draft_changelog.entry
  }
  out: { written: boolean }
}

step push type=tool cache=false {
  tool: git.push_current_branch
  out: { branch: string, remote: string }
}

step open_pr type=cli cache=false {
  command: "gh pr create --base {{ inputs.base_branch }} --title 'chore: ship {{ steps.draft_changelog.new_version }}' --body '{{ steps.draft_changelog.entry }}'"
}

output {
  pr_url: steps.open_pr.stdout
  version: steps.draft_changelog.new_version
}
```
