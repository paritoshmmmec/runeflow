# Skillforge

`skillforge` is a small runtime for hybrid skills:

- Markdown stays available for human-facing guidance.
- A fenced `skill` block defines executable workflow steps.
- Runs persist one JSON artifact with step-by-step state.

## Supported workflow model

- Ordered execution
- `tool` steps
- `llm` steps with schema validation
- `branch` steps with explicit `then` / `else` jump targets
- `retry`
- `fallback`
- terminal `fail` via `next: fail` or `fallback: fail`

The runtime is intentionally small and does not support loops, recursion, arbitrary DAGs, or parallel execution.

## CLI

```bash
skill validate ./examples/open-pr.skill.md
skill run ./examples/open-pr.skill.md --input '{"base_branch":"main","draft":true}' --runtime ./examples/open-pr-runtime.js
skill inspect-run <run-id>
skill import ./legacy-skill.md
```

## Hybrid skill shape

````md
---
name: open-pr
description: Create and publish a pull request from the current branch.
version: 0.1
inputs:
  base_branch: string
outputs:
  pr_url: string
---

# Notes

Operator-facing guidance lives here.

```skill
step check type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}

output {
  pr_url: steps.check.exists
}
```
````

## Runtime API

The library exports:

- `parseSkill(source)`
- `validateSkill(definition)`
- `runSkill(definition, inputs, runtime)`
- `importMarkdownSkill(source)`

`runtime.tools` is a registry of named tool handlers. `runtime.llm` handles `llm` steps and must return data that satisfies the step schema.
