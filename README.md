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

Prompt-based automations break in predictable ways. The model decides what to call, in what order, with what inputs. Retries are ad hoc. Outputs are unvalidated. Runs are invisible after the fact. When something goes wrong, there's nothing to inspect.

The root cause is that workflow logic — sequencing, branching, validation, tool calls — is hiding inside the prompt where it doesn't belong.

## The solution

Runeflow moves execution semantics out of the prompt and into a small runtime. One `.runeflow.md` file combines human-readable guidance with a typed, executable workflow block. The runtime owns sequencing, branching, retries, tool execution, and schema validation. The LLM sees only what it needs: a tight prompt, the relevant docs, and the output schema.

Prompts are good for judgment and language. They're a bad place to hide workflow logic. Runeflow puts workflow logic back in code, while keeping authoring lightweight and human-readable.

---

## Why it works

**Readable** — Markdown-first workflows live in your repo and review cleanly in diffs. Guidance for humans and execution logic for the runtime, in one file.

**Reliable** — Validation, schemas, retries, and branching happen before tokens are wasted. Static preflight catches broken references and type mismatches before execution.

**Agent-friendly** — Precompute context with `runeflow assemble` and hand agents only the step they need. This is how the -82% input token reduction works in practice.

---

## What it's for

Runeflow is a strong fit for repo-local developer workflows with light-to-moderate AI involvement:

- PR drafting and code review summaries
- Release notes generation
- Issue creation from CI failures
- Agent pre-processing (assemble mode)
- Scheduled repo automation

It works well alongside existing agents (Claude Code, Codex, Cursor) rather than replacing them.

## What it's not

- A general-purpose DAG engine
- A no-code automation platform
- A multi-agent autonomy framework
- A replacement for app backends or job systems
- A visual workflow builder

---

## Benchmarks

Evaluated across 4 task types, 2 providers (OpenAI, Cerebras):

| Task | Raw input tokens | Runeflow input tokens | Reduction |
|---|---|---|---|
| adyntel-automation | 810 | 128 | **-84%** 🔥 |
| addresszen-automation | 817 | 150 | **-82%** 🔥 |
| 3p-updates | 825 | 508 | **-38%** |
| open-pr | 219 | 236 | neutral |

On orchestration-heavy tasks, raw prompts fall into tool-discovery loops. Runeflow eliminates this failure mode entirely. See [benchmark_report.md](./benchmark_report.md) for full data.

