# Plan of Attack

## Wave 1 — Alpha Gate

Ordered by dependency. Each item is independently shippable but sequenced for maximum momentum.

### 1. `const` in frontmatter
- Parser: extract `const` from frontmatter, store in `definition.consts`
- Expression layer: resolve `const.key` paths alongside `inputs.*` and `steps.*`
- Validator: validate `const` references exist
- Touches: `parser.js`, `expression.js`, `validator.js`
- Payoff: eliminates repeated model/provider values across steps

### 2. `matches` operator in expressions
- Expression layer: add `matches "pattern"` as a binary operator returning boolean
- Validator: validate regex pattern is a valid string
- Touches: `expression.js`, `validator.js`
- Payoff: branch conditions on string patterns without workarounds

### 3. `skip_if` on steps
- Runtime: evaluate `skip_if` expression before executing a step, skip cleanly if true
- Validator: validate `skip_if` references
- Touches: `runtime.js`, `validator.js`
- Payoff: lightweight guard without a full branch step

### 4. `runeflow tools list` + `runeflow tools inspect <tool>`
- CLI: two new subcommands
- `tools list`: print all built-ins + registry tools with name and description
- `tools inspect <name>`: print input schema, output schema, description
- Touches: `cli.js`, `tool-registry.js`, `builtins.js` (add metadata)
- Payoff: authors can discover tools without reading source code — alpha blocker

### 5. Third example skill
- Pick: release notes drafting (fetch commits since last tag, draft structured notes)
- Files: `examples/release-notes.runeflow.md` + `examples/release-notes-runtime.js`
- Payoff: proves the pattern generalizes beyond PR workflows

### 6. README rewrite
- Structure: what it is → benchmark numbers → 5-minute quickstart → supported model → CLI reference
- Add `jsconfig.json` for type checking
- Payoff: new user can get running without hand-holding

---

## Wave 2 — Top-Level Executor (after alpha ships)

1. `cli` step kind — shell command via `child_process`, stdout/stderr capture
2. `human_input` step kind — pause for terminal input, constrained choices
3. `runeflow resume` — read halted run state, skip completed steps, retry from failure
4. Auth waterfall — env → .env → `~/.runeflow/credentials.json`, fail fast with clear message
5. Input-hash caching — skip steps whose resolved inputs haven't changed, `cache: false` opt-out

## Wave 3 — Integration (after Wave 2)

1. `runeflow assemble` — preprocessor command, outputs projected context for a specific step
2. MCP server — `runeflow-mcp` exposing `runeflow_run` as a tool
3. `runeflow build` — planner LLM compiles English skill description into runeflow block

---

## Current test count: 50 passing
## Target after Wave 1: ~65 passing
