# Runeflow Roadmap

## What Runeflow Is

A hybrid runtime for executable AI skills. A skill is one file combining:
- human-readable Markdown guidance
- a fenced `runeflow` execution block
- JSON artifacts for every run and step

The runtime owns execution semantics. The LLM participates only inside bounded `llm` steps.

## Core Thesis (Proven)

- **-82% input tokens** on orchestration-heavy MCP tasks
- **-38% input tokens** on synthesis tasks
- **Zero-shot failure prevention** — raw skills fall into tool discovery loops; Runeflow eliminates this entirely
- **Neutral overhead** on simple tasks
- **PR #1 to this repo was opened by Runeflow itself** — using `open-pr-gh.runeflow.md`

---

## Shipped (v0.1.x)

### Step kinds
`tool`, `parallel`, `llm`, `branch`, `transform`, `block`, `cli`, `human_input`

### Control flow
`retry`, `fallback`, `fail`, `next`, `skip_if`, `cache=false`, `allow_failure`, `--force`

### Authoring
- `const` in frontmatter
- `matches` operator in expressions
- Named doc blocks with per-step projection
- `{{ }}` interpolation everywhere
- Block templates

### Runtime
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError`
- `halted_on_error` status + `halted_step_id`
- `halted_on_input` status + `pending_input`
- Input-hash caching + `runeflow resume`
- Schema validation on inputs (registry-backed) and outputs
- Auth waterfall: env → `.env` → `~/.runeflow/credentials.json`
- JSON artifacts per run and step

### CLI
`init`, `validate`, `run` (+ `--force`, `--prompt`), `resume`, `watch`, `inspect-run`, `import`, `tools list`, `tools inspect`, `assemble`

### Built-in tools (10)
`git.current_branch`, `git.diff_summary`, `git.push_current_branch`, `git.log`, `git.tag_list`,
`file.exists`, `file.read`, `file.write`, `util.complete`, `util.fail`

### Registry
- Loads from package root — works when installed via npm
- User registry at `<project>/registry/tools/` merges on top
- Programmatic `toolRegistry` option for inline schemas
- Schemas: GitHub, Linear, gh CLI, npm, docker, kubectl, curl

### Default runtime
`createDefaultRuntime()` — powered by Vercel AI SDK, supports cerebras, openai, anthropic, groq, mistral, google

### Assembler
`assembleRuneflow()` — renders clean context file for a specific llm step (agent integration)

### runeflow-registry (scaffolded, not yet published)
`packages/runeflow-registry/` — github, linear, slack, notion providers with schemas + implementations

---

## Remaining before Wave 3

### 1. Publish `runeflow-registry` to npm
The package is scaffolded at `packages/runeflow-registry/`. Needs:
- Tests for each provider (mock the SDK calls)
- `npm publish` from `packages/runeflow-registry/`
- Add to README install instructions

---

## Wave 3 — Agent Integration (v0.3)

### MCP server (`runeflow-mcp`)
Exposes `runeflow_run` as an MCP tool. Any MCP-compatible agent (Claude Code, Cursor, Codex) executes skills directly — no preprocessing step, no file handoff.

```json
{ "tool": "runeflow_run", "arguments": { "skill": "./draft-pr.runeflow.md", "inputs": { "base_branch": "main" } } }
```

Highest leverage integration item. Closes the loop on the token reduction story.

### `runeflow build`
Planner LLM compiles English → runeflow block.
```bash
runeflow build "draft a PR from the current branch" --output draft-pr.runeflow.md
```

### Skill discovery convention
Standard location: `.runeflow/skills/` + convention in `AGENTS.md`.
Agents find and execute skills without explicit configuration.

---

## Wave 4 — Scale & DX (v0.4)

### `runeflow test`
Test harness for skills. Run with fixture inputs, assert on outputs, mock LLM responses.

```bash
runeflow test ./draft-pr.runeflow.md --fixture ./tests/draft-pr.fixture.json
```

### Skill composition / imports
One skill calling another, or sharing block libraries across files.

```runeflow
import blocks from "./shared/pr-blocks.runeflow.md"
```

### TypeScript types
`types/index.d.ts` — full type coverage for `runRuneflow`, `createDefaultRuntime`, `assembleRuneflow`. Zero runtime cost, full IDE autocomplete.

### Observability
`--telemetry` flag emits OpenTelemetry spans per step. Plugs into Datadog, Honeycomb, Grafana.

### Skill versioning + migration
`runeflow migrate` updates skill syntax when the DSL changes.

---

## Integration Modes (all three supported)

| Mode | Status | How |
|---|---|---|
| Top-level executor | ✅ | `runRuneflow()` or `runeflow run` |
| Assemble (preprocessor) | ✅ | `runeflow assemble` → agent loads context file |
| MCP server | 🔜 v0.3 | `runeflow-mcp` exposes `runeflow_run` as MCP tool |

---

## User-Provided Schemas

**Project-level directory** — drop JSON files in `<project>/registry/tools/`:
```json
{
  "name": "stripe.charge",
  "inputSchema": { "type": "object", "properties": { "amount": { "type": "number" } }, "required": ["amount"] },
  "outputSchema": { "type": "object", "properties": { "charge_id": { "type": "string" } }, "required": ["charge_id"] }
}
```

**Programmatic** — pass `toolRegistry` to `runRuneflow` / `validateRuneflow`:
```js
await runRuneflow(definition, inputs, runtime, {
  toolRegistry: [{ name: "stripe.charge", inputSchema: { ... }, outputSchema: { ... } }],
});
```

---

## What We're Not Building

- Loops, recursion, arbitrary DAGs
- General orchestration engine
- Model-interpreted execution semantics
- Web editor or hosted runtime
- TypeScript SDK (JS runtime is intentional)

---

## Open Questions

- `human_input` deep in workflow — `halted_on_input` status + resume, or `prompt.*` namespace, or both?
- Should `runeflow-registry` providers auto-register schemas so `tools list` picks them up without a registry dir?
- At what point does the caching layer need a storage backend beyond flat JSON files?
- `runeflow watch` — node-cron for scheduling, chokidar for file watching, or both?
