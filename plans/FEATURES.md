# Runeflow Feature Plan

Based on benchmark results and current implementation state. Three features, ordered by impact and implementation dependency.

---

## Feature 1: Lifecycle Hooks (`beforeStep` / `afterStep` / `onStepError`)

### Why first
Unlocks real operator use cases — approvals, telemetry, audit logs — without touching the DSL or adding language complexity. Pure runtime addition.

### What it does
Hosts can register hooks in the runtime object. The runtime calls them at defined points around each step. Hooks can observe, enrich context, or abort. They do not own sequencing.

### Runtime contract
```js
// Host provides in runtime object
{
  hooks: {
    beforeStep: async ({ runId, step, resolvedInput, resolvedPrompt, state }) => {
      // return { abort: true, reason: "..." } to stop the run
      // return nothing / undefined to continue
    },
    afterStep: async ({ runId, step, stepRun, state }) => {
      // observe outputs, write telemetry, etc.
    },
    onStepError: async ({ runId, step, error, attempts, state }) => {
      // called after all retries exhausted, before fallback/fail decision
    }
  }
}
```

### Implementation scope
- `src/runtime.js`: call hooks at the right points in the step execution loop
- Hook abort causes a clean `failRun` with the abort reason
- Hook errors are caught and treated as non-fatal warnings (logged to run artifact)
- Step artifact includes a `hook_events` array for observability
- No DSL changes, no validator changes

### Acceptance
- `beforeStep` can abort a run with a reason
- `afterStep` receives full step outputs
- `onStepError` fires after retries are exhausted
- Hook errors do not crash the run
- Artifacts show hook events

---

## Feature 2: Named Text Blocks (doc sections selectable per step)

### Why second
Makes the text side of the hybrid file a deliberate runtime input, not ambient noise. Directly reduces tokens sent to LLM steps by letting authors select only the relevant guidance per step. Extends the token reduction story beyond orchestration hiding.

### Authoring model
Authors tag sections in Markdown with a fenced `:::` directive:

````md
:::guidance[pr-tone]
Keep PR titles under 72 chars. Use imperative mood.
:::

:::guidance[diff-context]
Focus on behavioral changes, not style fixes.
:::
````

Then in a step:
```
step draft_pr type=llm {
  docs: pr-tone
  prompt: "Draft a PR title and body."
  schema: { title: string, body: string }
}
```

If `docs` is omitted, the step receives the full docs blob (current behavior, preserved).

### Implementation scope
- `src/parser.js`: extract named `:::guidance[name]` blocks from Markdown, store in `definition.docBlocks` map
- `src/runtime.js`: when projecting context to an `llm` step, resolve `step.docs` to the named block or fall back to full `definition.docs`
- `src/validator.js`: validate that `step.docs` references an existing named block
- Step artifact includes `projected_docs` field showing exactly what text was sent
- No breaking changes — files without named blocks behave identically

### Acceptance
- Named blocks parse correctly and are stored in `definition.docBlocks`
- `llm` step with `docs: block-name` receives only that block
- `llm` step without `docs` receives full docs (unchanged)
- Validator rejects unknown `docs` references
- Step artifact shows `projected_docs`
- Existing examples pass validation unchanged

---

## Feature 3: `transform` Step Kind

### Why third
Fills the gap between tool outputs and LLM inputs without burning tokens. Deterministic JS expression applied to reshape, filter, or map data inline. No LLM, no tool call, no network.

### Authoring model
```
step filter_open type=transform {
  input: steps.list_prs.items
  expr: "input.filter(pr => pr.state === 'open').slice(0, 5)"
  out: { type: object, properties: { items: { type: array } } }
}
```

`input` is the resolved value passed as `input` inside the expression. `expr` is a safe JS expression string evaluated by the runtime (no `eval` — use `new Function`). `out` declares the output schema for downstream reference checking.

### Implementation scope
- `src/runtime.js`: handle `kind === "transform"`, resolve `step.input`, evaluate `step.expr` via `new Function("input", expr)`, validate output against `step.out`
- `src/validator.js`: validate `transform` steps have `input`, `expr` (string), and `out` schema
- `src/parser.js`: `type=transform` already flows through as `kind` — no parser changes needed
- Expression is sandboxed: only receives `input`, no access to `state` or globals

### Acceptance
- `transform` step filters/maps data correctly
- Output is validated against `out` schema
- Downstream steps can reference `steps.transform_step.field`
- Validator rejects missing `expr` or `out`
- Malformed expressions produce a clean `RuntimeError`, not a crash

---

## Implementation Order

```
Feature 1 (hooks)     → runtime.js only, no DSL impact, ships fast
Feature 2 (doc blocks) → parser + runtime + validator, medium scope
Feature 3 (transform)  → runtime + validator, small scope
```

Each feature is independently shippable. Start with hooks, then doc blocks, then transform.

## Files Touched Per Feature

| File | F1 hooks | F2 doc blocks | F3 transform |
|---|---|---|---|
| `src/runtime.js` | ✅ | ✅ | ✅ |
| `src/parser.js` | — | ✅ | — |
| `src/validator.js` | — | ✅ | ✅ |
| `src/schema.js` | — | — | — |
| `src/expression.js` | — | — | — |
| `test/runtime.test.js` | ✅ | ✅ | ✅ |
| `test/validator.test.js` | — | ✅ | ✅ |
| `test/parser.test.js` | — | ✅ | — |
| `examples/` | — | update one example | add one example |
