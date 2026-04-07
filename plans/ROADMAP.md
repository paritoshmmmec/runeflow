# Runeflow Roadmap

## What Runeflow Is

A hybrid runtime for executable AI skills. A skill is one file combining:
- human-facing Markdown guidance
- a fenced `runeflow` execution block
- JSON artifacts for every run and step

The runtime owns execution semantics. The LLM participates only inside bounded `llm` steps.

## Core Thesis (Proven)

- **-82% input tokens** on orchestration-heavy MCP tasks
- **-38% input tokens** on synthesis tasks
- **Zero-shot failure prevention** — raw skills fall into tool discovery loops; Runeflow eliminates this entirely
- **Neutral overhead** on simple tasks

---

## Current State (v0.1.0 — published)

### Step kinds
`tool`, `llm`, `branch`, `transform`, `block`, `cli`

### Control flow
`retry`, `fallback`, `fail`, `next`, `skip_if`, `cache=false`, `allow_failure`

### Authoring
- `const` in frontmatter
- `matches` operator in expressions
- Named doc blocks with per-step projection
- `{{ }}` interpolation everywhere
- Block templates

### Runtime
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError`
- `halted_on_error` status + `halted_step_id`
- Input-hash caching + `runeflow resume`
- Schema validation on inputs (registry-backed) and outputs
- JSON artifacts per run and step

### CLI
`validate`, `run`, `resume`, `inspect-run`, `import`, `tools list`, `tools inspect`, `assemble`

### Built-in tools
`git.current_branch`, `git.diff_summary`, `git.push_current_branch`, `git.log`, `git.tag_list`,
`file.exists`, `file.read`, `file.write`, `util.complete`, `util.fail`

### Registry
- Loads from package root — works when installed via npm
- User registry at `<project>/registry/tools/` merges on top
- Programmatic `toolRegistry` option for inline schemas
- Schemas: GitHub, Linear, gh CLI, npm, docker, kubectl, curl

### Default runtime
`createDefaultRuntime()` — cerebras, openai, anthropic, zero config

### Assembler
`assembleRuneflow()` — renders clean context file for a specific llm step (agent integration)

---

## Wave 2 — Remaining (v0.2)

### `human_input` step
Pause execution, prompt terminal user, resume with answer.

```runeflow
step confirm type=human_input {
  prompt: "Deploy to production? (yes/no)"
  choices: ["yes", "no"]
  out: { answer: string }
}
```

- Constrained choices or free text
- State persisted before pause so `resume` works
- `--non-interactive` flag skips with default answer in CI

### Auth waterfall
Credentials resolved in order: env vars → `.env` → `~/.runeflow/credentials.json`

Fail fast before execution:
```
Missing OPENAI_API_KEY for step 'draft'. Export it or add it to your .env file.
```

### `runeflow-registry` package

A separate npm package where schema + implementation travel together.

```bash
npm install runeflow runeflow-registry
```

```js
import { createDefaultRuntime } from "runeflow";
import { github, slack, linear } from "runeflow-registry";

export default {
  ...createDefaultRuntime(),
  tools: {
    ...github({ token: process.env.GITHUB_TOKEN }),
    ...slack({ token: process.env.SLACK_BOT_TOKEN }),
    ...linear({ apiKey: process.env.LINEAR_API_KEY }),
  },
};
```

Package structure:
```
runeflow-registry/
├── index.js
└── providers/
    ├── github/   { tools(config), schemas }  — @octokit/rest
    ├── linear/   { tools(config), schemas }  — @linear/sdk
    ├── slack/    { tools(config), schemas }  — @slack/web-api
    └── notion/   { tools(config), schemas }  — @notionhq/client
```

Each provider is opt-in. Auth passed at construction, not via env vars inside tools.

### `--force` flag on `run`
Bypass all caches: `runeflow run skill.md --force`

---

## Wave 3 — Agent Integration (v0.3)

### MCP server (`runeflow-mcp`)
Exposes `runeflow_run` as an MCP tool. Any MCP-compatible agent executes skills directly.
Closes the loop on the token reduction story — no manual `assemble` step needed.

### `runeflow build`
Planner LLM compiles English → runeflow block.
```bash
runeflow build "draft a PR from the current branch" --output draft-pr.runeflow.md
```

### Skill discovery convention
Standard location: `.runeflow/skills/` + convention in `AGENTS.md`.
Agents find and execute skills without explicit configuration.

---

## User-Provided Schemas

Two ways to extend the registry:

**Project-level directory** — drop JSON files in `<project>/registry/tools/`:
```json
{
  "name": "stripe.charge",
  "description": "Create a Stripe charge.",
  "inputSchema": { "type": "object", "properties": { "amount": { "type": "number" } }, "required": ["amount"] },
  "outputSchema": { "type": "object", "properties": { "charge_id": { "type": "string" } }, "required": ["charge_id"] }
}
```

**Programmatic** — pass `toolRegistry` to `runRuneflow` / `validateRuneflow`:
```js
await runRuneflow(definition, inputs, runtime, {
  toolRegistry: [
    { name: "stripe.charge", inputSchema: { ... }, outputSchema: { ... } }
  ],
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

- How do Claude Code, Codex, Cursor load skill files — as raw context or as tools? Determines whether `assemble` or MCP is the right integration point.
- Should `human_input` steps be skippable in CI mode (`--non-interactive`)?
- At what point does the caching layer need a storage backend beyond flat JSON?
- Should `runeflow-registry` providers auto-register their schemas so `tools list` picks them up without a registry dir?
