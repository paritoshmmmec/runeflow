# Contributing to Runeflow

Thanks for your interest. Runeflow is in active alpha — contributions are welcome, but please read this first so we stay aligned on direction.

---

## 🧭 Principles

- **Small runtime, explicit design.** Prefer simple, readable code over clever abstractions. If it needs a comment to explain, it probably needs a redesign.
- **Behavior changes need tests.** Every meaningful change to runtime behavior should come with a test that would have caught a regression.
- **Don't introduce loops, recursion, or arbitrary DAGs.** The execution model is intentionally narrow. Keep changes focused on the existing step kinds.
- **Keep the LLM out of execution semantics.** The runtime owns control flow. The LLM produces bounded outputs for a single step.

---

## 🛠️ Setup

```bash
git clone https://github.com/paritoshmmmec/runeflow
cd runeflow
npm install
npm test
```

Node >= 20 required (uses ESM, `node:test`, `--env-file`).

---

## 🔄 Workflow

1. **Open an issue first** for anything non-trivial. Describe the problem, not the solution. This avoids wasted effort on PRs that don't fit the direction.
2. **Fork and branch** off `main`. Use a descriptive branch name: `feat/cli-step-kind`, `fix/transform-hash`, `docs/quickstart`.
3. **Make your change.** Keep it focused — one thing per PR.
4. **Run the full suite** before pushing:

```bash
npm test
npx runeflow validate ./examples/open-pr.md
npx runeflow validate ./examples/block-demo.md
npx runeflow validate ./examples/release-notes.md
```

5. **Open a PR** with a clear description of what changed and why. Link the issue.

---

## 📁 Key Files

| File | Purpose |
|---|---|
| `src/runtime.js` | Execution engine — step dispatch, artifact writing, caching |
| `src/parser.js` | Frontmatter + DSL parsing, doc blocks, const |
| `src/expression.js` | Expression evaluation, `matches`, const paths |
| `src/validator.js` | Static validation, reference checking |
| `src/blocks.js` | Block template expansion |
| `src/builtins.js` | Built-in tools |
| `src/cli.js` | CLI commands |
| `registry/tools/` | Tool registry JSON schemas |
| `examples/` | Reference skills and runtimes |
| `eval/` | Benchmark harnesses |
| `test/` | Behavior tests |

---

## ✅ What We're Looking For

Good contributions:

- **New built-in tools** — add a `src/builtins.js` implementation + `registry/tools/<name>.json` schema + tests
- **Bug fixes** — with a test that reproduces the bug
- **New examples** — realistic, small, in a different domain from existing ones
- **Eval improvements** — better fixtures, new task types, cleaner harness output
- **Docs** — README clarity, inline comments, better error messages

Not a good fit right now:

- Loops, recursion, parallel execution, arbitrary DAGs
- TypeScript rewrite (JS runtime is intentional for now)
- Web editor or hosted runtime
- Breaking changes to the DSL without a strong reason and migration path

---

## 🧪 Writing Tests

Tests live in `test/` and use Node's built-in `node:test` + `assert/strict`. No test framework needed.

Pattern for runtime tests:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";

test("my feature: does the thing", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: my-test
...
---
\`\`\`runeflow
...
\`\`\`
`);
  const run = await runRuneflow(parsed, {}, { tools: { ... } }, { runsDir });
  assert.equal(run.status, "success");
});
```

---

## 🏷️ Commit Style

No strict convention, but keep messages clear:

```
feat: add cli step kind with child_process execution
fix: transform hash includes nested object keys
docs: add 5-minute quickstart to README
test: cover halted_on_error with no fallback
```

---

## 💬 Questions

Open a GitHub issue or discussion. We're happy to talk through ideas before you write code.
