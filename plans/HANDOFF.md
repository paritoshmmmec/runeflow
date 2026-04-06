# Session Handoff

## What Was Built This Session

### Features shipped (all tested, 54/54 passing)
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError` — optional, non-fatal
- Named doc blocks (`:::guidance[name]:::`) with per-step `docs:` projection
- `transform` step kind — deterministic JS expression for data reshaping
- `block` template declarations — reusable step definitions expanded at parse time
- `const` in frontmatter — shared values referenced as `const.key` anywhere
- `matches` operator — regex branch conditions (`value matches "^feat/"`)
- `skip_if` on steps — lightweight guard without a full branch step

### Benchmarks added
- `addresszen-automation` eval — -82% input tokens, both OpenAI and Cerebras
- `benchmark_report.md` updated with all 4 tasks

### Plans consolidated
- `plans/ROADMAP.md` — single source of truth, replaces PLAN.md + FEATURES.md + ALPHA.md
- `plans/PRD.md` — product vision, top-level executor, phase roadmap
- `plans/ATTACK.md` — ordered execution plan for Wave 1 alpha gate

---

## Current State

- 54 tests passing
- All examples and eval skills validate clean
- Runtime: `tool`, `llm`, `branch`, `transform`, `block` steps
- CLI: `validate`, `run`, `inspect-run`, `import`
- Built-in tools: `git.*`, `file.exists`, `util.*`
- Tool registry: GitHub, Linear (output schema auto-derived)

---

## Next Steps (Wave 1 — Alpha Gate)

Pick up from item 4 in `plans/ATTACK.md`:

### 4. State Management & Fault Tolerance (alpha blocker)

Run artifacts already exist per step. What's missing:

- **`halted_on_error` run status** — when a step fails with no fallback, mark the run artifact `status: "halted_on_error"` instead of just `"failed"`. Includes the failed step id so resume knows where to restart.
- **`runeflow resume <skill>`** CLI command — reads the most recent run artifact for the skill, skips all `success` steps (loading their cached outputs into state), retries from the `halted_on_error` step
- **Input-hash caching** — before executing a step, hash its resolved inputs. If hash matches the previous run's step artifact, skip execution and load cached outputs. `cache: false` opt-out for steps with side effects.

Implementation touches: `src/runtime.js` (halted_on_error status, hash computation), `src/cli.js` (resume command)

### 5. `runeflow tools list` + `runeflow tools inspect <tool>` (alpha blocker)
- Add metadata (name, description, inputSchema) to built-in tools in `src/builtins.js`
- Add `tools list` and `tools inspect <name>` subcommands to `src/cli.js`
- `tools list` prints all built-ins + registry tools with name and description
- `tools inspect <name>` prints input schema, output schema, description
- Without this, new users must read source code to know what tools exist

### 6. Third example skill
- Recommended: release notes drafting
- Files: `examples/release-notes.runeflow.md` + `examples/release-notes-runtime.js`
- Should use `git` built-ins + one `llm` step + `transform` to show the full model
- Add `npm run eval:release-notes` script

### 7. README rewrite
- Structure: what it is → benchmark numbers → 5-minute quickstart → supported step kinds → CLI reference
- Add `jsconfig.json` for JS type checking
- Note: "runtime is JS, skill files are typed via the validator"
- Add llm.js as an optional example runtime (`examples/llmjs-runtime.js`) showing multi-provider wiring

---

## Wave 2 (after alpha ships)
- `cli` step kind — shell command via `child_process`
- `human_input` step kind — pause for terminal input
- Auth waterfall — env → .env → `~/.runeflow/credentials.json`
- `runeflow assemble` — preprocessor command for agent integration

## Wave 3 (after Wave 2)
- MCP server (`runeflow-mcp`)
- `runeflow build` — planner LLM compiles English → runeflow block
- Skill discovery convention

---

## Key Decisions Made

- LLM never calls tools — runtime owns all tool execution, LLM produces structured JSON only
- llm.js as optional example runtime, not a core dependency
- JS runtime stays as-is, TypeScript noted in README
- Alpha = public for feedback, not feature complete
- Integration (MCP, agent preprocessor) is more valuable than standalone features long-term

---

## Files to Know

| File | Purpose |
|---|---|
| `src/runtime.js` | Execution engine |
| `src/parser.js` | Frontmatter + DSL parsing, doc blocks, const |
| `src/expression.js` | Expression evaluation, matches, const paths |
| `src/validator.js` | Static validation, reference checking |
| `src/blocks.js` | Block template expansion |
| `src/builtins.js` | Built-in tools (needs metadata for tools CLI) |
| `src/cli.js` | CLI commands (needs tools list/inspect) |
| `plans/PRD.md` | Product vision and phase roadmap |
| `plans/ROADMAP.md` | Full roadmap, single source of truth |
| `plans/ATTACK.md` | Ordered execution plan |
| `benchmark_report.md` | All 4 benchmark results |
