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

## Current State — v0.5.0 (shipped)

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
- `mcp_servers` frontmatter block — zero-config MCP server wiring
- `composio` frontmatter block — zero-config Composio tool wiring

### Runtime
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError`
- `halted_on_error` status + `halted_step_id`
- `halted_on_input` status + `pending_input`
- Input-hash caching + `runeflow resume`
- Schema validation on inputs (registry-backed) and outputs
- Auth waterfall: env → `.env` → `~/.runeflow/credentials.json`
- Env var allowlist for frontmatter interpolation (`RUNEFLOW_ENV_ALLOWLIST`)
- JSON artifacts per run and step
- Runtime plugin layer: `createMcpToolPlugin`, `createMcpClientPlugin`, `createMcpHttpClientPlugin`, `createComposioClientPlugin`
- Frontmatter plugins auto-built from `mcp_servers` / `composio` before execution; resource-safe cleanup in `buildFrontmatterPlugins`
- Streaming CLI output — `cli` steps stream stdout/stderr live
- TypeScript definitions (`index.d.ts`) — full type coverage, zero runtime cost

### CLI
`init`, `validate`, `run` (+ `--force`, `--prompt`), `test`, `build`, `dryrun`, `resume`, `watch`, `assemble`, `inspect-run`, `import`, `tools list`, `tools inspect`

### init
- Repo inspection: reads `package.json`, git log, CI config, installed SDKs, existing `.runeflow.md` files
- Heuristic template selection with `--context` and `--template` overrides
- 8 built-in templates: `open-pr`, `release-notes`, `test-and-lint`, `deploy`, `notify-slack`, `stripe-payment`, `linear-issue`, `generic-llm-task`
- Auto-conversion of existing Claude-style skill files (`<system>`, `## Tools`, `Input:`/`Output:` annotations)
- Local LLM fallback (Qwen2.5-0.5B downloaded to `~/.runeflow/models/`) when no cloud key present
- `--no-local-llm`, `--no-polish`, `--force`, `--name`, `--provider`, `--model`, `--context`, `--template` flags
- `runtime.js` content branches on provider: local handler (`node-llama-cpp`) for `local`, placeholder stub for cloud/placeholder
- Resource-safe model download: redirect responses drained, non-200 responses drained, socket errors close and unlink the partial file
- Property-based tests (13 properties, `fast-check`) covering signal completeness, SDK detection, template validation, scoring consistency, deduplication, and orchestration invariants

### test (`runeflow test`)
- `runTest(definition, fixture, options)` — runs a skill against a fixture with all LLM and tool calls mocked
- Fixture format: `{ inputs, mocks: { tools, llm }, expect: { status, outputs, steps } }`
- `loadFixture(path)` — loads a fixture JSON file
- Mock runtime intercepts all providers declared in the skill's frontmatter and step-level `llm` config
- Assertion engine does deep partial matching — only keys declared in `expect` are checked
- Per-step assertions: `steps.<id>.status`, `steps.<id>.outputs`, etc.
- Non-zero exit code on failure; structured JSON output with `pass`, `failures`, `run_id`

### build (`runeflow build`)
- `buildRuneflow(description, options)` — LLM compiles English description → `.runeflow.md` content
- Uses the runtime's own LLM execution path via an internal skill definition
- `--provider`, `--model`, `--runtime`, `--out` flags
- Closes the authoring loop: `build` → `dryrun` → `run`

### dryrun
- Validates the skill, then resolves all bindings with typed placeholders
- Shows exactly what each step would do (tool args, prompts, commands, branches) without executing anything
- Uses `stepIndex` map for correct branch routing

### Built-in tools (10)
`git.current_branch`, `git.diff_summary`, `git.push_current_branch`, `git.log`, `git.tag_list`,
`file.exists`, `file.read`, `file.write`, `util.complete`, `util.fail`

### Registry
- Loads from package root — works when installed via npm
- User registry at `<project>/registry/tools/` merges on top
- Programmatic `toolRegistry` option for inline schemas
- Schemas: GitHub, Linear, gh CLI, npm, docker, kubectl, curl

### Default runtime
`createDefaultRuntime()` — Vercel AI SDK, supports cerebras, openai, anthropic, groq, mistral, google

### Packages
- `runeflow-mcp` (`packages/runeflow-mcp/`) — MCP server exposing `runeflow_run` and `runeflow_validate` as tools
- `runeflow-registry` (`packages/runeflow-registry/`) — scaffolded, not yet published

### Integration modes (all three working)
| Mode | How |
|---|---|
| Top-level executor | `runRuneflow()` / `runeflow run` |
| Assemble (preprocessor) | `assembleRuneflow()` / `runeflow assemble` → agent loads context file |
| MCP server | `runeflow-mcp` exposes `runeflow_run` as MCP tool |

---

## v0.6 — Composition & Scale

### Cross-file skill imports
One skill calling another, or sharing block libraries across files.

```runeflow
import blocks from "./shared/pr-blocks.runeflow.md"
```

### Skill discovery convention
`.runeflow/skills/` directory + `AGENTS.md` entry so agents can find and invoke skills without being told the path explicitly.

### Publish `runeflow-registry`
The package is scaffolded at `packages/runeflow-registry/`.

Needs:
- Tests for each provider (mock the SDK calls)
- `npm publish` from `packages/runeflow-registry/`
- README install instructions updated

---

## v0.7 — Scale & Observability

### Observability
`--telemetry` flag emits OpenTelemetry spans per step. Plugs into Datadog, Honeycomb, Grafana.

### Remote execution
Server mode: `runeflow serve` exposes a run API so skills can be triggered over HTTP.

### Web Dashboard
Run artifact inspection UI for `.runeflow-runs/` — step timelines, token usage, diffs.

### Skill versioning + migration
`runeflow migrate` updates skill syntax when the DSL changes.

---

## What We're Not Building

- Loops, recursion, arbitrary DAGs
- General orchestration engine
- Model-interpreted execution semantics
- Web editor or hosted runtime
- TypeScript SDK (JS runtime is intentional)

---

## Open Questions

- Should `runeflow-registry` providers auto-register schemas so `tools list` picks them up without a registry dir?
- At what point does the caching layer need a storage backend beyond flat JSON files?
- `runeflow build` — single planner call or iterative refinement with `dryrun` feedback in the loop?
- Should cross-file imports be fully eager (parse at load time) or lazy (resolve at step execution)?