> The [first pull request to this repo](https://github.com/paritoshmmmec/runeflow/pull/1) was opened by Runeflow itself — using `examples/open-pr-gh.runeflow.md` to diff the branch, draft the title and body via LLM, and run `gh pr create` as a `cli` step.

---

## Contents

- [Quickstart](#quickstart)
- [Core Loop](#core-loop)
- [Debugging a broken skill](#debugging-a-broken-skill)
- [File shape](#file-shape)
- [Step kinds](#step-kinds)
- [Expressions](#expressions)
- [Built-in tools](#built-in-tools)
- [CLI reference](#cli-reference)
- [Writing a runtime](#writing-a-runtime)
- [Assemble mode](#assemble-mode)
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

**Install a provider and add your key**

Runeflow uses the [Vercel AI SDK](https://sdk.vercel.ai) under the hood. Install the package for your provider:

```bash
# pick one
npm install @ai-sdk/cerebras    # CEREBRAS_API_KEY  — free tier at cloud.cerebras.ai
npm install @ai-sdk/openai      # OPENAI_API_KEY
npm install @ai-sdk/anthropic   # ANTHROPIC_API_KEY
npm install @ai-sdk/groq        # GROQ_API_KEY      — free tier at console.groq.com
npm install @ai-sdk/mistral     # MISTRAL_API_KEY
npm install @ai-sdk/google      # GOOGLE_GENERATIVE_AI_API_KEY
```

```bash
echo "CEREBRAS_API_KEY=your-key-here" > .env
```

**Generate a skill with `runeflow init`**

Run inside any project directory. It inspects your repo — `package.json`, git log, CI config, installed SDKs, existing `.runeflow.md` files — and generates a ready-to-run `.runeflow.md` tailored to what it finds.

```bash
runeflow init
```

If a cloud API key is present, the generated skill is polished by that provider. If not, a small local model (`Qwen2.5-0.5B`) is downloaded to `~/.runeflow/models/` and used instead — no sign-up required.

**Or write one by hand:**

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
llm:
  provider: cerebras
  model: qwen-3-235b-a22b-instruct-2507
---

# Draft PR

Write a concise PR title and a short body describing what changed and why.

```runeflow
step branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}

step draft type=llm {
  prompt: |
    Draft a PR for {{ steps.branch.branch }} → {{ inputs.base_branch }}.
    Changed files: {{ steps.diff.files }}
    Diff: {{ steps.diff.summary }}
  input: { diff_summary: steps.diff.summary }
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
```
````

**Run it**

```bash
runeflow run ./draft-pr.runeflow.md --input '{"base_branch":"main"}'
```

The default runtime handles all 6 providers automatically — no `--runtime` flag needed. Keys are resolved from `process.env` or a `.env` file in the current directory.

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
runeflow validate ./draft-pr.runeflow.md
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
runeflow validate ./my-skill.runeflow.md
```

Validation is static — no API calls, no git. It catches broken step references, missing inputs, and schema mismatches before you spend tokens. Fix any errors here before going further.

**2. Dryrun to see what each step would do**

```bash
runeflow dryrun ./my-skill.runeflow.md --input '{"base_branch":"main"}'
```

Dryrun walks every step and resolves all bindings without executing anything. It shows the resolved prompt, tool arguments, branch conditions, and command strings. If a step would receive the wrong input, you'll see it here.

**3. Run and inspect the artifact**

```bash
runeflow run ./my-skill.runeflow.md --input '{"base_branch":"main"}'
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
runeflow resume ./my-skill.runeflow.md
```

**5. Record a fixture and test**

Once the run succeeds, record it as a fixture so you can catch regressions without real API calls:

```bash
runeflow run ./my-skill.runeflow.md --input '{"base_branch":"main"}' --record-fixture test/fixtures/my-skill.fixture.json
```

Then run it in test mode:

```bash
runeflow test ./my-skill.runeflow.md --fixture test/fixtures/my-skill.fixture.json
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

A `.runeflow.md` is a standard Markdown document. YAML frontmatter declares inputs and outputs. The prose is guidance for the LLM. The `runeflow` block is the executable workflow.

The `.runeflow.md` suffix is a convention, not a requirement. Any `.md` file containing a `runeflow` block is valid.

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
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Prepare PR

Operator guidance lives here. The runtime projects this to `llm` steps as `docs`.

```runeflow
step current_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step draft_pr type=llm {
  prompt: "Draft a PR for {{ steps.current_branch.branch }} targeting {{ inputs.base_branch }}."
  input: { branch: steps.current_branch.branch }
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

| Kind | What it does |
|---|---|
| `tool` | Calls a registered tool, validates output against `out` schema |
| `parallel` | Runs a group of `tool`, `llm`, or `cli` steps concurrently, joins outputs |
| `llm` | Calls an LLM handler, validates output against `schema` |
| `cli` | Runs a shell command, captures `stdout`, `stderr`, `exit_code` |
| `human_input` | Collects an answer from `--prompt`, a handler, or halts for resume |
| `transform` | Runs a JS expression over resolved `input`, validates against `out` |
| `branch` | Evaluates an expression, routes to `then` or `else` step |
| `block` | Instantiates a named `block` template |

Control flow: `retry=N`, `retry_delay`, `retry_backoff`, `fallback=<step>`, `next=<step>`, `skip_if: <expr>`, terminal `fail`.

### tool

```runeflow
step check type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}
```

### parallel

```runeflow
parallel gather {
  steps: [fetch_slack, fetch_drive]
}

step fetch_slack type=tool {
  tool: slack.fetch
  out: { items: [string] }
}

step fetch_drive type=tool {
  tool: drive.fetch
  out: { items: [string] }
}
```

Fans out `tool`, `llm`, and `cli` steps concurrently. Child steps must be declared immediately after the `parallel` block in matching order and may not reference each other. `llm` children must declare a `schema`.

### llm

```runeflow
step draft type=llm {
  prompt: "Draft release notes since {{ inputs.base_ref }}."
  input: { diff: steps.diff.summary }
  schema: { title: string, highlights: [string] }
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

### branch

```runeflow
branch check {
  if: steps.current_branch.branch matches "^feat/"
  then: feature_flow
  else: other_flow
}
```

### cli

```runeflow
step create_pr type=cli cache=false {
  command: "gh pr create --title '{{ steps.draft.title }}' --base {{ inputs.base_branch }}"
}
```

Non-zero exit code halts the run by default. Add `allow_failure: true` to capture it instead.

### human_input

```runeflow
step confirm type=human_input {
  prompt: "Deploy to production?"
  choices: ["yes", "no"]
}
```

Provide answers up front with `--prompt '{"confirm":"yes"}'`, or let the runtime halt with `halted_on_input` and continue later with `runeflow resume`.

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
import blocks from "./shared/pr-blocks.runeflow.md"

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

| Tool | Description |
|---|---|
| `git.current_branch` | Current branch name |
| `git.diff_summary` | Diff stat between base ref and HEAD |
| `git.push_current_branch` | Push current branch to upstream |
| `git.log` | Commit log between a base ref and HEAD |
| `git.tag_list` | List tags sorted by version, newest first |
| `file.exists` | Check if a path exists |
| `file.read` | Read a file's contents |
| `file.write` | Write content to a file |
| `util.complete` | Pass-through — returns its input as output |
| `util.fail` | Return a structured failure message |

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
runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js]
            [--runs-dir ./.runeflow-runs] [--force]
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
runeflow import <file> [--output converted.runeflow.md]
runeflow tools list [--runtime ./runtime.js]
runeflow tools inspect <tool-name> [--runtime ./runtime.js]
runeflow skills list
runeflow skills run <name> [--input '{"key":"value"}'] [--runtime ./runtime.js]
```

`init` — inspects the current directory and generates a ready-to-run `.runeflow.md`. Detects installed SDKs, git history, CI config, and existing `.runeflow.md` files to pick the best template. Pass `--context` for a hint, `--template` to force one, or `--no-local-llm` to skip the local model download.

`dryrun` — validates the file, then walks every step resolving all bindings with the provided inputs — but executes nothing. Shows exactly what each step would do: resolved arguments, prompts, commands, and branch conditions. Steps that depend on prior outputs use typed placeholders derived from the output schema.

`test` — runs a skill against a fixture with all LLM and tool calls mocked. Tool mocks may be keyed by step id or tool name; recorded fixtures use step ids so multiple steps can mock the same tool independently. Test output includes the observed tool and LLM call traces to help tighten fixtures. Write fixtures by hand or generate them from a real run with `run --record-fixture <path>`.

`resume` — reads the most recent `halted_on_error` or `halted_on_input` run, replays completed steps from cache, and retries from the halt point.

`watch` — runs a `.runeflow.md` on a cron schedule, on file changes, or both.

`assemble` — executes all steps before a target `llm` step (tool, cli, transform, `parallel`, and any earlier llm steps), resolves the prompt with real values, and writes a clean Markdown context file for an agent to load. JSON output also includes pre-step execution metadata and notes about token-spending llm pre-steps or placeholder human input values. If earlier llm steps exist, they run and consume tokens. See [Assemble mode](#assemble-mode).

`inspect-run` — reads a run artifact by run ID. Use `--format table` for a compact step timeline. Use `--step <id>` to drill into a single step's artifact.

`build` — compiles an English description into a `.runeflow.md` using the LLM execution path.

`run --record-fixture <path>` — writes a test fixture JSON after a real run, capturing inputs, per-step tool and LLM outputs as mocks, and the final status.

`run --telemetry` — emits one OTLP JSON span per step to stderr after the run. Each span includes step id, kind, status, duration, attempts, and token usage. Redirect with `--telemetry-output <path>` or pipe stderr into any OpenTelemetry collector. No SDK dependency required.

`skills list` / `skills run <name>` — scans `.runeflow/skills/` and runs skills by name. See [Skill discovery](#skill-discovery).

---

## Writing a runtime

The default runtime activates automatically when no `--runtime` flag is passed. It supports 6 providers via the [Vercel AI SDK](https://sdk.vercel.ai). Install the packages for the providers you need:

```bash
npm install @ai-sdk/cerebras   # or openai, anthropic, groq, mistral, google
```

To use it explicitly in code:

```js
// runtime.js
import { createDefaultRuntime } from "runeflow";
export default createDefaultRuntime();
```

| Provider | Package | Key |
|---|---|---|
| `cerebras` | `@ai-sdk/cerebras` | `CEREBRAS_API_KEY` |
| `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |
| `groq` | `@ai-sdk/groq` | `GROQ_API_KEY` |
| `mistral` | `@ai-sdk/mistral` | `MISTRAL_API_KEY` |
| `google` | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` |

Keys are resolved via the auth waterfall: `process.env` → `.env` file → `~/.runeflow/credentials.json`.

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

## Assemble mode

`runeflow assemble` is how Runeflow works alongside existing agents rather than replacing them.

You run `runeflow assemble` before invoking an agent. Runeflow executes all steps before the target — tool calls, cli commands, transforms, and any earlier llm steps — resolves the prompt with real values, and writes a clean Markdown context file. The agent loads that file instead of the raw `.runeflow.md`. It sees only what it needs for one step.

Note: if your workflow has llm steps before the target, those run and consume tokens during assembly. If you want zero-token assembly, structure your workflow so all pre-steps are tool, cli, or transform steps.

```bash
runeflow assemble ./draft-pr.runeflow.md \
  --step draft \
  --input '{"base_branch":"main"}' \
  --output context.md
```

The output contains the resolved prompt, operator docs, resolved input, and output schema. No `runeflow` block, no tool wiring, no DSL:

```md
# draft-pr — assembled context for `draft`

## Guidance
Write a concise PR title and body...

## Your task
Draft a PR for feat/my-feature → main.
Changed files: ["src/runtime.js", "src/cli.js"]
Diff: src/runtime.js | 45 +++...

## Output schema
{ "title": "string", "body": "string" }
```

This is how the -82% token reduction works in practice — the agent never sees orchestration instructions.

Best for: Claude Code, Codex, Cursor, or any agent that reads files as context. Works today with zero agent integration required.

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

The agent never sees the `.runeflow.md` internals. It gets back `{ status, run_id, outputs }`.

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

Project-level skills live in `.runeflow/skills/`. Any `.runeflow.md` file there is discoverable:

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
| [`examples/open-pr.runeflow.md`](./examples/open-pr.runeflow.md) | PR prep — tool steps + LLM |
| [`examples/open-pr-gh.runeflow.md`](./examples/open-pr-gh.runeflow.md) | Full PR open — `cli` step with `gh pr create` |
| [`examples/review-draft.runeflow.md`](./examples/review-draft.runeflow.md) | Code review notes — step-level LLM override |
| [`examples/release-notes.runeflow.md`](./examples/release-notes.runeflow.md) | Release notes — `transform` + `const` + LLM |
| [`examples/block-demo.runeflow.md`](./examples/block-demo.runeflow.md) | Reusable block templates |
| [`examples/import-demo.runeflow.md`](./examples/import-demo.runeflow.md) | Cross-file block imports |
| [`examples/triage-issues.runeflow.md`](./examples/triage-issues.runeflow.md) | Issue triage — `branch` + `transform` + LLM classification |
| [`examples/composio-github.runeflow.md`](./examples/composio-github.runeflow.md) | Composio adapter — GitHub API via plugin |

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

- `.runeflow.md` files define `transform` expressions — treat them as trusted code in the host process
- `transform` runs via `vm.runInNewContext` with a restricted context (no `process`, no `require`, no `fs`). Set `RUNEFLOW_DISABLE_TRANSFORM=1` to block transform steps entirely
- `cli` steps run shell commands via `sh -c` — treat `.runeflow.md` files as executable code
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
