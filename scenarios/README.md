# DX scenarios

A feedback loop for measuring runeflow's authoring experience. Every runtime,
docs, or API change can be run against the scenarios here to see whether
authoring got easier, harder, or stayed the same.

## Two loops

| Loop | Runs | Answers |
|---|---|---|
| **B — scripted** | `node scenarios/harness/run-scripted.js <scenario>` | Given a hand-written minimum-surface skill, does it still validate, test, and stay within its concept budget? |
| **A — agent** | `node scenarios/harness/run-agent.js <scenario>` | Can an authoring agent, given only the README and a natural-language task, produce a working skill? How many concepts does it reach for? |

Loop B is fast and deterministic — CI-safe, no API keys. Loop A prefers
`OPENAI_API_KEY`, then `AI_GATEWAY_API_KEY`, and falls back to a logged-in
`claude` CLI when available. It skips cleanly when no backend is available.

## Concept budget

The DX metric. Each scenario declares the set of runeflow concepts it should
need. The harness parses the skill, extracts the concepts used, and fails if
anything is outside the budget.

Concept taxonomy (see `harness/concept-counter.js`):

- `step.cli`, `step.tool`, `step.llm`, `step.transform`, `step.branch`,
  `step.parallel`, `step.block`, `step.human_input`, `step.fail`
- `interpolation` — any `{{ }}` in a step or output
- `with` — a step has bindings
- `schema.out` / `schema.llm` — step declares an output schema
- `retry`, `fallback`, `skip_if`, `cache=false`
- `import`
- `frontmatter.const`, `frontmatter.llm`, `frontmatter.mcp_servers`,
  `frontmatter.composio`
- `tool.builtin` / `tool.registry` — source of a `tool:` reference

One concept ≈ one README section an author had to read.

## Scenario layout

```
scenarios/<name>/
├── task.md           # Natural-language prompt (Loop A input)
├── reference.md      # Hand-written minimum-surface skill (Loop B input)
├── budget.json       # { concepts: [...], max_cycles: N }
├── fixture.json      # Mocks for `runeflow test` (llm + tool steps)
└── .env.example      # Loop A only
```

`task.md` is plain English — **no runeflow jargon, no step kinds named,
no DSL hints.** It describes what the skill should do, not how.

`reference.md` is the target shape: the simplest runeflow skill that does the
job. If Loop A produces a skill heavier than this, we have a DX gap.

## Running

```bash
# Loop B — scripted. No API keys required.
node scenarios/harness/run-scripted.js open-pr-no-push

# Loop A — agent. Uses OPENAI_API_KEY, AI_GATEWAY_API_KEY, or a logged-in claude CLI.
node scenarios/harness/run-agent.js open-pr-no-push
```

Or via npm:

```bash
npm run scenarios -- open-pr-no-push
npm run scenarios:agent -- open-pr-no-push
```

Both commands emit a JSON line as the final line of stdout, suitable for
scripting.

## Gotcha: `runeflow test` does not mock `cli` steps

`runeflow test --fixture` mocks only `tool` and `llm` steps. `cli` steps run
real shell commands. Choose scenario commands that are deterministic in any
git checkout (e.g. `git rev-parse --abbrev-ref HEAD`, `git diff --stat`), or
design the skill so cli output doesn't appear in the `expect.outputs` block —
only the mocked LLM output does.

## Adding a scenario

1. `mkdir scenarios/<name>`
2. Write `task.md` in plain English.
3. Write the minimum-surface `reference.md` you think the task needs.
4. Run `node scenarios/harness/concept-counter.js scenarios/<name>/reference.md`
   — that list is your starting budget.
5. Write `fixture.json` mocking the `llm` and `tool` steps.
6. Run Loop B. If it passes, commit.
7. Run Loop A when you have an authoring backend available. The cycle count
   and concepts the agent reached for are the first DX data points for this scenario.

## When a scenario breaks

- **Loop B fails on `validate`:** real regression in the parser or validator.
- **Loop B fails on `test`:** the skill's expected outputs don't match the
  mocked LLM response any more — fixture is stale.
- **Loop B fails on `concept_budget`:** the reference skill uses a concept
  that's not in the budget. Either the skill was edited to use a heavier
  feature (revert it) or the task genuinely needs that concept (expand the
  budget with a note in the diff).
- **Loop A fails:** the *interesting* failure mode. Either the README didn't
  teach what was needed, the error messages didn't guide recovery, or the
  runtime has a trap. Record the failure as a DX issue — don't patch the
  scenario to make it pass.
