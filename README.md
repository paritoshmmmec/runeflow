<div align="center">

# ⚡ Runeflow

**Stop putting workflow logic inside prompts.**

Runeflow lets you build executable AI skills in Markdown. Keep guidance readable, control flow typed, and execution owned by the runtime.

[![npm version](https://img.shields.io/npm/v/runeflow?color=blueviolet)](https://www.npmjs.com/package/runeflow)
[![CI](https://github.com/paritoshmmmec/runeflow/actions/workflows/ci.yml/badge.svg)](https://github.com/paritoshmmmec/runeflow/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)
[![node](https://img.shields.io/badge/node-%3E%3D20-green)](#)

</div>

---

## The problem

Prompt-based automations break in predictable ways. The model decides what to call, in what order, and with what inputs. Retries are ad hoc. Outputs are unvalidated. Runs are hard to inspect after the fact.

The root cause is simple: workflow logic — sequencing, branching, validation, and tool calls — is hiding inside the prompt where it doesn't belong.

## The solution

Runeflow moves execution semantics out of the prompt and into a small runtime. One `.md` file combines human-readable guidance with a typed, executable workflow block. The runtime owns sequencing, branching, retries, tool execution, and schema validation.

Prompts are still used for judgment and language. They're just no longer asked to secretly be the workflow engine.

---

## Why Runeflow

**Markdown-first** — Workflows live in your repo, review cleanly in diffs, and stay readable by humans.

**Runtime-owned execution** — Validation, retries, branching, and tool calls happen in code, not inside prompt instructions.

**Inspectable runs** — Every step writes an artifact, so failures are debuggable instead of mysterious.

**Agent-friendly** — `runeflow assemble` can precompute context and hand an agent only the step it actually needs.

## Current Status

Runeflow is already useful for repo-local automation and agent preprocessing. The current product direction is:

- Zero-install default LLM path: Claude Code if available, otherwise AI Gateway
- A narrow workflow model: `cli`, `llm`, `tool`, `transform`, `branch`, `parallel`, `human_input`, `block`
- A tight authoring loop: `validate`, `dryrun`, `run`, `inspect-run`, `test`
- Scenario-based DX evaluation so docs and runtime changes can be measured against real authoring tasks

See the [roadmap](./plans/ROADMAP.md) for what we expect to improve next and which ideas are still deliberately later.

---

## What it's for

Runeflow is a strong fit for repo-local developer workflows with light-to-moderate AI involvement:

- PR drafting and code review summaries
- Release notes generation
- Issue creation from CI failures
- Agent pre-processing (assemble mode)
- Scheduled repo automation

It works well alongside existing agents such as Claude Code, Codex, and Cursor rather than trying to replace them.

## What it's not

- A general-purpose DAG engine
- A no-code automation platform
- A multi-agent autonomy framework
- A replacement for app backends or job systems
- A visual workflow builder

---

## Benchmarks

These numbers are directional, not a universal claim. They show where runtime-owned orchestration helps most: workflows that would otherwise burn tokens rediscovering tools and sequencing on every run.

Evaluated across 4 task types, 2 providers (OpenAI, Cerebras):

| Task | Raw input tokens | Runeflow input tokens | Reduction |
|---|---|---|---|
| adyntel-automation | 810 | 128 | **-84%** 🔥 |
| addresszen-automation | 817 | 150 | **-82%** 🔥 |
| 3p-updates | 825 | 508 | **-38%** |
| open-pr | 219 | 236 | neutral |

On orchestration-heavy tasks, raw prompts fall into tool-discovery loops. Runeflow eliminates this failure mode entirely. See [benchmark_report.md](./benchmark_report.md) for full data.

### vs. prompt-as-program skills (g-stack)

Compared against [g-stack](https://github.com/garrytan/gstack) — Garry Tan's widely-used Claude Code skill suite — where the entire skill file loads into context on every invocation:

| Skill | g-stack input tokens | Runeflow input tokens | Reduction |
|---|---|---|---|
| [ship](https://github.com/garrytan/gstack/blob/main/ship/SKILL.md) (PR + version + changelog) | ~32,100 | ~700 | **-98%** 🔥 |
| [review](https://github.com/garrytan/gstack/blob/main/review/SKILL.md) (pre-landing code review) | ~18,900 | ~600 | **-97%** 🔥 |

g-stack's [`ship/SKILL.md`](https://github.com/garrytan/gstack/blob/main/ship/SKILL.md) is 2,543 lines — the full orchestration spec, bash preamble, specialist dispatch logic, and PR template all load into the LLM context every run. Runeflow's runtime owns sequencing and tool dispatch; the LLM only sees the resolved prompt for the step it's actually executing.

> This is the core architectural difference: **prompt-as-program** (LLM reads and interprets the whole workflow) vs. **runtime-as-orchestrator** (LLM executes one bounded step at a time). See [`eval/gstack-comparison.md`](./eval/gstack-comparison.md) for the full breakdown.

> The [first pull request to this repo](https://github.com/paritoshmmmec/runeflow/pull/1) was opened by Runeflow itself — using `examples/open-pr-gh.md` to diff the branch, draft the title and body via LLM, and run `gh pr create` as a `cli` step.

---

## Contents

- [Quickstart](#quickstart)
- [Core Loop](#core-loop)
- [Debugging a broken skill](#debugging-a-broken-skill)
- [Roadmap](./plans/ROADMAP.md)
- [File shape](#file-shape)
- [Step kinds](#step-kinds)
- [Expressions](#expressions)
- [Built-in tools](#built-in-tools)
- [CLI reference](#cli-reference)
- [Writing a runtime](#writing-a-runtime)
- [Assemble mode](#-assemble-preprocessor-for-agents)
- [MCP server mode](#mcp-server-mode)
- [Zero-config MCP & Composio wiring](#zero-config-mcp--composio-wiring)
- [runeflow-registry](#runeflow-registry)
- [Extending the tool registry](#extending-the-tool-registry)
- [Caching](#caching)
- [Trust model](#trust-model)

---

## Quickstart

> Requires Node >= 20.

**Install**

```bash
npm install -g runeflow
```

**Pick a zero-install path**

You don't need to declare a provider in the skill. Runeflow auto-selects the first path that works:

1. `claude` CLI on PATH → Claude Code
2. `AI_GATEWAY_API_KEY` → Vercel AI Gateway

That means `npm install -g runeflow` is enough for anyone who already has Claude Code installed, and everyone else can use one gateway key:

```bash
echo "AI_GATEWAY_API_KEY=your-key-here" > .env
```

Want to pin the gateway explicitly for a run?

```bash
runeflow run ./skill.md --provider gateway --model anthropic/claude-sonnet-4.6
```

Want to silence the `runeflow: auto-selected provider=…` line? `export RUNEFLOW_QUIET=1`.

**Generate a skill with `runeflow init`**

Run inside any project directory. It inspects your repo — `package.json`, git log, CI config, installed SDKs, existing `.md` runeflow files — and generates a ready-to-run project skill in `.runeflow/skills/` tailored to what it finds.

```bash
runeflow init
```

If a cloud API key is present, Runeflow can lightly polish the generated docs and prompt. If not, it still scaffolds the minimal workflow directly so you can edit and run it right away:

```bash
runeflow skills list
runeflow skills run open-pr --input '{"base_branch":"main"}'
```

**Or write one by hand:**

The smallest runnable skill is frontmatter + one `cli` step + one `llm` step. No `llm:` block, no tool registry, no runtime file. Just shell commands and a prompt:

````md
---
name: draft-pr
description: Draft a pull request from the current branch.
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  body: string
---

# Draft PR

Write a concise PR title and a short body describing what changed and why.

```runeflow
step branch type=cli {
  command: "git rev-parse --abbrev-ref HEAD"
}

step diff type=cli {
  command: "git diff --stat {{ inputs.base_branch }}...HEAD"
}

step draft type=llm {
  prompt: |
    Branch: {{ steps.branch.stdout }} → {{ inputs.base_branch }}
    Diff summary:
    {{ steps.diff.stdout }}

    Draft a PR title (under 72 chars, starting with feat:/fix:/chore:) and a
    plain-markdown body explaining what changed and why.
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
```
````

That's the whole skill. No provider declared — runtime picks Claude Code if it's available, otherwise AI Gateway if `AI_GATEWAY_API_KEY` is set. `cli` steps are first-class: anything that runs in a shell goes here.

> **Advanced:** pin a specific model with `--provider gateway --model anthropic/claude-sonnet-4.6` at the CLI, or commit an `llm:` block in frontmatter. Most authors don't need this — the default path just works.

**Run it**

```bash
runeflow run ./draft-pr.md --input '{"base_branch":"main"}'
```

The default runtime handles Claude Code, AI Gateway, and explicit direct providers — no `--runtime` flag needed. Keys are resolved from `process.env`, a `.env` file in the current directory, or `~/.runeflow/credentials.json`.

Output:

```json
{
  "title": "feat: add retry logic to checkout step",
  "body": "Wraps the checkout tool call in a retry loop with exponential backoff..."
}
```

Every step writes a JSON artifact to `.runeflow-runs/` — inputs, outputs, timing, and errors, all inspectable after the fact.

**Validate before you run**

```bash
runeflow validate ./draft-pr.md
# { "valid": true, "issues": [] }
```

Static — no API calls, no git. Catches broken references and schema mismatches before execution.

---

## Core Loop

The commands an author uses in order, from first write to verified test:

1. `runeflow validate <file>` — Checks a skill file for errors before running it.
2. `runeflow dryrun <file> --input '{"key":"value"}'` — Resolves all bindings and shows what each step would do without executing anything.
3. `runeflow run <file> --input '{"key":"value"}'` — Executes the skill with real tool calls, LLM calls, and shell commands.
4. `runeflow inspect-run <run-id>` — Reads and formats run artifacts to help diagnose failures.
5. `runeflow run <file> --record-fixture <path>` — Records a completed run as a reusable fixture file for testing.
6. `runeflow test <file> --fixture <fixture.json>` — Runs a skill against a fixture file with mocked tools and LLM calls to verify behavior.

---

## Debugging a broken skill

When a run fails, work through these steps in order.

**1. Validate first**

```bash
runeflow validate ./my-skill.md
```

Validation is static — no API calls, no git. It catches broken step references, missing inputs, and schema mismatches before you spend tokens. Fix any errors here before going further.

**2. Dryrun to see what each step would do**

```bash
runeflow dryrun ./my-skill.md --input '{"base_branch":"main"}'
```

Dryrun walks every step and resolves all bindings without executing anything. It shows the resolved prompt, tool arguments, branch conditions, and command strings. If a step would receive the wrong input, you'll see it here.

**3. Run and inspect the artifact**

```bash
runeflow run ./my-skill.md --input '{"base_branch":"main"}'
# note the run_id in the output, e.g. run_20260401121315_dojn0r

runeflow inspect-run run_20260401121315_dojn0r --format table
```

The table view shows every step's status, duration, and — on the failed row — the error message inline. No scrolling required.

To drill into a specific step:

```bash
runeflow inspect-run run_20260401121315_dojn0r --step draft_pr
```

This prints the full step artifact: inputs, outputs, error, and timing.

**4. Resume after fixing a transient failure**

If the run halted on a tool error or `human_input` step, fix the underlying issue and resume from where it stopped — completed steps replay from cache:

```bash
runeflow resume ./my-skill.md
```

**5. Record a fixture and test**

Once the run succeeds, record it as a fixture so you can catch regressions without real API calls:

```bash
runeflow run ./my-skill.md --input '{"base_branch":"main"}' --record-fixture test/fixtures/my-skill.fixture.json
```

Then run it in test mode:

```bash
runeflow test ./my-skill.md --fixture test/fixtures/my-skill.fixture.json
```

The fixture mocks tools and LLM calls by step id, so each step can be controlled independently. Edit the fixture by hand to tighten assertions or simulate failure cases. See [`test/fixtures/open-pr.fixture.json`](./test/fixtures/open-pr.fixture.json) for a reference example.

**Common failure patterns**

| Symptom | Likely cause | Fix |
|---|---|---|
| `validate` reports unknown step reference | A `next`, `fallback`, or `branch` target doesn't match any step id | Check step ids for typos |
| `dryrun` shows wrong resolved value | Expression references wrong step id or field name | Check `steps.<id>.<field>` spelling |
| Step halts with schema mismatch | Tool or LLM output doesn't match the declared `out` / `schema` | Relax the schema or fix the tool call |
| `cli` step exits non-zero | Shell command failed | Add `allow_failure: true` to capture it, or fix the command |
| Import error stops validation | Referenced block file is missing or has a parse error | Fix the import path or the imported file first |

---

## File shape

A `.md` file is a standard Markdown document. YAML frontmatter declares inputs and outputs. The prose is guidance for the LLM. The `runeflow` block is the executable workflow.

Any `.md` file containing a `runeflow` block is valid. The `.runeflow.md` suffix is still accepted for backwards compatibility.

Frontmatter fields:

| Field | Required | What it does |
|---|---|---|
| `name`, `description`, `version` | yes | Identity. |
| `inputs` | yes | Typed input schema; drives `--input` validation and interpolation. |
| `outputs` | yes | Typed output schema; the final `output { ... }` block must satisfy it. |
| `llm` | **no** | Most skills omit this. The runtime auto-selects Claude Code or AI Gateway. Declare an `llm:` block only to pin a specific model or use a direct provider. |
| `mcp_servers`, `composio` | no | External tool wiring. See [Zero-config MCP & Composio wiring](#zero-config-mcp--composio-wiring). |

````md
---
name: prepare-pr
description: Prepare a pull request draft.
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  body: string
---

# Prepare PR

Operator guidance lives here. The runtime projects this to `llm` steps as `docs`.

```runeflow
step current_branch type=cli {
  command: "git rev-parse --abbrev-ref HEAD"
}

step draft_pr type=llm {
  prompt: "Draft a PR for {{ steps.current_branch.stdout }} targeting {{ inputs.base_branch }}."
  schema: { title: string, body: string }
}

output {
  title: steps.draft_pr.title
  body: steps.draft_pr.body
}
```
````

---

## Step kinds

The two you'll use almost everywhere are `cli` (shell out for anything the system knows how to do) and `llm` (call a model). Everything else is for specific situations.

| Kind | What it does |
|---|---|
| `cli` | Runs a shell command, captures `stdout`, `stderr`, `exit_code` |
| `llm` | Calls an LLM handler, validates output against `schema` |
| `parallel` | Runs a group of `cli`, `llm`, or `tool` steps concurrently, joins outputs |
| `branch` | Evaluates an expression, routes to `then` or `else` step |
| `transform` | Runs a JS expression over resolved `input`, validates against `out` |
| `tool` | Calls a registered tool (MCP, Composio, or built-in) with a typed schema |
| `human_input` | Collects an answer from `--prompt`, a handler, or halts for resume |
| `block` | Instantiates a named `block` template |

Control flow: `retry=N`, `retry_delay`, `retry_backoff`, `fallback=<step>`, `next=<step>`, `skip_if: <expr>`, terminal `fail`.

### cli

The default step for anything a shell can do — `git`, `gh`, `npm`, `docker`, `curl`, `jq`, whatever. Prefer `cli` whenever a command-line tool already exists for the job.

```runeflow
step branch type=cli {
  command: "git rev-parse --abbrev-ref HEAD"
}

step diff type=cli {
  command: "git diff --stat {{ inputs.base_branch }}...HEAD"
}
```

Each `cli` step outputs `{ stdout, stderr, exit_code }` — reference `steps.branch.stdout` downstream. Non-zero exit code halts the run by default; add `allow_failure: true` to capture it instead.

### llm

```runeflow
step draft type=llm {
  prompt: "Draft release notes since {{ inputs.base_ref }}."
  input: { diff: steps.diff.stdout }
  schema: { title: string, highlights: [string] }
}
```

### parallel

```runeflow
parallel gather {
  steps: [fetch_tags, fetch_log]
}

step fetch_tags type=cli {
  command: "git tag --sort=-v:refname | head -5"
}

step fetch_log type=cli {
  command: "git log --oneline -20"
}
```

Fans out `cli`, `llm`, and `tool` steps concurrently. Child steps must be declared immediately after the `parallel` block in matching order and may not reference each other. `llm` children must declare a `schema`.

### branch

```runeflow
branch check {
  if: steps.current_branch.stdout matches "^feat/"
  then: feature_flow
  else: other_flow
}
```

### transform

```runeflow
step filter type=transform {
  input: steps.fetch.items
  expr: "input.filter(x => x.state === 'open').map(x => x.id)"
  out: [number]
}
```

### tool

Use `tool:` when you need a typed, schema-validated call into an MCP server, Composio toolkit, or the [built-in registry](#built-in-tools). For plain shell commands, prefer `cli`.

```runeflow
step fetch_issue type=tool {
  tool: mcp.linear.get_issue
  with: { id: inputs.issue_id }
  out: { title: string, state: string }
}
```

### human_input

```runeflow
step confirm type=human_input {
  prompt: "Deploy to production?"
  required: true
  choices: ["yes", "no"]
  default: "no"
}
```

The step outputs `{ answer: string }`. Reference it downstream with `steps.confirm.answer`.

| Field | Default | Behavior |
|---|---|---|
| `required` omitted | — | Uses `default` if set, otherwise `answer` is `null` — run continues |
| `required: false` | — | Same as omitted — explicit opt-out |
| `required: true` | — | No answer halts the run with `halted_on_input` for later `resume` |

Provide answers up front with `--prompt '{"confirm":"yes"}'` to run non-interactively. Resume a halted run with `runeflow resume --prompt '{"confirm":"yes"}'`.

Use `required: false` with `skip_if` to make a step fully optional:

```runeflow
step ask_title type=human_input skip_if="inputs.title" {
  prompt: "Short title for this checkpoint:"
  required: false
  default: "work-in-progress"
}

step summarize type=llm {
  prompt: "Summarize work on {{ inputs.title or steps.ask_title.answer }}."
  schema: { summary: string }
}
```

### block

```runeflow
block greet_template type=llm {
  prompt: "Reply with a single short greeting for {{ inputs.name }}."
  schema: { greeting: string }
}

step greet type=block {
  block: greet_template
}
```

Blocks can also be imported from another file:

```runeflow
import blocks from "./shared/pr-blocks.md"

step check type=block {
  block: check_file_exists
}
```

### fail

```runeflow
step abort type=fail {
  message: "Validation failed for {{ inputs.pr_number }}"
  data: { pr_number: inputs.pr_number, reason: steps.check.reason }
}
```

---

## Expressions

String fields support `{{ expr }}` interpolation. Bare fields support expression syntax.

| Syntax | Example |
|---|---|
| Input | `inputs.base_branch` |
| Step output | `steps.draft.title` |
| Step metadata | `steps.draft.status`, `steps.draft.result_path` |
| Const | `const.model` |
| Comparison | `steps.check.exists == true` |
| Regex | `inputs.branch matches "^feat/"` |
| Logic | `inputs.flag and not steps.check.exists` |

---

## Built-in tools

> **First check if `cli` works.** For anything a shell can run — `git`, `gh`, `npm`, `curl` — use a `cli` step. Built-in tools exist for the narrow cases where you need typed outputs or a structured return shape that's awkward to parse from stdout.

| Tool | Description | Usually simpler as |
|---|---|---|
| `git.current_branch` | Current branch name | `cli: git rev-parse --abbrev-ref HEAD` |
| `git.diff_summary` | Diff stat between base ref and HEAD | `cli: git diff --stat {{ inputs.base }}...HEAD` |
| `git.push_current_branch` | Push current branch to upstream | `cli: git push -u origin HEAD` |
| `git.log` | Commit log between a base ref and HEAD | `cli: git log --oneline {{ inputs.base }}..HEAD` |
| `git.tag_list` | List tags sorted by version, newest first | `cli: git tag --sort=-v:refname` |
| `file.exists` | Check if a path exists | `cli: test -e <path> && echo yes` |
| `file.read` | Read a file's contents | `cli: cat <path>` |
| `file.write` | Write content to a file | `cli: echo ... > <path>` |
| `util.complete` | Pass-through — returns its input as output | — |
| `util.fail` | Return a structured failure message | — |

```bash
runeflow tools list
runeflow tools inspect git.diff_summary
```

---

## CLI reference

```bash
runeflow init [--name <name>] [--context <hint>] [--template <id>]
              [--provider <provider>] [--model <model>]
              [--no-local-llm] [--no-polish] [--force]
runeflow validate <file> [--runtime ./runtime.js] [--format json]
runeflow run <file> --input '{"key":"value"}' [--provider <name>] [--model <name>]
            [--runtime ./runtime.js] [--runs-dir ./.runeflow-runs] [--force]
            [--record-fixture <path>]
            [--telemetry] [--telemetry-output <path>]
runeflow dryrun <file> --input '{"key":"value"}' [--runtime ./runtime.js]
runeflow test <file> --fixture <fixture.json> [--runtime ./runtime.js]
            [--runs-dir ./.runeflow-runs]
runeflow resume <file> [--runtime ./runtime.js] [--runs-dir ./.runeflow-runs]
               [--prompt '{"step":"answer"}']
runeflow watch <file> [--input '{"key":"value"}'] [--runtime ./runtime.js]
              [--runs-dir ./.runeflow-runs]
              [--cron "0 9 * * 1-5"] [--on-change "src/**/*.js"]
runeflow assemble <file> --step <step-id> --input '{"key":"value"}' [--runtime ./runtime.js]
                 [--output context.md] [--format markdown|json]
runeflow inspect-run <run-id> [--runs-dir ./.runeflow-runs]
                    [--step <step-id>] [--format table|json]
runeflow build <description> [--provider <p>] [--model <m>] [--out <file>] [--runtime ./runtime.js]
runeflow import <file> [--output converted.md]
runeflow tools list [--runtime ./runtime.js]
runeflow tools inspect <tool-name> [--runtime ./runtime.js]
runeflow skills list
runeflow skills run <name> [--input '{"key":"value"}'] [--runtime ./runtime.js]
```

`init` — inspects the current directory and generates a ready-to-run `.md` skill in `.runeflow/skills/`. Detects installed SDKs, git history, CI config, and existing runeflow files to pick the best template. Generated workflows bias toward the minimum-surface path: `cli` first when possible, no `llm:` frontmatter unless you explicitly pin it, and follow-up commands that use `runeflow skills run`.

`dryrun` — validates the file, then walks every step resolving all bindings with the provided inputs — but executes nothing. Shows exactly what each step would do: resolved arguments, prompts, commands, and branch conditions. Steps that depend on prior outputs use typed placeholders derived from the output schema.

`test` — runs a skill against a fixture with all LLM and tool calls mocked. Tool mocks may be keyed by step id or tool name; recorded fixtures use step ids so multiple steps can mock the same tool independently. Test output includes the observed tool and LLM call traces to help tighten fixtures. Write fixtures by hand or generate them from a real run with `run --record-fixture <path>`.

`resume` — reads the most recent `halted_on_error` or `halted_on_input` run, replays completed steps from cache, and retries from the halt point.

`watch` — runs a `.md` skill file on a cron schedule, on file changes, or both.

`assemble` — executes all steps before a target `llm` step (tool, cli, transform, `parallel`, and any earlier llm steps), resolves the prompt with real values, and writes a clean Markdown context file for an agent to load. JSON output also includes pre-step execution metadata and notes about token-spending llm pre-steps or placeholder human input values. If earlier llm steps exist, they run and consume tokens. See [Assemble mode](#assemble-mode).

`inspect-run` — reads a run artifact by run ID. Use `--format table` for a compact step timeline. Use `--step <id>` to drill into a single step's artifact.

`build` — compiles an English description into a `.md` skill file using the LLM execution path.

`run --record-fixture <path>` — writes a test fixture JSON after a real run, capturing inputs, per-step tool and LLM outputs as mocks, and the final status.

`run --telemetry` — emits one OTLP JSON span per step to stderr after the run. Each span includes step id, kind, status, duration, attempts, and token usage. Redirect with `--telemetry-output <path>` or pipe stderr into any OpenTelemetry collector. No SDK dependency required.

`skills list` / `skills run <name>` — scans `.runeflow/skills/` and runs skills by name. See [Skill discovery](#skill-discovery).

---

## Writing a runtime

The default runtime activates automatically when no `--runtime` flag is passed. It has two zero-install paths built in:

| Auto priority | Path | Requirement |
|---|---|---|
| 1 | `claude-cli` | `claude` CLI on PATH |
| 2 | `gateway` | `AI_GATEWAY_API_KEY` |

To use it explicitly in code:

```js
// runtime.js
import { createDefaultRuntime } from "runeflow";
export default createDefaultRuntime();
```

| Explicit provider | Package | Key / Requirement |
|---|---|---|
| `gateway` | none | `AI_GATEWAY_API_KEY` |
| `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| `cerebras` | `@ai-sdk/cerebras` | `CEREBRAS_API_KEY` |
| `google` | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `groq` | `@ai-sdk/groq` | `GROQ_API_KEY` |
| `mistral` | `@ai-sdk/mistral` | `MISTRAL_API_KEY` |
| `claude-cli` | none | `claude` CLI on PATH |

Keys are resolved via the auth waterfall: `process.env` → `.env` file → `~/.runeflow/credentials.json`.

**Auto-selection.** When a skill omits `llm.provider`, the runtime prefers Claude Code and otherwise falls back to AI Gateway. A model-only config such as `model: anthropic/claude-sonnet-4.6` also selects Gateway automatically. You'll see a one-line `runeflow: auto-selected provider=…` note on stderr; silence it with `RUNEFLOW_QUIET=1`.

**Advanced direct providers.** If you want to skip Gateway, use an explicit provider such as `openai` or `anthropic` and install the matching `@ai-sdk/*` package. That path is opt-in and keeps the default UX simple.

To add a custom provider or override behavior:

```js
import { createDefaultRuntime } from "runeflow";

const base = createDefaultRuntime();

export default {
  ...base,
  llms: {
    ...base.llms,
    ollama: async ({ llm, prompt, input, schema, docs }) => {
      // call your LLM, return an object matching schema
      return { title: "..." };
    },
  },
  hooks: {
    beforeStep: async ({ runId, step, state }) => {},
    afterStep: async ({ runId, step, stepRun, state }) => {},
    onStepError: async ({ runId, step, error, attempts, state }) => {},
  },
};
```

`beforeStep` can abort a run by returning `{ abort: true, reason: "..." }`.

### Runtime plugins

Plugins let tools and their schemas plug in without being hard-wired into core:

```js
import { createDefaultRuntime, createMcpClientPlugin } from "runeflow";

const docsPlugin = await createMcpClientPlugin({
  serverName: "docs",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  stderr: "inherit",
});

export default {
  ...createDefaultRuntime(),
  plugins: [docsPlugin],
};
```

When a tool does not publish a structured output schema, adapter plugins fall back to a standard envelope:

```js
{ content: [any], isError: boolean, raw: any }
```

Composio fits the same surface:

```js
import { createDefaultRuntime, createComposioClientPlugin } from "runeflow";

const composioPlugin = await createComposioClientPlugin({
  toolkits: ["linear"],
  executeDefaults: {
    connectedAccountId: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    userId: process.env.COMPOSIO_USER_ID,
  },
});

export default {
  ...createDefaultRuntime(),
  plugins: [composioPlugin],
};
```

---

## 🔧 Assemble (Preprocessor for Agents)

When an agent receives a raw `.md` runeflow file, it sees DSL syntax, tool wiring, retry logic, and orchestration instructions it doesn't need. This wastes tokens and can confuse the agent into trying to interpret or re-execute the workflow itself. The agent only needs one thing: a focused job with real values already resolved.

On orchestration-heavy tasks, `assemble` reduces input tokens by up to 82% — because the agent never sees the orchestration layer at all.

### How it works

`runeflow assemble` executes all steps before the target — tool calls, cli commands, transforms — resolves the prompt with real values, and writes a clean Markdown context file. The agent loads that file and sees only what it needs for one step.

The `open-pr-gh` example is the clearest demonstration. This is the workflow that opened [the first pull request to this repo](https://github.com/paritoshmmmec/runeflow/pull/1) — diffing the branch, drafting the title and body via LLM, and running `gh pr create` as a `cli` step.

Step 1 — run assemble:

```bash
runeflow assemble ./examples/open-pr-gh.md \
  --step draft \
  --input '{"base_branch":"main"}' \
  --output context.md
```

Step 2 — pass to agent:

```bash
# Load context.md into Claude Code, Codex, or Cursor
# The agent sees only the resolved prompt and output schema — no DSL, no tool wiring
```

Here's what the agent actually receives in `context.md`:

````md
## Your task

Draft a pull request for feat/my-feature → main.
Changed files: ["src/runtime.js", "src/cli.js"]
Diff: src/runtime.js | 45 +++...

## Output schema

Respond with a JSON object matching this schema exactly. Output only the JSON — no markdown fences, no explanation.

```json
{
  "title": "string",
  "body": "string"
}
```
````

No `runeflow` block. No tool wiring. No orchestration instructions. Just the resolved context and a clear output contract.

Note: if your workflow has `llm` steps before the target, those run and consume tokens during assembly. For zero-token assembly, structure pre-steps as `tool`, `cli`, or `transform` steps.

### When to use assemble vs run

| Use `run` when... | Use `assemble` when... |
|---|---|
| The full workflow is automated end-to-end | You want a human or agent to handle one specific LLM step |
| You are in CI/CD or a script | You are using Claude Code, Codex, or Cursor |
| All steps are deterministic | The LLM step benefits from human review before execution |

---

## MCP server mode

`runeflow-mcp` exposes `runeflow_run` and `runeflow_validate` as MCP tools. Any MCP-compatible agent calls them directly — no preprocessing step, no file handoff.

```bash
npm install -g runeflow-mcp
```

Add to your MCP config (`.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "runeflow": {
      "command": "npx",
      "args": ["runeflow-mcp"],
      "env": {
        "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}"
      }
    }
  }
}
```

The agent never sees the skill file internals. It gets back `{ status, run_id, outputs }`.

---

## Integration modes

| Mode | How | Best for |
|---|---|---|
| Top-level executor | `runRuneflow()` / `runeflow run` | Scripts, CI/CD, backends |
| Assemble | `runeflow assemble` → agent loads context file | Claude Code, Codex, Cursor |
| MCP server | `runeflow-mcp` exposes `runeflow_run` as MCP tool | Any MCP-compatible agent |

---

## Zero-config MCP & Composio wiring

Declare `mcp_servers` or `composio` directly in frontmatter — no separate runtime file needed.

### `mcp_servers`

````md
---
name: my-skill
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  my-api:
    url: https://my-api.example.com/mcp
    headers:
      Authorization: "Bearer ${MY_API_TOKEN}"
---
````

> `${MY_API_TOKEN}` uses env var interpolation. By default only a curated allowlist of known keys is expanded — add yours with `RUNEFLOW_ENV_ALLOWLIST=MY_API_TOKEN` or use an already-allowlisted name like `GITHUB_TOKEN`. See [Trust model](#trust-model) for details.

```runeflow
step read type=tool {
  tool: mcp.filesystem.read_file
  with: { path: "README.md" }
  out: { content: string }
}
```

Tools are available as `mcp.<server-name>.<tool-name>`. Runeflow connects, discovers tools, and cleans up after the run automatically.

### `composio`

````md
---
name: my-skill
composio:
  toolkits: [github, linear]
  executeDefaults:
    userId: ${COMPOSIO_USER_ID}
    connectedAccountId: ${COMPOSIO_CONNECTED_ACCOUNT_ID}
---
````

Requires `COMPOSIO_API_KEY` and `npm install @composio/core`. Tools are available as `composio.<toolkit>.<tool>`.

---

## runeflow-registry

Official tool registry with schemas and implementations for common providers.

```bash
npm install runeflow-registry

# install the provider packages you need
npm install @octokit/rest       # github
npm install @linear/sdk         # linear
npm install @slack/web-api      # slack
npm install @notionhq/client    # notion
```

```js
// runtime.js
import { createDefaultRuntime } from "runeflow";
import { github, linear, slack } from "runeflow-registry";

export default {
  ...createDefaultRuntime(),
  tools: {
    ...github({ token: process.env.GITHUB_TOKEN }),
    ...linear({ apiKey: process.env.LINEAR_API_KEY }),
    ...slack({ token: process.env.SLACK_BOT_TOKEN }),
  },
};
```

| Provider | Package | Tools |
|---|---|---|
| `github` | `@octokit/rest` | `github.get_pr`, `github.create_pr`, `github.merge_pr`, `github.add_label`, `github.create_issue` |
| `linear` | `@linear/sdk` | `linear.create_issue`, `linear.update_issue` |
| `slack` | `@slack/web-api` | `slack.post_message`, `slack.get_channel_history` |
| `notion` | `@notionhq/client` | `notion.create_page`, `notion.query_database` |

When `runeflow-registry` is installed, its schemas are picked up automatically by `runeflow tools list` and `runeflow validate` — no registry directory needed.

---

## Extending the tool registry

**Project-level directory** — drop JSON files in `<project>/registry/tools/`. They merge on top of the built-in registry automatically:

```json
{
  "name": "stripe.charge",
  "description": "Create a Stripe charge.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "amount": { "type": "number" },
      "currency": { "type": "string" }
    },
    "required": ["amount", "currency"]
  },
  "outputSchema": {
    "type": "object",
    "properties": { "charge_id": { "type": "string" } },
    "required": ["charge_id"]
  }
}
```

**Programmatic** — pass `toolRegistry` to `runRuneflow` or `validateRuneflow`:

```js
await runRuneflow(definition, inputs, runtime, {
  toolRegistry: [
    { name: "stripe.charge", inputSchema: { ... }, outputSchema: { ... } },
  ],
});
```

---

## Skill discovery

Project-level skills live in `.runeflow/skills/`. `runeflow init` writes there by default, and any `.md` file in that directory containing a `runeflow` block is discoverable:

```bash
runeflow skills list
runeflow skills run draft-pr --input '{"base_branch":"main"}'
```

Add an entry to your `AGENTS.md` so agents can find and invoke skills without being told the full path:

```md
## Runeflow Skills
Skills are in `.runeflow/skills/`. Run `runeflow skills list` to see available workflows.
```

---

## Examples

| File | What it shows |
|---|---|
| [`examples/open-pr.md`](./examples/open-pr.md) | PR prep — tool steps + LLM |
| [`examples/open-pr-gh.md`](./examples/open-pr-gh.md) | Full PR open — `cli` step with `gh pr create` |
| [`examples/review-draft.md`](./examples/review-draft.md) | Code review notes — step-level LLM override |
| [`examples/release-notes.md`](./examples/release-notes.md) | Release notes — `transform` + `const` + LLM |
| [`examples/block-demo.md`](./examples/block-demo.md) | Reusable block templates |
| [`examples/import-demo.md`](./examples/import-demo.md) | Cross-file block imports |
| [`examples/triage-issues.md`](./examples/triage-issues.md) | Issue triage — `branch` + `transform` + LLM classification |
| [`examples/composio-github.md`](./examples/composio-github.md) | Composio adapter — GitHub API via plugin |
| [`examples/checkpoint.md`](./examples/checkpoint.md) | Save/resume working state — `human_input` + multi-block + `transform` |

---

## Caching

Every step records an `input_hash`. On subsequent runs with `priorSteps`, steps whose resolved inputs haven't changed are replayed from cache. Add `cache=false` to opt out:

```runeflow
step push type=tool cache=false {
  tool: git.push_current_branch
  out: { branch: string, remote: string }
}
```

---

## Trust model

- `.md` skill files define `transform` expressions — treat them as trusted code in the host process
- `transform` runs via `vm.runInNewContext` with a restricted context (no `process`, no `require`, no `fs`). Set `RUNEFLOW_DISABLE_TRANSFORM=1` to block transform steps entirely
- `cli` steps run shell commands via `sh -c` — treat skill files as executable code
- `--runtime ./path.js` loads that module via Node `import()` — only load trusted runtimes
- `mcp_servers` and `composio` frontmatter support `${VAR}` env var interpolation. Only a curated allowlist of known integration keys can be expanded by default. Extend or disable it:

```bash
# Add extra allowed variables
export RUNEFLOW_ENV_ALLOWLIST=MY_CUSTOM_TOKEN,DEPLOY_KEY

# Disable the allowlist entirely
export RUNEFLOW_ENV_ALLOWLIST=*
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, workflow, and what's in scope.

---

## License

MIT
