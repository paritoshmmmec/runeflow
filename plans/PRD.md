# Runeflow PRD: Top-Level Executor

## Vision

Runeflow is a strict, deterministic runtime for hybrid AI skills. It solves the LLM orchestration problem by treating LLMs as bounded processors — the runtime owns 100% of workflow logic, state, and tool execution. The LLM only participates where explicitly declared.

The preprocessor insight: before any agent (Claude Code, Codex, Cursor) calls an LLM, Runeflow assembles exactly the context that step needs. No orchestration instructions, no tool discovery boilerplate, no ambient noise. Just the resolved prompt, the relevant docs, and the output schema.

---

## Current State (What's Built)

- Step kinds: `tool`, `llm`, `branch`, `transform`, `block`
- Control flow: `retry`, `fallback`, `fail`, `next`, `skip_if` (planned)
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError`
- Named doc blocks with per-step projection
- `{{ }}` interpolation in all string fields
- Schema validation on all outputs
- JSON run + step artifacts
- CLI: `validate`, `run`, `inspect-run`, `import`
- Built-in tools: `git.*`, `file.exists`, `util.*`
- Tool registry: GitHub, Linear
- Benchmarks: -82% tokens on MCP tasks, -38% on synthesis tasks

---

## New Step Types (v0.2 additions)

### `cli` step — shell command execution

Runs a terminal command natively via `child_process`. Output is captured as stdout/stderr.

```
step get_logs type=cli {
  command: "kubectl logs pod/kafka-worker-1 --tail=50"
  out: { stdout: string, exit_code: number }
}
```

- Non-zero exit code triggers retry/fallback/fail like any other step
- `cache: false` opt-out for steps with side effects (POST requests, writes)
- Default: cached by input hash (see caching section)

### `human_input` step — pause for terminal input

Pauses execution, prompts the user, resumes with their answer.

```
step confirm type=human_input {
  prompt: "Deploy to production? (yes/no)"
  choices: ["yes", "no"]
  out: { answer: string }
}
```

- Supports free text or constrained choices
- State is persisted before pausing so resume works correctly
- Useful for approval gates without needing a full hook setup

---

## Auth Waterfall

For `llm` steps, credentials are resolved in this order:

1. Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
2. Local `.env` file in cwd
3. Global config at `~/.runeflow/credentials.json`

If credentials are missing, fail fast before execution starts with a clear message:
```
Missing OPENAI_API_KEY for step 'draft_pr'. Export it or add it to your .env file.
```

Provider-to-key mapping:
```js
const authMap = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  ollama: null, // local, no auth needed
};
```

---

## Caching (Lazy-First)

Every step is cached by default. Before executing a step, hash its resolved inputs. If the hash matches the previous run, skip execution and load the cached artifact.

```
step summarize type=llm {
  prompt: "Summarize: {{ steps.get_logs.stdout }}"
  schema: { summary: string }
  # cache: true  ← implicit default
}

step fetch_live type=cli {
  command: "curl https://api.example.com/status"
  out: { stdout: string, exit_code: number }
  cache: false  # always re-run
}
```

Cache invalidation is automatic — if an upstream step's output changes, the downstream step's input hash changes, forcing a fresh run. No manual cache management needed.

Global override:
```bash
runeflow run skill.md --force   # bypass all caches
```

---

## Resumability

Every run writes state to `.runeflow-runs/<run_id>.json` after each step. If execution halts (non-zero exit, auth failure, network error), the state file is marked `halted_on_error`.

```bash
runeflow resume skill.md   # reads state, skips completed steps, retries from failure point
```

This is already partially implemented (run artifacts exist). Resume command needs to be added to the CLI.

---

## Preprocessor Mode (The Integration Play)

The highest-leverage integration with Claude Code, Codex, Cursor, and other agents.

```bash
runeflow assemble skill.md --step draft_pr --input '{"base_branch":"main"}'
```

Outputs a clean Markdown file containing only:
- The docs relevant to the current step (named block projection)
- The resolved inputs
- The output schema the LLM needs to produce
- No execution block, no tool discovery, no workflow boilerplate

The agent loads this assembled file instead of the raw skill. The LLM sees a tight, focused context. This is the token reduction mechanism made available as a preprocessing step — no agent integration required, works with any system that reads files.

---

## Phase Roadmap

### Now — Alpha Gate
- `runeflow tools list` / `runeflow tools inspect`
- Third example skill (release notes or issue-to-plan)
- README rewrite with 5-minute quickstart
- `const` in frontmatter, `matches` operator, `skip_if`

### v0.2 — Top-Level Executor
- `cli` step kind
- `human_input` step kind
- `runeflow resume` command
- Auth waterfall with clear error messages
- Input-hash-based caching with `cache: false` opt-out
- `runeflow assemble` preprocessor command

### v0.3 — Agent Integration
- MCP server (`runeflow-mcp`) exposing `runeflow_run` as a tool
- Claude Code / Cursor / Codex integration investigation
- `runeflow build` — planner LLM compiles English skill description into runeflow block
- Skill discovery convention (`.runeflow/skills/` + `AGENTS.md`)

### Future
- Native binary (Rust/Go) for zero-dependency distribution
- Embedded local model for offline `llm` steps
- npm publish after alpha feedback

---

## What We're Not Building

- Loops, recursion, arbitrary DAGs
- General orchestration engine
- Model-interpreted execution semantics
- Web editor or hosted runtime
- TypeScript SDK (JS runtime is sufficient for now)

---

## Open Questions

- How do Claude Code, Codex, and Cursor actually load skill files today — as raw context or as tools? This determines whether `runeflow assemble` is the right integration point or whether a tool/MCP approach is needed.
- Should `cli` steps have a timeout by default? What's the right default?
- Should `human_input` steps be skippable in CI mode (`--non-interactive` flag)?
- At what point does the caching layer need its own storage backend vs flat JSON files?
