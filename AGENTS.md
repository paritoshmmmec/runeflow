# AGENTS.md

This repository is `Runeflow`, a small workflow runtime for executable AI skills.

## Purpose

Runeflow combines:

- Markdown for human-facing guidance
- a fenced `runeflow` block for executable workflow logic
- JSON artifacts for run-level and step-level outputs

The runtime owns execution semantics. LLM handlers may see projected docs and resolved inputs, but they should not be expected to parse or enforce the Runeflow DSL itself.

The goal is to keep the runtime small and easy to evolve during experimentation. Prefer simple, explicit designs over flexible but heavy abstractions.

## File Format

Runeflow files are standard Markdown documents. The `.runeflow.md` suffix is a convention — any `.md` file containing a fenced `runeflow` block is a valid Runeflow file. The runtime finds and executes the block regardless of filename. This means existing docs, runbooks, or READMEs can become executable without renaming.

The `.runeflow.md` convention exists to signal intent: this file is workflow-first. It may be relaxed in a future version to support plain `.md` as the primary extension.

## Current Runtime Model

The supported workflow model is intentionally narrow:
- named **`block`** templates (`block id type=… { … }`) and **`step … type=block { block: id }`** (same-file resolution in `src/blocks.js`)
- `tool` steps
- `llm` steps with schema validation
- `transform` steps (optional kill switch: **`RUNEFLOW_DISABLE_TRANSFORM=1`**)
- `branch` steps with explicit `then` / `else` targets
- `retry`
- `fallback`
- terminal `fail`

Do not introduce loops, recursion, arbitrary DAG scheduling, or hidden control-flow without a strong reason and matching tests/docs updates.

## Naming And Compatibility

Use `runeflow` as the primary public term.

Preferred public names:

- `parseRuneflow`
- `validateRuneflow`
- `runRuneflow`
- `importMarkdownRuneflow`
- fenced code block: ```` ```runeflow ````

Legacy `skill` naming is still accepted in compatibility paths:

- `parseSkill`
- `validateSkill`
- `runSkill`
- `importMarkdownSkill`
- fenced code block: ```` ```skill ````

When changing behavior, keep compatibility aliases working unless the change is an intentional breaking change.

## Result Passing

Downstream steps can consume previous node results in two ways:

1. In-memory bindings like `steps.draft_pr.title`
2. Artifact paths like `steps.draft_pr.result_path` or `steps.draft_pr.artifact_path`

String-valued fields may also use `{{ ... }}` interpolation. Exact templates should preserve native values; mixed templates should render as strings.

Each executed step should continue to write its own JSON artifact. Preserve this behavior unless the artifact model is explicitly being redesigned.

## Important Files

- `src/parser.js`: frontmatter + fenced-block parsing
- `src/blocks.js`: block template expansion for `type=block` steps
- `src/validator.js`: static validation, reference checking, shape enforcement
- `src/expression.js`: `inputs.*` and `steps.*` reference resolution
- `src/runtime.js`: execution engine and artifact writing
- `src/builtins.js`: built-in file and git tool registry
- `src/cli.js`: command surface
- `src/index.js`: public exports
- `examples/`: reference runeflows and runtime examples
- `test/`: behavior tests

## Authoring Expectations

When adding or updating examples:

- prefer `.runeflow.md` for primary examples
- keep examples small but realistic
- show both deterministic tool usage and typed LLM outputs when possible
- include result passing when it helps explain the model

When updating docs:

- keep README focused on public usage
- keep AGENTS.md focused on repo-working guidance

## Validation Expectations

Before finishing meaningful changes, run:

```bash
npm test
node ./bin/runeflow.js validate ./examples/open-pr.runeflow.md
node ./bin/runeflow.js validate ./examples/block-demo.runeflow.md
```

If runtime behavior changes, also run:

```bash
node ./bin/runeflow.js run ./examples/open-pr.runeflow.md --input '{"base_branch":"main"}' --runtime ./examples/open-pr-runtime.js --runs-dir ./.runeflow-runs
```

## Style Guidance

- Keep the implementation straightforward and readable.
- Prefer explicit data structures over clever parsing tricks.
- Keep public behavior documented when it changes.
- Add or update tests with behavior changes.
- Preserve the small-runtime, experimentation-first posture of the repo.
