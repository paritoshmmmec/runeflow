# Runeflow

Runeflow is a tiny prototype runtime for hybrid AI skills.

A Runeflow skill combines:

- Markdown for human guidance
- a fenced `runeflow` block for executable structure
- JSON artifacts for run and step outputs

The goal is to let a host application execute a skill deterministically without asking the LLM to interpret the workflow language.

## What Problem It Solves

Most skills today are just prompt text loaded into model context. That is useful for guidance, but weak for execution:

- control flow is implicit
- tool use is loosely defined
- retries and failure handling are ad hoc
- outputs are hard to validate
- runs are hard to inspect afterward

Runeflow keeps the human-facing Markdown, but moves execution semantics into the runtime.

## Runeflow Vs Plain Skills

Plain skill:

- the host loads instructions into the model
- the model informally decides what steps to follow
- tool usage and output shape rely on prompt discipline

Runeflow skill:

- the host loads and runs a hybrid file
- the runtime owns sequencing, branching, retries, fallback, and validation
- the LLM is used only inside bounded `llm` steps
- each run writes artifacts so behavior is inspectable

The important difference is not whether the LLM can see the text. It can. The difference is that the text is no longer the execution contract.

## Architecture

Runeflow is meant to be run by a host application, which may be a CLI, backend, or agentic codebase.

```mermaid
flowchart LR
    H["Host App or Agentic Codebase"]
    S["Hybrid Skill File\nMarkdown + ```runeflow```"]
    R["Runeflow Runtime"]
    T["Tool Handlers"]
    L["LLM Handlers"]
    A["Run + Step Artifacts"]

    H -->|"load / parse / validate / run"| S
    H -->|"provide runtime env"| R
    S -->|"definition + docs"| R
    R -->|"invoke tool steps"| T
    R -->|"invoke llm steps"| L
    T -->|"structured outputs"| R
    L -->|"schema-validated outputs"| R
    R -->|"write artifacts"| A
    R -->|"final outputs + status"| H
```

- Host: decides when to run a skill and provides tools, LLM handlers, cwd, credentials, and repo context.
- Runeflow runtime: owns execution semantics.
- LLM handler: produces bounded outputs for a single `llm` step.

## Minimal Shape

````md
---
name: prepare-pr
description: Prepare a pull request draft.
version: 0.2
inputs:
  base_branch: string
outputs:
  title: string
  body: string
---

# Prepare PR

Operator guidance lives in Markdown.

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

output {
  title: steps.draft_pr.title
  body: steps.draft_pr.body
}
```
````

## Supported Model

Runeflow is intentionally narrow:

- ordered execution
- `tool` steps
- `llm` steps with schema validation
- `branch` steps with explicit `then` and `else`
- `retry`
- `fallback`
- terminal `fail`

It does not aim to be a general orchestration engine.

## Quickstart

```bash
npm install
npm test
node ./bin/runeflow.js validate ./examples/open-pr.runeflow.md
node --env-file=.env ./bin/runeflow.js run ./examples/open-pr.runeflow.md --input '{"base_branch":"main"}' --runtime ./examples/open-pr-runtime.js
```

## CLI

```bash
runeflow validate <file>
runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js]
runeflow inspect-run <run-id>
runeflow import <file>
```

## Notes

- `.runeflow.md` is a convention, not a requirement. The parser cares about the fenced `runeflow` block, not the filename.
- This repo is still a prototype. Optimize for learning and sharp examples, not for a frozen public contract.
- A prototype tool registry now lives under `registry/` and starts with GitHub and Linear tool schemas.
- Registry-backed tool steps can now omit `out` and derive their output contract from the registry. Current examples still declare output shape inline because the built-in local tools are not in the registry yet.
- Evaluation scaffolding now lives under [eval/README.md](/Users/paritosh/src/skill-language/eval/README.md). Run `npm run eval:open-pr` to compare the first raw-vs-Runeflow benchmark, or use `--mode`, `--delay-ms`, and `--model` for provider-limited evaluations.

## Key Files

- [src/parser.js](/Users/paritosh/src/skill-language/src/parser.js): frontmatter and fenced-block parsing
- [src/validator.js](/Users/paritosh/src/skill-language/src/validator.js): static validation and reference checks
- [src/runtime.js](/Users/paritosh/src/skill-language/src/runtime.js): execution engine and artifact writing
- [src/builtins.js](/Users/paritosh/src/skill-language/src/builtins.js): built-in file and git tools
- [examples/open-pr.runeflow.md](/Users/paritosh/src/skill-language/examples/open-pr.runeflow.md): flagship example
- [examples/review-draft.runeflow.md](/Users/paritosh/src/skill-language/examples/review-draft.runeflow.md): second example
- [eval/README.md](/Users/paritosh/src/skill-language/eval/README.md): evaluation assets and benchmark notes
- [eval/open-pr.raw.md](/Users/paritosh/src/skill-language/eval/open-pr.raw.md): raw-skill baseline for evaluation
- [eval/open-pr.js](/Users/paritosh/src/skill-language/eval/open-pr.js): raw vs Runeflow comparison harness
- [eval/stale-pr-triage.runeflow.md](/Users/paritosh/src/skill-language/eval/stale-pr-triage.runeflow.md): simple multi-turn benchmark
- [RETROSPECTIVE.md](/Users/paritosh/src/skill-language/RETROSPECTIVE.md): prototype learnings
- [plans/PLAN.md](/Users/paritosh/src/skill-language/plans/PLAN.md): roadmap
- [plans/EVAL.md](/Users/paritosh/src/skill-language/plans/EVAL.md): evaluation plan for raw skills vs Runeflow
- [registry/README.md](/Users/paritosh/src/skill-language/registry/README.md): prototype tool registry notes
