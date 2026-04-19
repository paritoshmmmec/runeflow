# Runeflow Roadmap

This roadmap is directional, not a release promise. It is meant to keep the
project focused while the runtime is still evolving.

The core constraint does not change:

- keep the runtime small
- prefer explicit behavior over clever abstraction
- optimize for authoring clarity and inspectability
- avoid turning Runeflow into a general-purpose orchestration platform

---

## Current Shape

Runeflow already has the core loop we want:

- Markdown-first workflow files with a fenced `runeflow` block
- a narrow workflow model: `cli`, `llm`, `tool`, `transform`, `branch`,
  `parallel`, `human_input`, `block`, `fail`
- runtime-owned sequencing, validation, retries, and artifacts
- zero-install default LLM path: Claude Code if available, otherwise AI Gateway
- repo-local authoring loop: `validate`, `dryrun`, `run`, `inspect-run`, `test`
- scenario-based DX evaluation to measure whether authoring is getting simpler

That means the next phase is not “add more surface area.” It is:

1. reduce authoring friction
2. improve runtime reliability on real tasks
3. tighten evaluation so DX regressions are visible early

---

## Now

These are the highest-leverage improvements for the next stretch of work.

### 1. Tighten authoring DX

- `runeflow dryrun` diff mode
  Show what changed in the resolved plan between revisions instead of dumping the
  full plan every time.
- Better `runeflow init` output
  Bias generated skills toward the minimum-surface path: `cli` first, omitted
  `llm:` frontmatter by default, simpler examples, and fewer unnecessary knobs.
- Scenario coverage expansion
  Add more small end-to-end scenarios so “is authoring easier?” becomes a
  routine check rather than a guess.
- README and examples tightening
  Keep the docs centered on the narrow workflow model and the zero-install LLM
  story. Remove drift toward “framework for everything.”

### 2. Improve runtime reliability

- Step timeouts
  Add `timeout_ms` so a hung `cli`, tool, or LLM call does not block a run
  indefinitely.
- Retry jitter
  Add optional jitter to backoff to avoid thundering-herd retries under API
  rate limiting.
- Structured `cli` JSON mode
  Support `parse: json` on `cli` steps so common command outputs do not require
  an extra `transform` step just to deserialize.
- Better parallel error policy
  Add an explicit policy for partial failure in `parallel` groups instead of
  treating every child failure as a full stop.

### 3. Make evaluation more trustworthy

- Fixture-based eval expansion
  Grow the deterministic eval path so CI can catch behavior regressions without
  relying on live APIs.
- Scenario harness hardening
  Keep Loop A and Loop B aligned so “working skill” really means validate +
  fixture-backed test + concept budget.
- Token and cost visibility
  Surface token counts and cost-adjacent info more clearly in inspect and eval
  flows so prompt changes are easier to reason about.

---

## Next

These are likely after the “Now” items, but still fit the current product
direction cleanly.

### Authoring model improvements

- First-class frontmatter `const`
  Surface shared values more explicitly at the top of a file.
- Named reusable schemas
  Reduce repetition for repeated `out` / `schema` shapes.
- Import shared constants and schemas
  Extend the current import story beyond block templates where it clearly lowers
  duplication without adding hidden behavior.
- `skip_if` on parallel children
  Let individual children opt out cleanly inside a `parallel` group.

### Observability improvements

- token counts in `inspect-run --format table`
- side-by-side run comparison
- better display of large `cli` outputs
- clearer failure summaries for resumed or partially replayed runs

### Ecosystem improvements

- targeted `runeflow-registry` expansion
  Focus on high-value providers, not breadth for its own sake.
- GitHub Action wrapper
  Make common CI automation paths easier to adopt.
- lightweight sharing/install story
  A way to package and reuse repo-local skills without pushing everything
  through npm.

---

## Later

These are reasonable extensions, but they are not on the critical path right
now.

### Human-in-the-loop beyond the CLI

- webhook-backed `human_input`
- cleaner resume flows for async approvals
- stronger audit trail around who answered what and when

### Tooling and editor support

- VS Code syntax support and inline validation
- better step-level code lenses or “run selection” ergonomics
- richer example packs and templates

### Benchmarking and regression tracking

- broader task coverage across examples and scenarios
- token-reduction leaderboard over time
- nightly provider coverage on fixture-backed tasks

---

## Future Bets

These are intentionally further out. They may happen, but only if they still
fit the small-runtime philosophy once the current model settles.

### Optional hosted artifacts

A remote artifact store could make sharing and audit easier, but only after the
local artifact model is stable and useful on its own.

### Sharper agent handoff workflows

`assemble` is the current wedge. A future version could improve step-specific
handoff contracts, but without turning Runeflow into a multi-agent framework.

### Narrow hosted automation helpers

There may be room for thin wrappers around scheduled or CI execution, but not a
hosted Runeflow control plane and not a general “cloud workflow product.”

---

## Explicitly Out Of Scope

These are not the direction:

- loops and recursion in the workflow model
- arbitrary DAG scheduling
- a visual workflow builder
- a no-code automation platform
- a general multi-agent autonomy framework
- a hosted multi-tenant runtime as the core product
- large breaking DSL changes without a migration path

If an idea pulls the project toward those shapes, the default answer should be
no unless there is a very strong reason otherwise.
