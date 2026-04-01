# Runeflow

Runeflow is a tiny workflow runtime for executable AI skills.

It keeps Markdown for human guidance, adds a small DSL for machine-readable flow, and writes one JSON artifact for every run.

## Why Runeflow

Markdown is a great format for instructions, but it is weak at execution semantics:

- no typed step outputs
- no explicit retries or fallbacks
- no run artifact you can inspect later
- no clean boundary between deterministic tooling and fuzzy LLM judgment

Runeflow is meant to fill that gap without becoming a heavyweight orchestration system.

## What You Get

- Hybrid authoring: Markdown docs plus a fenced `skill` block
- Typed `tool`, `llm`, and `branch` steps
- Ordered execution with `retry`, `fallback`, and terminal `fail`
- JSON run artifacts with per-step inputs, outputs, status, attempts, and errors
- A small local CLI for validation, execution, inspection, and markdown import

## Supported Workflow Model

- Ordered execution
- `tool` steps
- `llm` steps with schema validation
- `branch` steps with explicit `then` and `else` jump targets
- `retry`
- `fallback`
- terminal `fail` via `next: fail` or `fallback: fail`

The runtime is intentionally small and does not support loops, recursion, arbitrary DAGs, or parallel execution.

## Quickstart

```bash
npm install
npm test
node ./bin/skill.js validate ./examples/open-pr.skill.md
node ./bin/skill.js run ./examples/open-pr.skill.md --input '{"base_branch":"main","draft":true}' --runtime ./examples/open-pr-runtime.js
```

## CLI

```bash
skill validate ./examples/open-pr.skill.md
skill run ./examples/open-pr.skill.md --input '{"base_branch":"main","draft":true}' --runtime ./examples/open-pr-runtime.js
skill inspect-run <run-id>
skill import ./legacy-skill.md
```

## Hybrid Skill Shape

This is the core idea: keep the prose humans want, and add a small executable workflow for the runtime.

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

# Open PR

Operator-facing guidance lives here.

```skill
step check_template type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}

step draft_pr type=llm {
  prompt: "Draft a PR title and body for the current branch changes."
  input: { template_exists: steps.check_template.exists }
  schema: { title: string, body: string }
}

output {
  pr_url: steps.draft_pr.title
}
```
````

## Example Run Artifact

Each run writes a JSON artifact that can be inspected by people or consumed by other tooling.

```json
{
  "run_id": "run_20260401115249_i1s3q5",
  "skill": {
    "name": "open-pr",
    "version": 0.1
  },
  "status": "success",
  "steps": [
    {
      "id": "draft_pr",
      "kind": "llm",
      "status": "success",
      "attempts": 1,
      "outputs": {
        "title": "Use existing PR template",
        "body": "Filled from template-aware draft flow."
      }
    }
  ],
  "outputs": {
    "pr_url": "https://example.test/main/draft?title=Use%20existing%20PR%20template"
  }
}
```

## Runtime API

The library exports:

- `parseSkill(source)`
- `validateSkill(definition)`
- `runSkill(definition, inputs, runtime)`
- `importMarkdownSkill(source)`

`runtime.tools` is a registry of named tool handlers. `runtime.llm` handles `llm` steps and must return data that satisfies the step schema.

## Project Layout

- `bin/skill.js`: CLI entrypoint
- `src/parser.js`: markdown + DSL parser
- `src/validator.js`: static validation and reference checks
- `src/runtime.js`: workflow execution and artifact persistence
- `examples/open-pr.skill.md`: end-to-end sample skill

## Roadmap

- Richer schema support and better validation errors
- More expressive branch conditions and output bindings
- First-class runtime adapters for common tool registries
- A better migration path for legacy markdown-only skills
