# Runeflow — Concrete Improvement Plan

## Core Thesis Recap

Runeflow's value is **moving control flow out of prompts and into a typed runtime**. The benchmarks prove it: -82% input tokens on orchestration-heavy tasks, zero-shot failure prevention. The architecture is sound. The gaps are mostly about finishing what's started, hardening the edges, and making the authoring loop faster.

The runtime should stay small. Every improvement below is evaluated against that constraint.

---

## What's Actually Shipped vs. What's Documented

Before planning forward, a few gaps between the roadmap and the code:

- **Cross-file imports**: `loadImportedBlocks` exists in `validator.js` and the parser handles `import` declarations, but the runtime doesn't call `loadImportedBlocks` before execution — only the validator does. Imports work for validation but not for runtime block resolution.
- **Transform security**: `RUNEFLOW_DISABLE_TRANSFORM=1` exists as a kill switch but there's no sandboxing. `new Function(...)` runs in the host process with full access.
- **Unused imports in `runtime.js`**: `hasTemplateExpressions`, `looksLikeExpression`, `resolveTemplate` are imported but never used — dead code from a refactor.
- **`runeflow-registry`**: Scaffolded at `packages/runeflow-registry/` but not published and not wired into the main package.
- **Assembler limitation**: Only works when all pre-steps are `tool`, `transform`, or `branch`. Any `llm` step before the target throws. This is a real authoring constraint that isn't documented.
- **Parallel steps**: Only `tool` steps can be children. `llm` and `cli` steps can't be parallelized.

---

## Improvement Areas

### 1. Finish Cross-File Imports (High Value, Low Risk)

The parser and validator already handle `import blocks from "./shared.runeflow.md"`. The runtime doesn't. This is a one-function gap.

**What to do:**
- In `runtime.js`, call `loadImportedBlocks` before `resolveWorkflowBlocks`, same as the validator already does.
- Add a test: import a block from another file, run it, assert the output.
- Add an example: `examples/shared-blocks.runeflow.md` + `examples/shared-blocks-lib.runeflow.md`.

**Why now:** Cross-file imports unlock reusable block libraries, which is the most-requested authoring feature. The hard work (parser, validator, block resolution) is already done.

---

### 2. Parallel Step Expansion (Medium Value, Medium Risk)

Parallel steps are currently `tool`-only. The constraint exists because `llm` steps need a handler and `cli` steps need a shell. Both are available at runtime.

**What to do:**
- Lift the `tool`-only constraint in the parallel executor.
- Allow `llm` and `cli` steps as parallel children.
- Update the validator to allow these kinds inside parallel blocks.
- Add a test: parallel with mixed `tool` + `llm` children.

**Constraint to preserve:** Parallel children still can't reference each other's outputs (fan-out/join semantics). Document this clearly.

---

### 3. Transform Sandboxing (Security, Medium Effort)

`transform` steps run `new Function(...)` in the host process. This is fine for trusted authors but a real risk if skills come from untrusted sources (e.g., `runeflow-registry`, `runeflow build` output).

**What to do:**
- Evaluate `vm.runInNewContext` from Node's built-in `vm` module as a drop-in replacement. It's not a true sandbox but it prevents accidental global mutation.
- For a real sandbox, evaluate `isolated-vm` (V8 isolates). It's a native module — adds a dependency but gives true isolation.
- Short term: switch to `vm.runInNewContext` with a restricted context (no `process`, no `require`, no `fs`). This is a one-line change with meaningful security improvement.
- Long term: document the trust model clearly. `transform` steps are author-trusted. If you're running untrusted skills, disable transforms.

**Concrete change:**
```js
// Before
const outputs = new Function("input", `return (${step.expr})`)(resolvedInput);

// After
const { runInNewContext } = await import("node:vm");
const outputs = runInNewContext(`(${step.expr})`, { input: resolvedInput });
```

---

### 4. Retry With Backoff (Control Flow, Low Effort)

`retry=N` retries immediately. For transient failures (rate limits, network errors), immediate retry is often wrong.

**What to do:**
- Add optional `retry_delay` field (milliseconds, default 0).
- Add optional `retry_backoff` field (`linear` | `exponential`, default `linear`).
- Implement in the retry loop in `runtime.js`.
- Update validator to accept these fields.

**DSL shape:**
```runeflow
step call_api type=tool {
  tool: http.post
  retry: 3
  retry_delay: 1000
  retry_backoff: exponential
}
```

---

### 5. Structured Error Output on `fail` Steps (DX, Low Effort)

`fail` steps halt execution with a message. The message is a string. There's no way to attach structured data (e.g., which validation failed, what the actual value was).

**What to do:**
- Allow `fail` steps to have a `data` field (any object).
- Include `data` in the run artifact's `error` field.
- Update `dryrun` to show resolved `data`.

**DSL shape:**
```runeflow
step abort type=fail {
  message: "Validation failed for {{ inputs.pr_number }}"
  data: { pr_number: inputs.pr_number, reason: steps.check.reason }
}
```

---

### 6. `runeflow inspect-run` Improvements (DX, Low Effort)

