# Runeflow

Runeflow is a tiny workflow runtime for executable AI skills.

It keeps Markdown for human guidance, adds a small `runeflow` block for machine-readable flow, and writes JSON artifacts for every run.

## Problem Statement

Today, most AI skills are still just reusable prompt text. That creates a gap between what humans want to author and what systems need to execute:

- prompts are readable, but they do not define execution semantics
- scripts are executable, but they are not pleasant skill artifacts for humans to maintain
- models can generate outputs, but they should not be the component enforcing control flow, retries, or type contracts

The result is that teams end up with brittle prompt conventions, ad hoc orchestration code, and very little visibility into what actually happened during a run.

Runeflow exists to make a skill an executable behavior contract instead of just reusable text. The human-facing guidance stays in Markdown, while the runtime owns sequencing, validation, branching, retries, and artifacts.

See [RETROSPECTIVE.md](/Users/paritosh/src/skill-language/RETROSPECTIVE.md) for the current prototype retrospective and the intended end-to-end flow.

## Why Runeflow

Markdown is a great format for instructions, but it is weak at execution semantics:

- no typed step outputs
- no explicit retries or fallbacks
- no run artifact you can inspect later
- no clean boundary between deterministic tooling and fuzzy LLM judgment

Runeflow is meant to fill that gap without becoming a heavyweight orchestration system.

The runtime, not the model, is authoritative for execution. An `llm` step receives projected docs, a resolved prompt, and resolved inputs, but it is not expected to parse or enforce the Runeflow language itself.

## End-To-End Flow

At a high level, Runeflow works like this:

1. Author a single hybrid file with frontmatter, docs, and a fenced `runeflow` block.
2. Parse the file into human docs plus an executable workflow definition.
3. Validate the workflow contract before execution.
4. Execute `tool`, `llm`, and `branch` steps in runtime-owned order.
5. Project only the current-step prompt, resolved input, and selected docs/context to the model.
6. Validate outputs, write step artifacts, and resolve final run outputs.

The longer walkthrough lives in [RETROSPECTIVE.md](/Users/paritosh/src/skill-language/RETROSPECTIVE.md).

## What You Get

- Hybrid authoring: Markdown docs plus a fenced `runeflow` block
- Typed `tool`, `llm`, and `branch` steps
- Ordered execution with `retry`, `fallback`, and terminal `fail`
- JSON run artifacts with per-step inputs, outputs, status, attempts, and errors
- A small local CLI for validation, execution, inspection, and markdown import
- Built-in local repo tools for common file and git steps

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
cp .env.example .env
node ./bin/runeflow.js validate ./examples/open-pr.runeflow.md
node --env-file=.env ./bin/runeflow.js run ./examples/open-pr.runeflow.md --input '{"base_branch":"main"}' --runtime ./examples/open-pr-runtime.js
node ./bin/runeflow.js validate ./examples/review-draft.runeflow.md
node --env-file=.env ./bin/runeflow.js run ./examples/review-draft.runeflow.md --input '{"base_branch":"main"}' --runtime ./examples/review-draft-runtime.js
```

## CLI

```bash
runeflow validate ./examples/open-pr.runeflow.md
node --env-file=.env ./bin/runeflow.js run ./examples/open-pr.runeflow.md --input '{"base_branch":"main"}' --runtime ./examples/open-pr-runtime.js
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
name: prepare-pr
description: Prepare a pull request draft from the current branch.
version: 0.2
inputs:
  base_branch: string
outputs:
  branch: string
  title: string
  body: string
---

# Prepare PR

Operator-facing guidance lives here.

```runeflow
step current_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step draft_pr type=llm {
  prompt: "Draft a PR for {{ steps.current_branch.branch }} targeting {{ inputs.base_branch }}."
  input: { branch: steps.current_branch.branch }
  schema: { title: string, body: string }
}

step finish type=tool {
  tool: util.complete
  with: {
    branch: steps.current_branch.branch,
    title: steps.draft_pr.title,
    body: steps.draft_pr.body
  }
  out: { branch: string, title: string, body: string }
}

output {
  branch: steps.finish.branch
  title: steps.finish.title
  body: steps.finish.body
}
```
````

## Result Passing

Nodes already receive previous step outputs in memory through expressions like `steps.draft_pr.title`.

String-valued fields may also use template interpolation with `{{ ... }}`. Exact templates preserve native values, while mixed strings are rendered as strings.

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
    "name": "prepare-pr",
    "version": 0.2
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
        "title": "Prepare PR for feature/runtime-owned",
        "body": "Base branch: main\nChanged files: feature.txt"
      }
    }
  ],
  "outputs": {
    "branch": "feature/runtime-owned",
    "title": "Prepare PR for feature/runtime-owned",
    "body": "Base branch: main\nChanged files: feature.txt"
  }
}
```

## Runtime API

The library exports:

- `parseRuneflow(source)`
- `validateRuneflow(definition)`
- `runRuneflow(definition, inputs, runtime)`
- `importMarkdownRuneflow(source)`

`runtime.tools` is a registry of named tool handlers. CLI and library execution also include built-in local tools such as `file.exists`, `git.current_branch`, `git.diff_summary`, `git.push_current_branch`, `util.fail`, and `util.complete`. User-provided tools override built-ins by name.

`runtime.llm` handles `llm` steps and must return data that satisfies the step schema. Each invocation receives:

- `step`
- resolved `prompt`
- resolved `input`
- `schema`
- `state`
- `docs`: the projected Markdown operator notes from the same hybrid file
- `context`: metadata about the current Runeflow definition

The sample runtime in [`examples/open-pr-runtime.js`](/Users/paritosh/src/skill-language/examples/open-pr-runtime.js) uses the Cerebras chat-completions API via `CEREBRAS_API_KEY`, with `CEREBRAS_MODEL` as an optional override.

There is also a second end-to-end example in [`examples/review-draft.runeflow.md`](/Users/paritosh/src/skill-language/examples/review-draft.runeflow.md) that turns the same repo context into reviewer-facing summary, risk notes, and test focus areas.

## Project Layout

- `bin/runeflow.js`: CLI entrypoint
- `src/parser.js`: markdown + DSL parser
- `src/validator.js`: static validation and reference checks
- `src/expression.js`: expression and template interpolation resolution
- `src/runtime.js`: workflow execution and artifact persistence
- `src/builtins.js`: built-in local file and git tools
- `examples/open-pr.runeflow.md`: end-to-end sample runeflow
- `examples/review-draft.runeflow.md`: code review drafting sample runeflow
- `RETROSPECTIVE.md`: prototype learnings and end-to-end flow

## Roadmap

- Richer schema support and better validation errors
- More expressive branch conditions and output bindings
- First-class runtime adapters for hosted tool registries
- A better migration path for legacy markdown-only skills
