# Session Handoff

## Current State

**74 tests passing. Published to npm as `runeflow@0.1.0`.**

---

## What's Shipped (complete feature list)

### Runtime
- Step kinds: `tool`, `llm`, `branch`, `transform`, `block`, `cli`
- Control flow: `retry`, `fallback`, `fail`, `next`, `skip_if`
- `const` in frontmatter — shared values as `const.key`
- `matches` operator — regex branch conditions
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError`
- Named doc blocks (`:::guidance[name]:::`) with per-step `docs:` projection
- `{{ }}` interpolation in all string fields
- Schema validation on all step inputs (registry-backed) and outputs
- `halted_on_error` run status with `halted_step_id`
- Input-hash caching with `cache=false` opt-out
- JSON artifacts for every run and step

### CLI
- `validate`, `run`, `resume`, `inspect-run`, `import`
- `tools list` / `tools inspect <name>`
- `assemble` — renders a clean context file for a specific llm step (agent integration)

### Built-in tools
- `git.current_branch`, `git.diff_summary`, `git.push_current_branch`
- `git.log`, `git.tag_list`
- `file.exists`, `file.read`, `file.write`
- `util.complete`, `util.fail`

### Registry
- Built-in registry loads from package root (not cwd) — works when installed via npm
- User registry at `<project>/registry/tools/` merges on top — user entries win
- Registry schemas: GitHub, Linear, gh CLI, npm, docker, kubectl, curl
- Input validation at runtime against registry `inputSchema`
- `getToolInputSchema` exported from `tool-registry.js`

### Default runtime
- `createDefaultRuntime()` — handles cerebras, openai, anthropic out of the box
- Exported from `runeflow` package

### Assembler
- `assembleRuneflow(definition, stepId, inputs, runtime, options)` — exported
- Runs tool/transform pre-steps, resolves prompt, renders clean Markdown for agents

### Examples
- `open-pr.runeflow.md` — PR prep
- `review-draft.runeflow.md` — code review notes
- `release-notes.runeflow.md` — release notes with transform + const
- `block-demo.runeflow.md` — reusable block templates
- `open-pr-gh.runeflow.md` — full end-to-end with `cli` step + `gh pr create`

### Infrastructure
- Published: `npm install runeflow` / `npm install -g runeflow`
- CI: `.github/workflows/ci.yml` — runs tests + validates examples on every push
- Publish: `.github/workflows/publish.yml` — publishes on git tag push
- LICENSE (MIT), CONTRIBUTING.md

---

## Todo List

### High priority (Wave 2 remaining)

**`human_input` step kind**
- Pauses execution, prompts terminal user, resumes with answer
- Supports free text or constrained `choices: [...]`
- State persisted before pause so `resume` works correctly
- Touches: `src/runtime.js`, `src/validator.js`, `src/cli.js` (needs interactive stdin)
- Useful for approval gates: `"Deploy to production? (yes/no)"`

**Auth waterfall**
- Credentials resolved: env vars → `.env` → `~/.runeflow/credentials.json`
- Fail fast before execution with clear message: `Missing OPENAI_API_KEY for step 'draft'`
- Provider map: `{ openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", cerebras: "CEREBRAS_API_KEY" }`
- Touches: `src/default-runtime.js` (already reads env), `src/runtime.js` (pre-flight check)

**`runeflow-registry` package** (separate npm package)
- Schema + implementation travel together — no more split between registry JSON and user runtime.js
- Structure: `providers/github/`, `providers/linear/`, `providers/slack/`, `providers/notion/`
- Each provider exports `{ tools(config), schemas }`
- Usage: `import { github } from "runeflow-registry"; tools: github({ token })`
- Auth passed at construction time, not via env vars inside tools
- See sketch in ROADMAP.md

### Medium priority (Wave 3)

**MCP server (`runeflow-mcp`)**
- Exposes `runeflow_run` as an MCP tool
- Any MCP-compatible agent (Claude Code, Cursor, Codex) can execute skills directly
- Closes the loop on the token reduction story for agent integration

**`runeflow build`**
- Planner LLM compiles English skill description → runeflow block
- `runeflow build "draft a PR from the current branch" --output draft-pr.runeflow.md`

**Skill discovery convention**
- Standard location: `.runeflow/skills/`
- Convention in `AGENTS.md` so agents find and execute skills without explicit config

### Low priority / future

**`--force` flag on `run`** — bypass all caches for a fresh run
**Parallel `tool` steps** — fan out N tool calls, join outputs
**Better error messages** — suggest available block names, actual output fields
**Skill composition / imports** — include sub-skills from other files
**Native binary** — Rust/Go for zero-dependency distribution

---

## User-Provided Schemas

Two ways users can extend the registry today:

**1. Project-level registry directory**

Drop JSON schema files in `<project>/registry/tools/`. They merge on top of the built-in registry. User entries win on name collision.

```
my-project/
└── registry/
    └── tools/
        ├── stripe.charge.json
        └── sendgrid.send_email.json
```

Each file follows the same format as the built-in schemas:
```json
{
  "name": "stripe.charge",
  "description": "Create a Stripe charge.",
  "tags": ["stripe", "payments"],
  "inputSchema": { ... },
  "outputSchema": { ... }
}
```

**2. Programmatic `toolRegistry` option**

Pass schemas inline when calling `runRuneflow` or `validateRuneflow`:

```js
import { runRuneflow } from "runeflow";

await runRuneflow(definition, inputs, runtime, {
  toolRegistry: [
    {
      name: "stripe.charge",
      description: "Create a Stripe charge.",
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number" },
          currency: { type: "string" },
        },
        required: ["amount", "currency"],
      },
      outputSchema: {
        type: "object",
        properties: {
          charge_id: { type: "string" },
          status: { type: "string" },
        },
        required: ["charge_id", "status"],
      },
    },
  ],
});
```

The `toolRegistry` option accepts a Map, array, or plain object — same as `normalizeToolRegistry`.

---

## Files to Know

| File | Purpose |
|---|---|
| `src/runtime.js` | Execution engine — step dispatch, caching, artifacts |
| `src/parser.js` | Frontmatter + DSL parsing, doc blocks, const |
| `src/expression.js` | Expression evaluation, matches, const paths |
| `src/validator.js` | Static validation, reference checking |
| `src/blocks.js` | Block template expansion |
| `src/builtins.js` | Built-in tool implementations |
| `src/cli.js` | CLI commands |
| `src/assembler.js` | Agent context assembly |
| `src/default-runtime.js` | Default LLM runtime (cerebras/openai/anthropic) |
| `src/tool-registry.js` | Registry loading — package root + user merge |
| `registry/tools/` | Built-in tool schemas |
| `examples/` | Reference skills and runtimes |
| `eval/` | Benchmark harnesses |
| `test/` | Behavior tests |
| `plans/ROADMAP.md` | Full roadmap |
| `.github/workflows/` | CI + publish automation |
