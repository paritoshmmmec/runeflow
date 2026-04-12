# Runeflow Roadmap

This document captures future work and enhancements. It is organized by theme, not by release. Items within each theme are roughly priority-ordered.

The guiding principle stays the same: small runtime, explicit design, experimentation-first. Nothing here should compromise that.

---

## Theme 1 — Developer Experience ✅

The core loop (validate → dryrun → run → inspect) is solid. The gaps are in onboarding friction and feedback quality.

### `runeflow init` smoke test in CI ✅
Added to `.github/workflows/ci.yml` — runs `runeflow init --no-local-llm --force` in a temp git repo and validates the generated output on every push.

### Better error messages at parse time ✅
`SkillSyntaxError` now accepts `{ line, hint }` context. Errors include the offending line number, a code snippet pointer, and a plain-English hint. Covered cases: unterminated blocks, invalid step headers, missing `type=`, invalid branch declarations, unsupported block types.

### `runeflow validate --watch` ✅
`runeflow validate <file> --watch` re-validates on every save using chokidar. Prints a fresh result on each change. Exit with Ctrl-C.

### `runeflow run --verbose` ✅
`runeflow run <file> --verbose` prints each step's resolved inputs and outputs to stderr after the run completes, without requiring a separate `inspect-run` call.

### `runeflow dryrun` diff mode
When a skill file changes, show what changed in the resolved step plan — not just the full plan. Useful for iterating on prompts and expressions without re-reading the whole output.

---

## Theme 2 — Runtime Reliability

The execution engine is stable. These are the rough edges that surface in real use.

### Retry with jitter
`retry_backoff` is supported but jitter is not. Under concurrent runs hitting the same rate-limited API, pure exponential backoff causes thundering herd. Add optional jitter to the backoff calculation.

### Timeout per step
No per-step timeout today. A hung tool call or slow LLM response blocks the entire run indefinitely. Add `timeout_ms` as a step-level option that halts the step with a structured error after the deadline.

### `human_input` web hook mode
Currently `human_input` either reads from `--prompt` values or halts the run. Add a `webhook` mode where the runtime POSTs the prompt to a URL and polls for a response. Enables async human-in-the-loop without requiring the CLI to stay open.

### Structured output for `cli` steps
`cli` steps capture `stdout` as a raw string. Add an optional `parse: json` field that attempts `JSON.parse(stdout)` and validates against `out`. Eliminates the need for a `transform` step after every `cli` step that returns JSON.

### `parallel` step error policy
Currently any child failure halts the parallel group. Add `on_error: continue` to let the group finish and surface per-child errors in the step outputs, letting downstream steps decide what to do.

---

## Theme 3 — Authoring Model

The DSL is intentionally narrow. These additions stay within that constraint.

### `const` blocks in frontmatter
`const` is already supported in the expression layer but not surfaced as a first-class frontmatter key. Promote it so authors can declare shared values (model names, thresholds, URLs) at the top of the file without embedding them in step bodies.

### Named output schemas
Repeating the same schema shape across multiple steps is noisy. Allow `schemas:` in frontmatter to declare reusable schema objects, referenced by name in `out` and `schema` fields.

### `skip_if` on `parallel` children
`skip_if` works on top-level steps but not on children inside a `parallel` block. Extend it so individual parallel children can be conditionally skipped based on inputs or prior step outputs.

### Multi-file `const` and schema imports
`import blocks from` works for block templates. Extend the import syntax to cover `const` and named schemas from shared files. Enables team-level shared config without copy-paste.

---

## Theme 4 — Observability

Telemetry exists (`--telemetry` emits OTLP spans). The gaps are in usability and coverage.

### Token usage in `inspect-run --format table`
Token counts are written to step artifacts but not shown in the table view. Add a `tokens` column so cost is visible at a glance without drilling into individual step artifacts.

### Run comparison
`runeflow compare-runs <run-id-a> <run-id-b>` — diff two runs of the same skill side by side. Shows which steps changed status, which outputs changed, and token delta. Useful for regression testing after prompt changes.

### Structured log output for `cli` steps
`cli` step stdout/stderr is stored as a raw string. Add optional line-by-line structured capture so long command outputs are navigable in `inspect-run` without scrolling through a blob.

### Cost estimation in `dryrun`
Given a known model and token pricing table, estimate the cost of a run before executing it. Rough but useful for skills with many LLM steps or large inputs.

---

## Theme 5 — Ecosystem

These are integrations and packaging improvements that make Runeflow easier to adopt.

### `runeflow-registry` expansion
Current providers: GitHub, Linear, Slack, Notion. High-value additions:
- `jira` — issue creation and status updates
- `pagerduty` — incident creation and escalation
- `datadog` — metric queries and monitor status
- `stripe` — charge and subscription lookups (read-only)

Each addition needs a schema JSON, a tools implementation, and a test.

### `runeflow publish` command
Package a `.md` skill file and its runtime into a shareable artifact (tarball or gist). Enables sharing skills without publishing to npm. Pairs with a future `runeflow install <url>` to pull them down.

### VS Code extension
Syntax highlighting for the `runeflow` fenced block, inline validation on save, and a "Run step" code lens. The DSL is simple enough that a TextMate grammar covers most of it.

### GitHub Action
`runeflow-action` — a GitHub Action that runs a skill file on push, PR, or schedule. Wraps `runeflow run` with sensible defaults for `GITHUB_TOKEN`, `runs-dir` as an artifact, and step summary output. Eliminates the need to write custom workflow YAML for common CI automation patterns.

### Hosted run artifacts (optional, later)
Today artifacts live in `.runeflow-runs/` on disk. A future `--remote-runs` flag could push artifacts to a simple hosted store for sharing and audit. This is explicitly out of scope until the local model is stable.

---

## Theme 6 — Eval and Benchmarking

The benchmark harness is prototype-quality. These improvements make it repeatable and trustworthy.

### Deterministic fixture-based evals
Current evals hit live APIs. Add a fixture mode that replays recorded LLM and tool responses so evals run in CI without API keys and produce stable results.

### Expand task coverage
Current tasks: `open-pr`, `3p-updates`, `adyntel-automation`, `addresszen-automation`. Add:
- `release-notes` — multi-step synthesis with transform
- `stale-pr-triage` — branch + classification
- `notify-slack` — registry tool integration

### Token reduction leaderboard
Track input token reduction per task across versions. Regressions in token efficiency should be visible in CI the same way test failures are.

### Provider coverage in CI
Currently evals run manually. Add a nightly CI job that runs the fixture-based evals against all 6 providers and posts a summary to a run artifact.

---

## What stays out of scope

These are explicitly not planned:

- Loops and recursion in the workflow model
- Arbitrary DAG scheduling
- Visual workflow builder
- Hosted runtime or multi-tenant execution
- TypeScript rewrite (JS is intentional for now)
- Breaking DSL changes without a migration path