The `inspect-run` command exists but the output format isn't documented and the CLI UX is minimal. Run artifacts are rich JSON — surfacing them well is high-leverage.

**What to do:**
- Add `--step <id>` flag to inspect a single step's artifact.
- Add `--format table` for a compact step timeline (id, kind, status, duration).
- Add `--format json` (already the default, just make it explicit).
- Show token usage from LLM steps if present in the artifact.

---

### 7. `runeflow test` Fixture Authoring (DX, Medium Effort)

The test runner is solid but writing fixtures by hand is tedious. A real run produces all the data needed for a fixture.

**What to do:**
- Add `runeflow run --record-fixture <path>` flag that writes a fixture JSON from a real run.
- The fixture captures: inputs, tool call outputs (as mocks), LLM outputs (as mocks), final status.
- Author reviews and edits the fixture, then uses it for regression testing.

This closes the loop: `run` → `record-fixture` → `test`.

---

### 8. Skill Discovery Convention (v0.6 Roadmap Item)

The roadmap mentions `.runeflow/skills/` as a discovery directory. This is the right idea but needs a concrete spec.

**What to do:**
- Define the convention: `.runeflow/skills/*.runeflow.md` in the project root.
- Add `runeflow skills list` command: scans the directory, prints name + description from frontmatter.
- Add `runeflow skills run <name>` as a shorthand for `runeflow run .runeflow/skills/<name>.runeflow.md`.
- Update `AGENTS.md` template to include the `.runeflow/skills/` entry so agents can find skills without being told the path.

---

### 9. Publish `runeflow-registry` (v0.6 Roadmap Item)

The package is scaffolded. The main gap is tests and wiring.

**What to do:**
- Add mock-based tests for each provider in `packages/runeflow-registry/test/`.
- Wire the registry into the main package: `loadToolRegistry` should check `runeflow-registry` providers if installed.
- Update README with install instructions.
- Publish to npm.

---

### 10. OpenTelemetry Spans (v0.7 Roadmap Item, Scoped Down)

Full OTel is heavy. A scoped version is achievable now.

**What to do:**
- Add optional `--telemetry` flag to `runeflow run`.
- When enabled, emit a span per step to stdout in OTLP JSON format (no SDK dependency).
- Each span: `trace_id`, `span_id`, `name` (step id), `start_time`, `end_time`, `attributes` (kind, status, tool name, token usage).
- This is zero-dependency and plugs into any OTel collector via file or pipe.
- Full SDK integration (`@opentelemetry/sdk-node`) can come later as an optional peer dependency.

---

### 11. Dead Code Cleanup (Hygiene, 30 Minutes)

- Remove unused imports in `runtime.js`: `hasTemplateExpressions`, `looksLikeExpression`, `resolveTemplate`.
- Remove unused `discoveredServer` parameter in the Composio plugin callback in `runtime-plugins.js`.
- Remove unused `SkillSyntaxError` import in `validator.js`.

These are lint hints that add noise and suggest incomplete refactors.

---

## Priority Order

| # | Item | Value | Effort | Risk |
|---|------|-------|--------|------|
| 1 | Finish cross-file imports (runtime) | High | Low | Low |
| 2 | Dead code cleanup | Low | Trivial | None |
| 3 | Transform sandboxing (`vm.runInNewContext`) | Medium | Low | Low |
| 4 | Retry with backoff | Medium | Low | Low |
| 5 | Structured `fail` data | Medium | Low | Low |
| 6 | `inspect-run` improvements | Medium | Low | Low |
| 7 | `run --record-fixture` | High | Medium | Low |
| 8 | Parallel `llm`/`cli` children | Medium | Medium | Medium |
| 9 | Skill discovery convention | High | Medium | Low |
| 10 | Publish `runeflow-registry` | High | Medium | Low |
| 11 | OTel spans (scoped) | Medium | Medium | Low |

---

## What Not to Build

Consistent with the existing roadmap:

- No loops or recursion. The ordered execution model is a feature, not a limitation.
- No arbitrary DAG scheduling. If you need a DAG, you need a different tool.
- No web editor or hosted runtime. The CLI + artifact model is the right abstraction level.
- No TypeScript rewrite. The JS runtime is intentional and the `.d.ts` file covers the public API.
- No general orchestration engine. Runeflow is a skill runtime, not Temporal.

---

## Open Questions (Carried Forward)

1. Should `runeflow-registry` providers auto-register schemas so `tools list` picks them up without a registry dir? (Yes, probably — the registry dir is friction.)
2. Should cross-file imports be eager (parse at load time) or lazy (resolve at step execution)? (Eager is simpler and catches errors earlier. Lazy is needed for conditional imports, which we don't have.)
3. `runeflow build` — single planner call or iterative refinement with `dryrun` feedback? (Iterative is better quality but more tokens. Start with single call, add `--refine` flag later.)
4. At what point does the caching layer need a storage backend beyond flat JSON? (When runs exceed ~10k artifacts. Not yet.)
5. Should `assemble` support skills with `llm` pre-steps by running them? (Yes, but it changes the contract — assemble would need a full runtime. Defer until there's a clear use case.)
