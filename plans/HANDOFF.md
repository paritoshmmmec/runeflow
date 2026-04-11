# Session Handoff

## Current State

**121 tests passing. On `main` branch. Published as `runeflow@0.1.0`.**

---

## What's Shipped (complete feature list)

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
- `halted_on_error` + `halted_on_input` statuses
- Input-hash caching + `runeflow resume`
- Schema validation on inputs (registry-backed) and outputs
- Auth waterfall: env → `.env` → `~/.runeflow/credentials.json`
- Env var allowlist for frontmatter interpolation (`RUNEFLOW_ENV_ALLOWLIST`)
- JSON artifacts per run and step
- Runtime plugin layer: `createMcpToolPlugin`, `createMcpClientPlugin`, `createMcpHttpClientPlugin`, `createComposioToolPlugin`, `createComposioClientPlugin`
- Frontmatter plugins auto-built from `mcp_servers` / `composio` before execution
- Resource-safe plugin cleanup on partial failure in `buildFrontmatterPlugins`

### CLI
`init`, `validate`, `run` (+ `--force`, `--prompt`), `resume`, `watch`, `inspect-run`, `import`, `tools list`, `tools inspect`, `assemble`, `dryrun`

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

### Assembler
`assembleRuneflow()` — renders clean context file for a specific llm step

### Dryrun
`dryrunRuneflow()` — walks all steps, resolves bindings, shows what would execute without running anything. Uses `stepIndex` map for correct branch routing. Returns `{ valid, validation, steps[], output }`.

### runeflow-mcp (package)
`packages/runeflow-mcp/` — MCP server exposing `runeflow_run` and `runeflow_validate` as tools. Wire into Claude Code / Cursor via `.mcp.json`.

### runeflow-registry (scaffolded, not yet published)
`packages/runeflow-registry/` — github, linear, slack, notion providers with schemas + implementations.

### TypeScript types
`index.d.ts` — full type coverage for all public exports.

---

## What's Next

### High priority
1. **Publish `runeflow-registry`** — scaffolded at `packages/runeflow-registry/`, needs `npm publish`
2. **Update README** — document `dryrun`, `mcp_servers` frontmatter, `runeflow-mcp`, HTTP MCP transport
3. **Publish `runeflow-mcp`** — scaffolded at `packages/runeflow-mcp/`, needs `npm publish`
4. **Bump version** — `npm version minor` → `0.2.0`, push tag to trigger publish workflow

### Medium priority
- `runeflow build` — planner LLM compiles English → runeflow block
- Skill discovery convention (`.runeflow/skills/` + `AGENTS.md`)
- `runeflow test` harness — fixture inputs, assert outputs, mock LLM
- Parallel tool steps (already in roadmap, not yet implemented)

### Low priority / future
- Skill composition / imports
- Observability (OpenTelemetry spans)
- `runeflow watch` improvements
- Native binary

---

## Key Files

| File | Purpose |
|---|---|
| `src/runtime.js` | Execution engine |
| `src/runtime-plugins.js` | MCP + Composio plugin layer |
| `src/dryrun.js` | Dryrun walker |
| `src/assembler.js` | Agent context assembly |
| `src/cli.js` | CLI commands |
| `src/default-runtime.js` | Vercel AI SDK runtime |
| `src/auth.js` | Auth waterfall + env allowlist |
| `src/parser.js` | Frontmatter + DSL parsing |
| `src/validator.js` | Static validation |
| `src/index.js` | Public exports |
| `index.d.ts` | TypeScript types |
| `packages/runeflow-mcp/` | MCP server package |
| `packages/runeflow-registry/` | Tool registry package |
| `plans/ROADMAP.md` | Full roadmap |
| `plans/v03-plan.md` | Claude's v0.3 implementation plan (reference) |
