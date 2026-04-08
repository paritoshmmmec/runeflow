<div align="center">

# ⚡ Runeflow

**A strict, deterministic runtime for hybrid AI skills.**

The runtime owns 100% of workflow logic. The LLM only participates where you explicitly say so.

[![npm version](https://img.shields.io/npm/v/runeflow?color=blueviolet)](https://www.npmjs.com/package/runeflow)
[![CI](https://github.com/paritoshmmmec/runeflow/actions/workflows/ci.yml/badge.svg)](https://github.com/paritoshmmmec/runeflow/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)
[![node](https://img.shields.io/badge/node-%3E%3D20-green)](#)

</div>

---

## 🤔 The Problem

Most AI skills are just prompt text. The model informally decides what to do, which tools to call, and in what order. That breaks down fast:

- control flow is implicit and unreliable
- tool calls and retries are ad hoc
- outputs are hard to validate
- runs are impossible to inspect after the fact
- orchestration instructions bloat every prompt

## 💡 The Solution

Runeflow moves execution semantics out of the prompt and into the runtime. One hybrid `.runeflow.md` file combines human-readable guidance with a typed, executable workflow block. The runtime owns sequencing, branching, retries, tool execution, and schema validation. The LLM sees only what it needs: a tight prompt, the relevant docs, and the output schema.

## 📊 Benchmarks

Evaluated across 4 task types, 2 providers (OpenAI, Cerebras):

| Task | Input tokens (raw) | Input tokens (Runeflow) | Reduction |
|---|---|---|---|
| adyntel-automation | 810 | 128 | **-84%** 🔥 |
| addresszen-automation | 817 | 150 | **-82%** 🔥 |
| 3p-updates | 825 | 508 | **-38%** |
| open-pr | 219 | 236 | neutral |

> On orchestration-heavy tasks, raw skills fall into tool-discovery loops. Runeflow eliminates this failure mode entirely. See [benchmark_report.md](./benchmark_report.md) for full data.

> 🤙 The [first pull request to this repo](https://github.com/paritoshmmmec/runeflow/pull/1) was opened by Runeflow itself — using `examples/open-pr-gh.runeflow.md` to diff the branch, draft the title and body via LLM, and run `gh pr create` as a `cli` step.

---

## 🚀 Quickstart

> Requires Node >= 20.

**Step 1 — Install**

```bash
npm install -g runeflow
```

**Step 2 — Install a provider package and add your API key**

Runeflow uses the [Vercel AI SDK](https://sdk.vercel.ai) under the hood. Install the package for your provider:

```bash
# pick one (or more)
npm install @ai-sdk/cerebras    # CEREBRAS_API_KEY  — free tier at cloud.cerebras.ai
npm install @ai-sdk/openai      # OPENAI_API_KEY
npm install @ai-sdk/anthropic   # ANTHROPIC_API_KEY
npm install @ai-sdk/groq        # GROQ_API_KEY      — free tier at console.groq.com
npm install @ai-sdk/mistral     # MISTRAL_API_KEY
npm install @ai-sdk/google      # GOOGLE_GENERATIVE_AI_API_KEY
```

Add your key to a `.env` file:

```bash
echo "CEREBRAS_API_KEY=your-key-here" > .env
```

**Step 3 — Create a skill file**

A skill is one Markdown file. The frontmatter declares inputs/outputs, the prose is guidance for the LLM, and the `runeflow` block is the executable workflow.

Create `draft-pr.runeflow.md` inside any git repo:

````md
---
name: draft-pr
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

**Step 4 — Run it**

The default runtime handles Cerebras, OpenAI, and Anthropic automatically — no extra config needed.

Export your key and run:

```bash
export CEREBRAS_API_KEY=your-key-here

runeflow run ./draft-pr.runeflow.md \
  --input '{"base_branch":"main"}' \
  --runtime node_modules/runeflow/src/default-runtime.js
```

Or load it from a `.env` file using Node's `--env-file` flag:

```bash
node --env-file=.env node_modules/.bin/runeflow run ./draft-pr.runeflow.md \
  --input '{"base_branch":"main"}' \
  --runtime node_modules/runeflow/src/default-runtime.js
```

Output:

```json
{
  "title": "feat: add retry logic to checkout step",
  "body": "Wraps the checkout tool call in a retry loop with exponential backoff..."
}
```

Every step also writes a JSON artifact to `.runeflow-runs/` — inputs, outputs, timing, and errors, all inspectable after the fact.

**Step 5 — Validate before you run**

Validation is static — no API calls, no git. Catches broken references and schema mismatches before execution:

```bash
runeflow validate ./draft-pr.runeflow.md
# { "valid": true, "issues": [] }
```

**Step 6 — Discover available tools**

```bash
runeflow tools list
runeflow tools inspect git.diff_summary
```

---

## 📄 Skill File Shape

A skill is one `.runeflow.md` file — YAML frontmatter, Markdown guidance, and a fenced `runeflow` block.

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

## 🧱 Step Kinds

| Kind | What it does |
|---|---|
| `tool` | Calls a registered tool, validates output against `out` schema |
| `parallel` | Runs a contiguous group of `tool` steps concurrently, joins their outputs |
| `llm` | Calls an LLM handler, validates output against `schema` |
| `cli` | Runs a shell command, captures `stdout`, `stderr`, `exit_code` |
| `human_input` | Collects an answer from `--prompt`, a prompt handler, or halts for resume |
| `transform` | Runs a JS expression over resolved `input`, validates against `out` |
| `branch` | Evaluates an expression, routes to `then` or `else` step |
| `block` | Instantiates a defined `block` template with overriding properties |

Control flow: `retry=N`, `fallback=<step>`, `next=<step>`, `skip_if: <expr>`, terminal `fail`.

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
  out: { results: [any] }
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

`parallel` only fans out `tool` steps. Child tool steps must be declared immediately after the `parallel` block in the same order, and they may not reference each other.

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
  out: { stdout: string, stderr: string, exit_code: number }
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

---

## 🔤 Expressions

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

## 🔧 Built-in Tools

| Tool | Description |
|---|---|
| `git.current_branch` | Current branch name |
| `git.diff_summary` | Diff stat between base ref and HEAD |
| `git.push_current_branch` | Push current branch to upstream |
| `git.log` | Commit log between a base ref and HEAD |
| `git.tag_list` | List tags sorted by version, newest first |
| `file.exists` | Check if a path exists |
| `file.read` | Read a file's contents |
| `file.write` | Write content to a file (creates dirs if needed) |
| `util.complete` | Pass-through — returns its input as output |
| `util.fail` | Return a structured failure message |

```bash
# See all tools including registry tools
runeflow tools list

# Full input/output schema for any tool
runeflow tools inspect git.diff_summary
```

---

## 🖥️ CLI Reference

```bash
runeflow init [--name <name>] [--provider <provider>]
runeflow validate <file> [--runtime ./runtime.js]
runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js] [--runs-dir ./.runeflow-runs] [--force]
runeflow resume <file> [--runtime ./runtime.js] [--prompt '{"step":"answer"}']
runeflow watch <file> [--input '{"key":"value"}'] [--runtime ./runtime.js] [--cron "0 9 * * 1-5"] [--on-change "src/**/*.js"]
runeflow assemble <file> --step <step-id> --input '{}' [--runtime ./runtime.js] [--output context.md]
runeflow inspect-run <run-id>
runeflow import <file> [--output converted.runeflow.md]
runeflow tools list [--runtime ./runtime.js]
runeflow tools inspect <tool-name> [--runtime ./runtime.js]
```

`resume` reads the most recent `halted_on_error` or `halted_on_input` run, replays completed steps from cache, and retries from the halt point.

`watch` runs a skill on a cron schedule, on file changes, or both. It reuses the normal `run` path, so artifacts, prompts, validation, and runtime loading behave the same way.

`assemble` runs all tool/transform steps before a target `llm` step, resolves the prompt with real values, and writes a clean Markdown context file for an agent (Claude Code, Codex, Cursor) to load instead of the raw skill.

---

## ✍️ Writing a Runtime

The default runtime is powered by the [Vercel AI SDK](https://sdk.vercel.ai) and supports 6 providers out of the box. Install the packages for the providers you need, then use `createDefaultRuntime()`:

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

Keys are resolved automatically via the auth waterfall: `process.env` → `.env` file → `~/.runeflow/credentials.json`. A clear error is thrown before execution if a key is missing.

To add a custom provider or override behavior, extend the base runtime:

```js
import { createDefaultRuntime } from "runeflow";

const base = createDefaultRuntime();

export default {
  ...base,
  llms: {
    ...base.llms,
    // add any provider the AI SDK supports, or a fully custom handler
    ollama: async ({ llm, prompt, input, schema, docs }) => {
      // call your LLM, return an object matching schema
      return { title: "..." };
    },
  },
  hooks: {
    beforeStep: async ({ step, state }) => {},   // optional, can abort
    afterStep: async ({ step, stepRun }) => {},  // optional, non-fatal
    onStepError: async ({ step, error }) => {},  // optional, non-fatal
  },
};
```

Runtime modules can also expose `plugins`, which lets tools and their schemas plug into Runeflow without being hard-wired into core runtime code:

```js
import { createDefaultRuntime, createMcpToolPlugin } from "runeflow";

export default {
  ...createDefaultRuntime(),
  plugins: [
    createMcpToolPlugin({
      serverName: "docs",
      tools: [
        {
          name: "search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
      callTool: async ({ input }) => ({
        content: [input],
        isError: false,
      }),
    }),
  ],
};
```

Plugin-contributed tool schemas are available to `runeflow run`, `runeflow validate`, and `runeflow tools inspect` when you pass the same `--runtime` module.

For a real MCP stdio server, use `createMcpClientPlugin(...)` and let Runeflow discover tools from `tools/list`:

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

Discovered MCP input schemas are normalized into Runeflow's validator shape. When a tool does not publish a structured output schema, adapter plugins fall back to a standard raw result envelope:

```js
{
  content: [any],
  isError: boolean,
  raw: any
}
```

Composio fits the same plugin surface:

```js
import { createDefaultRuntime, createComposioClientPlugin } from "runeflow";

const composioPlugin = await createComposioClientPlugin({
  toolkits: ["linear"],
  toolkitVersions: {
    linear: process.env.COMPOSIO_TOOLKIT_VERSION_LINEAR,
  },
  executeDefaults: {
    connectedAccountId: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    userId: process.env.COMPOSIO_USER_ID ?? process.env.COMPOSIO_ENTITY_ID,
  },
});

export default {
  ...createDefaultRuntime(),
  plugins: [composioPlugin],
};
```

The default Composio client plugin expects `COMPOSIO_API_KEY` and `@composio/core` for live discovery/execution. For authenticated tools, Composio also expects a connected account id and user id (`userId`; `entityId` / `entity_id` are accepted as aliases by Runeflow), and practical live execution usually wants a pinned toolkit version such as `COMPOSIO_TOOLKIT_VERSION_GITHUB`. For tests or custom auth flows, you can inject your own client with `createClient` or `client`.

---

## 📦 Examples

| File | What it shows |
|---|---|
| [`examples/open-pr.runeflow.md`](./examples/open-pr.runeflow.md) | PR prep — tool steps + LLM |
| [`examples/open-pr-gh.runeflow.md`](./examples/open-pr-gh.runeflow.md) | Full PR open — `cli` step with `gh pr create` |
| [`examples/review-draft.runeflow.md`](./examples/review-draft.runeflow.md) | Code review notes — step-level LLM override |
| [`examples/release-notes.runeflow.md`](./examples/release-notes.runeflow.md) | Release notes — `transform` + `const` + LLM |
| [`examples/block-demo.runeflow.md`](./examples/block-demo.runeflow.md) | Reusable block templates |

---

## 🔌 Extending the Tool Registry

The built-in registry ships with the package. You can add your own tool schemas two ways:

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
import { runRuneflow } from "runeflow";

await runRuneflow(definition, inputs, runtime, {
  toolRegistry: [
    {
      name: "stripe.charge",
      inputSchema: { ... },
      outputSchema: { ... },
    },
  ],
});
```

The runtime validates tool inputs against `inputSchema` and outputs against `outputSchema` automatically.

---

Every run writes `.runeflow-runs/<run_id>.json` and per-step artifacts. Includes inputs, outputs, status, timing, and errors.

Run statuses: `running` → `success` | `halted_on_error` | `halted_on_input` | `failed`

`halted_on_error` means a step failed with no fallback. The artifact includes `halted_step_id` so `runeflow resume` knows where to restart.

`halted_on_input` means a `human_input` step needs an answer. The run artifact includes `pending_input` with the resolved prompt and choices.

---

## ⚡ Caching

Every step records an `input_hash`. On subsequent runs with `priorSteps`, steps whose resolved inputs haven't changed are replayed from cache. Add `cache=false` to opt out:

```runeflow
step push type=tool cache=false {
  tool: git.push_current_branch
  out: { branch: string, remote: string }
}
```

---

## 🔒 Trust Model

- Skill files define `transform` expressions — treat them as trusted code in the host process
- `transform` runs via `new Function`. Set `RUNEFLOW_DISABLE_TRANSFORM=1` to block transform steps
- `--runtime ./path.js` loads that module via Node `import()` — only load trusted runtimes

---

## 🗺️ Roadmap

| Phase | Status | What |
|---|---|---|
| v0.1 | ✅ shipped | `tool`, `llm`, `transform`, `branch`, `block`, `cli`, `resume`, caching, tools CLI, `assemble`, `init`, `--force` |
| v0.2 | ✅ shipped | `human_input`, `runeflow watch`, parallel tool steps |
| v0.3 | 📅 planned | MCP server, `runeflow build` (LLM → skill compiler), agent integration |

---

## 🔗 Integration Modes

Runeflow supports three ways to integrate. Pick the one that fits your setup.

### Mode 1 — Top-Level Executor ✅

Runeflow runs the full skill end-to-end. Your code calls `runRuneflow`, the runtime owns every step — tool calls, LLM calls, branching, retries, artifacts. You get structured JSON outputs and a full run trace.

```js
import { parseRuneflow, runRuneflow, createDefaultRuntime } from "runeflow";
import fs from "node:fs/promises";

const source = await fs.readFile("./draft-pr.runeflow.md", "utf8");
const definition = parseRuneflow(source);
const runtime = createDefaultRuntime();

const run = await runRuneflow(definition, { base_branch: "main" }, runtime);
console.log(run.outputs); // { title: "...", body: "..." }
```

Or via CLI:

```bash
runeflow run ./draft-pr.runeflow.md --input '{"base_branch":"main"}' --runtime ./runtime.js
```

Best for: standalone automation scripts, CI/CD pipelines, backend services, scheduled jobs.

---

### Mode 2 — Assemble (Preprocessor for Agents) ✅

You run `runeflow assemble` before invoking an agent. Runeflow executes all the deterministic setup steps (git, file reads, API calls), resolves the prompt with real values, and writes a clean Markdown context file. The agent loads that file instead of the raw skill — it sees only what it needs for one step.

```bash
runeflow assemble ./draft-pr.runeflow.md \
  --step draft \
  --input '{"base_branch":"main"}' \
  --output context.md
```

The output contains the resolved prompt, operator docs, resolved input, and output schema. No `runeflow` block, no tool wiring, no DSL. The agent makes one focused LLM call.

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

### Mode 3 — MCP Server 🔜 v0.3

`runeflow-mcp` exposes `runeflow_run` as an MCP tool. Any MCP-compatible agent calls it directly — no preprocessing step, no file handoff. The agent passes the skill path and inputs, Runeflow executes the full workflow, returns structured outputs.

```json
{
  "tool": "runeflow_run",
  "arguments": {
    "skill": "./draft-pr.runeflow.md",
    "inputs": { "base_branch": "main" }
  }
}
```

The agent never sees the skill internals. It just gets back `{ title, body }`.

Best for: Claude Code with MCP configured, Cursor agents, any system that supports the Model Context Protocol.

---

| Mode | Status | Agent integration needed | Best for |
|---|---|---|---|
| Top-level executor | ✅ now | None — you call it directly | Scripts, CI/CD, backends |
| Assemble | ✅ now | None — agent loads a file | Claude Code, Codex, Cursor |
| MCP server | 🔜 v0.3 | MCP client support | Any MCP-compatible agent |

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, workflow, and what's in scope. Contributors clone the repo directly.

---

## 📄 License

MIT
