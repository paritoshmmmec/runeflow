<div align="center">

# ⚡ Runeflow

**A strict, deterministic runtime for hybrid AI skills.**

The runtime owns 100% of workflow logic. The LLM only participates where you explicitly say so.

[![npm version](https://img.shields.io/npm/v/runeflow?color=blueviolet)](https://www.npmjs.com/package/runeflow)
[![tests](https://img.shields.io/badge/tests-59%20passing-brightgreen)](#)
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

---

## 🚀 Quickstart

Requires Node >= 20.

### 1. Install

```bash
npm install runeflow
```

Or globally if you want the `runeflow` CLI on your PATH:

```bash
npm install -g runeflow
```

### 2. Get an API key

The built-in examples use [Cerebras](https://cloud.cerebras.ai) (free tier works). Add your key to a `.env` file in your project:

```bash
echo "CEREBRAS_API_KEY=your-key-here" > .env
```

### 3. Write a skill file

Create `draft-pr.runeflow.md` in your git repo:

````md
---
name: draft-pr
description: Draft a PR title and body for the current branch.
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

# Draft PR

Draft a concise pull request title and body based on the diff.

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
    Draft a PR for {{ steps.branch.branch }} targeting {{ inputs.base_branch }}.
    Diff summary: {{ steps.diff.summary }}
  input: { diff_summary: steps.diff.summary }
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
```
````

### 4. Write a runtime

Create `runtime.js` — this is where you wire in your LLM provider. Or skip this entirely and use the **built-in default runtime** which handles Cerebras, OpenAI, and Anthropic automatically:

```js
// runtime.js — use the default runtime
import { createDefaultRuntime } from "runeflow";
export default createDefaultRuntime();
```

That's it. It reads `CEREBRAS_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` from your environment based on the `provider` declared in your skill file.

If you need custom behavior (logging, retries, a different provider), you can extend it:

```js
import { createDefaultRuntime } from "runeflow";

const base = createDefaultRuntime();

export default {
  ...base,
  llms: {
    ...base.llms,
    // override or add providers
    ollama: async ({ llm, prompt, input, docs, schema }) => {
      // your custom handler
    },
  },
};
```

### 5. Validate and run

```bash
# Check the skill file for errors — no API calls, no git needed
npx runeflow validate ./draft-pr.runeflow.md

# Run it from inside your git repo
node --env-file=.env ./node_modules/.bin/runeflow run ./draft-pr.runeflow.md \
  --input '{"base_branch":"main"}' \
  --runtime ./runtime.js
```

You'll get back:

```json
{
  "title": "feat: add input validation to checkout flow",
  "body": "Adds null checks and error boundaries to the checkout step..."
}
```

A full run artifact with per-step inputs, outputs, and timing is written to `.runeflow-runs/`.

### 6. Explore what's available

```bash
npx runeflow tools list
npx runeflow tools inspect git.diff_summary
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
| `llm` | Calls an LLM handler, validates output against `schema` |
| `transform` | Runs a JS expression over resolved `input`, validates against `out` |
| `branch` | Evaluates an expression, routes to `then` or `else` step |

Control flow: `retry=N`, `fallback=<step>`, `next=<step>`, `skip_if: <expr>`, terminal `fail`.

### tool

```runeflow
step check type=tool {
  tool: file.exists
  with: { path: ".github/pull_request_template.md" }
  out: { exists: boolean }
}
```

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
| `file.exists` | Check if a path exists |
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
runeflow validate <file>
runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js] [--runs-dir ./.runeflow-runs]
runeflow resume <file> [--runtime ./runtime.js]
runeflow inspect-run <run-id>
runeflow import <file> [--output converted.runeflow.md]
runeflow tools list
runeflow tools inspect <tool-name>
```

`resume` reads the most recent `halted_on_error` run, replays completed steps from cache, and retries from the failure point.

---

## ✍️ Writing a Runtime

The default runtime handles Cerebras, OpenAI, and Anthropic with zero config:

```js
import { createDefaultRuntime } from "runeflow";
export default createDefaultRuntime();
```

Set the matching env var for your provider: `CEREBRAS_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.

For custom behavior, extend it:

```js
import { createDefaultRuntime } from "runeflow";

const base = createDefaultRuntime();

export default {
  ...base,
  llms: {
    ...base.llms,
    // add a provider or override an existing one
    myProvider: async ({ llm, prompt, input, schema, docs }) => {
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

See [`examples/open-pr-runtime.js`](./examples/open-pr-runtime.js) for a working custom runtime.

---

## 📦 Examples

| File | What it shows |
|---|---|
| [`examples/open-pr.runeflow.md`](./examples/open-pr.runeflow.md) | PR prep — tool steps + LLM |
| [`examples/review-draft.runeflow.md`](./examples/review-draft.runeflow.md) | Code review notes — step-level LLM override |
| [`examples/release-notes.runeflow.md`](./examples/release-notes.runeflow.md) | Release notes — `transform` + `const` + LLM |
| [`examples/block-demo.runeflow.md`](./examples/block-demo.runeflow.md) | Reusable block templates |

---

## 🗂️ Run Artifacts

Every run writes `.runeflow-runs/<run_id>.json` and per-step artifacts. Includes inputs, outputs, status, timing, and errors.

Run statuses: `running` → `success` | `halted_on_error` | `failed`

`halted_on_error` means a step failed with no fallback. The artifact includes `halted_step_id` so `runeflow resume` knows where to restart.

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
| Alpha | ✅ now | `tool`, `llm`, `transform`, `branch`, `block`, `resume`, caching, tools CLI |
| v0.2 | 🔜 | `cli` step kind, `human_input` step, auth waterfall, `runeflow assemble` |
| v0.3 | 📅 planned | MCP server, `runeflow build` (LLM → skill compiler), agent integration |

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, workflow, and what's in scope. Contributors clone the repo directly.

---

## 📄 License

MIT
