# Runeflow

Runeflow is a tiny workflow runtime for executable AI skills.

It keeps Markdown for human guidance, adds a small `runeflow` block for machine-readable flow, and writes JSON artifacts for every run.

## Why Runeflow

Markdown is a great format for instructions, but it is weak at execution semantics:

- no typed step outputs
- no explicit retries or fallbacks
- no run artifact you can inspect later
- no clean boundary between deterministic tooling and fuzzy LLM judgment

Runeflow is meant to fill that gap without becoming a heavyweight orchestration system.

## What You Get

- Hybrid authoring: Markdown docs plus a fenced `runeflow` block
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
node ./bin/runeflow.js validate ./examples/open-pr.runeflow.md
node ./bin/runeflow.js run ./examples/open-pr.runeflow.md --input '{"base_branch":"main","draft":true}' --runtime ./examples/open-pr-runtime.js
```

## CLI

```bash
runeflow validate ./examples/open-pr.runeflow.md
runeflow run ./examples/open-pr.runeflow.md --input '{"base_branch":"main","draft":true}' --runtime ./examples/open-pr-runtime.js
runeflow inspect-run <run-id>
runeflow import ./legacy-runeflow.md
```

## Install Modes

With npm:

```bash
npm install
npm link
runeflow --help
```

With Bun as the package manager:

```bash
bun install
bunx runeflow --help
```

By default Bun respects Node shebangs, so a CLI file marked with `#!/usr/bin/env node` will run with Node unless you explicitly force Bun. If you want Bun to execute the CLI runtime directly, use:

```bash
bunx --bun runeflow --help
```

## Hybrid Runeflow Shape

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

```runeflow
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

## Result Passing

Nodes already receive previous step outputs in memory through expressions like `steps.draft_pr.title`.

Runeflow now also persists one JSON artifact per step, so downstream steps can reference:

- `steps.<id>.result_path`
- `steps.<id>.artifact_path`
- `steps.<id>.outputs.*`

That gives you two data-flow modes:

- fast in-memory value passing for normal bindings
- explicit file references when a later node wants the full prior result object

## Example Run Artifact

Each run writes a run-level JSON artifact, and each step also gets its own JSON artifact on disk.

```json
{
  "run_id": "run_20260401115249_i1s3q5",
  "runeflow": {
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
      "artifact_path": "/tmp/.runeflow-runs/run_123/steps/draft_pr.json",
      "result_path": "/tmp/.runeflow-runs/run_123/steps/draft_pr.json",
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

- `parseRuneflow(source)`
- `validateRuneflow(definition)`
- `runRuneflow(definition, inputs, runtime)`
- `importMarkdownRuneflow(source)`

`runtime.tools` is a registry of named tool handlers. `runtime.llm` handles `llm` steps and must return data that satisfies the step schema.

## Project Layout

- `bin/runeflow.js`: CLI entrypoint
- `src/parser.js`: markdown + DSL parser
- `src/validator.js`: static validation and reference checks
- `src/runtime.js`: workflow execution and artifact persistence
- `examples/open-pr.runeflow.md`: end-to-end sample runeflow

## Roadmap

- Richer schema support and better validation errors
- More expressive branch conditions and output bindings
- First-class runtime adapters for common tool registries
- A better migration path for legacy markdown-only skills
