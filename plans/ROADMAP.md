# Runeflow Roadmap

## What Runeflow Is

A hybrid runtime for executable AI skills. A skill is one file combining:
- human-facing Markdown guidance
- a fenced `runeflow` execution block
- JSON artifacts for every run and step

The runtime owns execution semantics. The LLM participates only inside bounded `llm` steps. The model never needs to parse or enforce the workflow language.

## Core Thesis (Proven)

Runtime-owned execution is structurally better than prompt-driven execution:
- **-82% input tokens** on orchestration-heavy MCP tasks (adyntel, addresszen)
- **-38% input tokens** on synthesis tasks (3p-updates)
- **Zero-shot failure prevention** — raw skills fall into tool discovery loops; Runeflow eliminates this failure mode entirely
- **Neutral overhead** on simple tasks — no downside to adopting it

Benchmarks across 4 task types, 2 providers (OpenAI, Cerebras), confirm the pattern holds.

---

## What's Built (Current State)

### Runtime
- Step kinds: `tool`, `llm`, `branch`, `transform`, `block` (template reuse)
- Control flow: `retry`, `fallback`, `fail`, `next`
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError` (optional, non-fatal)
- Named doc blocks (`:::guidance[name]:::`) with per-step projection via `docs:`
- `{{ }}` interpolation in prompts, inputs, tool args, fail messages, outputs
- Schema validation on all step outputs and final outputs
- JSON artifacts for every run and step

### Authoring
- `const` in frontmatter — planned (see below)
- `block` templates — reusable step definitions, expanded at parse time
- `transform` steps — deterministic JS expression for data reshaping between steps
- Named doc blocks — select which guidance each `llm` step receives

### Tooling
- CLI: `validate`, `run`, `inspect-run`, `import`
- Built-in tools: `git.current_branch`, `git.diff_summary`, `git.push_current_branch`, `file.exists`, `util.fail`, `util.complete`
- Tool registry: GitHub and Linear schemas (output schema auto-derived, no `out:` needed)
- Eval harness: 4 benchmarks, token accounting, provider comparison

### Examples
- `open-pr.runeflow.md` — PR prep (execution-heavy)
- `review-draft.runeflow.md` — code review notes (balanced)
- Eval skills: `3p-updates`, `adyntel-automation`, `addresszen-automation`

---

## What's Not Built Yet

### Planned for Alpha (pre-public)

**`const` in frontmatter** — reduces duplication across steps
```yaml
const:
  provider: cerebras
  model: qwen-3-235b-a22b-instruct-2507
  max_items: 5
```
Referenced as `const.key` in any expression or template. Covers string, number, boolean, object values. Functions deferred — use `block` templates for step reuse and `transform` for data reshaping.

**`matches` operator in expressions** — regex support in `branch` conditions
```
branch check_branch {
  if: steps.current_branch.branch matches "^feat/"
  then: feature_flow
  else: other_flow
}
```
Scoped to `value matches "pattern"` returning boolean. No capture groups or flags yet.

**`skip_if` on steps** — lightweight guard without a full `branch`
```
step draft_pr type=llm {
  skip_if: steps.diff.files == 0
  prompt: "Draft a PR."
  schema: { title: string, body: string }
}
```
Step skipped cleanly, outputs null, downstream steps handle null gracefully.

**`runeflow tools list` / `runeflow tools inspect <tool>`** — CLI tool discovery
Without this, authoring requires reading source code or registry JSON. Blocking for new users.

**Third example skill** — release notes, incident summary, or issue-to-plan
Two examples is a demo. Three is a pattern. Must be in a different category from PR prep and review draft.

**README rewrite** — "what it is → why it matters → 5-minute quickstart" flow

**Known issues doc** — honest list of rough edges for alpha users

### Post-Alpha

**Skill composition / imports** — include text fragments or sub-skills from other files. Artifact traces must show where imported content came from. Prefer explicit includes over magic merging.

**Better error messages** — validator errors are functional but terse. Suggest available block names, actual output fields, why `metadata.llm` is required.

**Parallel `tool` steps** — fan out N tool calls, join outputs. Constrained to `tool` steps only (not `llm` or `branch`). Not needed for alpha.

**npm publish** — alpha ships as git clone. Package registry after alpha feedback.

---

## Alpha Gate

Alpha means: public enough to get feedback on the model. Known rough edges are acceptable if documented.

**Must-have before shipping:**
1. `runeflow tools list` + `runeflow tools inspect` — authoring without source-reading
2. Third example skill — proves the pattern generalizes
3. README rewrite — new user can get running in 5 minutes
4. Known issues doc — sets expectations honestly

**Nice-to-have fast-follows (week 1 after alpha):**
- `const` in frontmatter
- `matches` operator
- `skip_if` on steps
- Better error messages

**Alpha success criteria:**
- New user can clone, `npm install`, and run an example in under 10 minutes
- New user can author a two-step skill without reading source code
- At least one external user builds a skill not in the examples directory
- Feedback surfaces something we wouldn't have predicted from internal use

---

## What We're Not Building

- Loops, recursion, arbitrary DAGs, parallel execution (beyond constrained tool fan-out)
- General orchestration engine
- Model-interpreted execution semantics
- Web-based editor or hosted runtime
- Deep DSL flexibility before high-value workflow patterns are clearer

---

## Open Questions

**Agentic system integration — highest priority question**

Integration is more valuable than a standalone tool. The key unknown is where Runeflow fits in the execution flow of existing agentic systems.

Current agents like Claude Code and Codex load skill files as raw context before calling the model. The ideal integration point is between "agent loads skill file" and "agent calls LLM" — so Runeflow processes the skill first and only the projected, resolved context reaches the model. That's exactly the token reduction mechanism the benchmarks prove.

The options, depending on what hook points each agent exposes:

- **Pre-processing**: `runeflow project` outputs a clean projected Markdown file that the agent loads instead of the raw skill. Agent never sees the execution block.
- **Tool registration**: register `runeflow_run` as a custom tool in the agent's tool chain. Agent calls the tool, gets structured outputs, never interprets the skill directly.
- **Subprocess wrapper**: agent calls `runeflow exec` as a subprocess tool, gets JSON back. Cleanest separation — agent never sees skill internals.

Unknown: how Claude Code, Codex, Cursor, and similar agents actually load and process skill files today, and what interception points they expose. This needs hands-on investigation with each system before committing to an integration approach.

**MCP server**

An `runeflow-mcp` server exposing `runeflow_run` as an MCP tool would let any MCP-compatible agent execute Runeflow skills directly. The adyntel and addresszen benchmarks already prove the token reduction story for MCP-heavy workflows — this closes the loop. Effort is medium, leverage is high.

**Skill discovery convention**

A standard location (`.runeflow/skills/`) and a discovery convention in `AGENTS.md` would let any agent that reads repo context find and execute skills without explicit configuration. Zero runtime work, just a convention.

**When to prioritize integration over standalone features**

The standalone alpha gate (tools CLI, third example, README) is still the right first step — you need something solid to integrate. But the integration question should drive what gets built after alpha, not more DSL features.

---

## Sequence

```
const + matches + skip_if   →   tools CLI   →   third example   →   README + known issues   →   alpha
        (authoring DX)            (discovery)      (pattern proof)        (onboarding)
```

Each item is independently shippable. The tools CLI and third example are the actual gate.
