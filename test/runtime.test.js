import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";

test("runRuneflow executes linear tool -> llm -> tool workflow and writes artifacts", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: linear
description: Linear workflow
version: 0.1
inputs:
  draft: boolean
outputs:
  pr_url: string
llm:
  provider: mock-default
  router: false
  model: baseline
---

\`\`\`runeflow
step first type=tool {
  tool: mock.first
  out: { ready: boolean }
}

step draft type=llm {
  prompt: "write"
  input: { ready: steps.first.ready }
  schema: { title: string, body: string }
}

step publish type=tool {
  tool: mock.publish
  with: {
    title: steps.draft.title,
    draft: inputs.draft,
    draft_result_path: steps.draft.result_path
  }
  out: { pr_url: string }
}

output {
  pr_url: steps.publish.pr_url
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.first": async () => ({ ready: true }),
      "mock.publish": async ({ title, draft, draft_result_path }) => {
        const draftArtifact = JSON.parse(await fs.readFile(draft_result_path, "utf8"));
        assert.equal(draftArtifact.outputs.title, title);
        return {
          pr_url: `https://example.test/${draft ? "draft" : "ready"}/${encodeURIComponent(title)}`,
        };
      },
    },
    llms: {
      "mock-default": async ({ llm }) => ({
        title: `Demo PR via ${llm.model}`,
        body: "Body",
      }),
    },
  };

  const run = await runRuneflow(parsed, { draft: true }, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.steps.length, 3);
  assert.equal(run.outputs.pr_url, "https://example.test/draft/Demo%20PR%20via%20baseline");
  assert.match(run.steps[1].result_path, /draft\.json$/);

  const artifact = JSON.parse(await fs.readFile(run.artifact_path, "utf8"));
  assert.equal(artifact.run_id, run.run_id);
  assert.equal(artifact.runeflow.name, "linear");
  assert.equal(artifact.steps[1].outputs.title, "Demo PR via baseline");
});

test("runRuneflow resolves template interpolation and projects docs to llm steps", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: projection
description: Projection workflow
version: 0.1
inputs:
  change_count: number
outputs:
  title: string
  body: string
llm:
  provider: mock-default
  router: false
  model: concise
---

# Operator Notes

Use the repository context to draft a concise pull request.

\`\`\`runeflow
step setup type=tool {
  tool: util.complete
  with: { branch: "feature/runtime-owned", ready: true }
  out: { branch: string, ready: boolean }
}

step draft type=llm {
  prompt: "Draft a PR for {{ steps.setup.branch }} with {{ inputs.change_count }} changes."
  input: {
    ready: "{{ steps.setup.ready }}",
    count: "{{ inputs.change_count }}",
    summary: "Branch {{ steps.setup.branch }} has {{ inputs.change_count }} changes."
  }
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
\`\`\`
`);

  const runtime = {
    llms: {
      "mock-default": async ({ llm, prompt, input, docs, context }) => {
        assert.equal(llm.provider, "mock-default");
        assert.equal(llm.model, "concise");
        assert.equal(llm.router, false);
        assert.equal(prompt, "Draft a PR for feature/runtime-owned with 3 changes.");
        assert.deepEqual(input, {
          ready: true,
          count: 3,
          summary: "Branch feature/runtime-owned has 3 changes.",
        });
        assert.match(docs, /Operator Notes/);
        assert.equal(context.docs, docs);
        assert.equal(context.metadata.name, "projection");
        return {
          title: "PR for feature/runtime-owned",
          body: `Docs available: ${docs.includes("draft a concise pull request")}`,
        };
      },
    },
  };

  const run = await runRuneflow(parsed, { change_count: 3 }, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.deepEqual(run.outputs, {
    title: "PR for feature/runtime-owned",
    body: "Docs available: true",
  });
});

test("runRuneflow preserves native types for exact templates and strings for mixed templates", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: templates
description: Template bindings
version: 0.1
inputs:
  flag: boolean
  count: number
  branch: string
  data:
    label: string
  items:
    - string
outputs:
  flag: boolean
  count: number
  data:
    label: string
  items:
    - string
  message: string
---

\`\`\`runeflow
step capture type=tool {
  tool: util.complete
  with: {
    flag: "{{ inputs.flag }}",
    count: "{{ inputs.count }}",
    data: "{{ inputs.data }}",
    items: "{{ inputs.items }}",
    message: "Deploy {{ inputs.branch }} with {{ inputs.count }} changes"
  }
  out: {
    flag: boolean,
    count: number,
    data: { label: string },
    items: [string],
    message: string
  }
}

output {
  flag: steps.capture.flag
  count: steps.capture.count
  data: steps.capture.data
  items: steps.capture.items
  message: steps.capture.message
}
\`\`\`
`);

  const run = await runRuneflow(
    parsed,
    {
      flag: true,
      count: 5,
      branch: "feature/templates",
      data: { label: "release" },
      items: ["one", "two"],
    },
    {},
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.strictEqual(typeof run.outputs.flag, "boolean");
  assert.strictEqual(typeof run.outputs.count, "number");
  assert.deepEqual(run.outputs.data, { label: "release" });
  assert.deepEqual(run.outputs.items, ["one", "two"]);
  assert.equal(run.outputs.message, "Deploy feature/templates with 5 changes");
});

test("runRuneflow retries llm validation failure and uses fallback", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  let attempts = 0;
  const parsed = parseRuneflow(`---
name: fallback
description: Fallback workflow
version: 0.1
inputs: {}
outputs:
  result: string
llm:
  provider: mock-default
  router: false
  model: baseline
---

\`\`\`runeflow
step draft type=llm retry=1 fallback=recover {
  prompt: "write"
  schema: { title: string }
}

step publish type=tool {
  tool: mock.publish
  with: { title: steps.draft.title }
  out: { result: string }
}

step recover type=tool {
  tool: mock.recover
  out: { result: string }
}

output {
  result: steps.recover.result
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.publish": async ({ title }) => ({ result: title }),
      "mock.recover": async () => ({ result: "recovered" }),
    },
    llms: {
      "mock-default": async () => {
        attempts += 1;
        return attempts === 1 ? { title: 42 } : { title: 42 };
      },
    },
  };

  const run = await runRuneflow(parsed, {}, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.steps[0].status, "failed");
  assert.equal(run.steps[0].attempts, 2);
  assert.equal(run.steps[1].id, "recover");
  assert.equal(run.outputs.result, "recovered");
});

test("runRuneflow routes branch targets", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: branch
description: Branch workflow
version: 0.1
inputs:
  use_primary: boolean
outputs:
  result: string
---

\`\`\`runeflow
branch choose {
  if: inputs.use_primary
  then: primary
  else: secondary
}

step primary type=tool {
  tool: mock.primary
  out: { result: string }
  next: finish
}

step secondary type=tool {
  tool: mock.secondary
  out: { result: string }
}

step finish type=tool {
  tool: mock.finish
  with: { chosen: steps.primary.result }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.primary": async () => ({ result: "primary" }),
      "mock.secondary": async () => ({ result: "secondary" }),
      "mock.finish": async ({ chosen }) => ({ result: `${chosen}-done` }),
    },
  };

  const run = await runRuneflow(parsed, { use_primary: true }, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.deepEqual(run.steps.map((step) => step.id), ["choose", "primary", "finish"]);
  assert.equal(run.outputs.result, "primary-done");
});

test("runRuneflow lets user runtime tools override built-in tools", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: override
description: Override tools
version: 0.1
inputs: {}
outputs:
  message: string
---

\`\`\`runeflow
step finish type=tool {
  tool: util.complete
  with: { message: "built-in" }
  out: { message: string }
}

output {
  message: steps.finish.message
}
\`\`\`
`);

  const run = await runRuneflow(
    parsed,
    {},
    {
      tools: {
        "util.complete": async () => ({ message: "overridden" }),
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.message, "overridden");
});

test("runRuneflow uses step-level llm override over metadata default", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: llm-override
description: Override llm
version: 0.1
inputs: {}
outputs:
  summary: string
llm:
  provider: default-provider
  router: false
  model: default-model
---

\`\`\`runeflow
step draft type=llm {
  llm: {
    provider: review-provider,
    router: false,
    model: review-model
  }
  prompt: "write"
  schema: { summary: string }
}

output {
  summary: steps.draft.summary
}
\`\`\`
`);

  const calls = [];
  const run = await runRuneflow(
    parsed,
    {},
    {
      llms: {
        "default-provider": async () => {
          calls.push("default-provider");
          return { summary: "default" };
        },
        "review-provider": async ({ llm }) => {
          calls.push(`${llm.provider}:${llm.model}`);
          return { summary: "review" };
        },
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.summary, "review");
  assert.deepEqual(calls, ["review-provider:review-model"]);
});

test("runRuneflow uses registry-backed tool output schema when out is omitted", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: registry-tool
description: Registry-backed tool output validation
version: 0.1
inputs: {}
outputs:
  count: number
---

\`\`\`runeflow
step count_prs type=tool {
  tool: github.count_open_prs
  with: { owner: "acme", repo: "runeflow" }
}

output {
  count: steps.count_prs.count
}
\`\`\`
`);

  const run = await runRuneflow(
    parsed,
    {},
    {
      tools: {
        "github.count_open_prs": async () => ({ count: 7 }),
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.count, 7);
});

test("runRuneflow validates registry-backed tool output shape", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: bad-registry-tool
description: Registry-backed tool output validation failure
version: 0.1
inputs: {}
outputs:
  count: number
---

\`\`\`runeflow
step count_prs type=tool {
  tool: github.count_open_prs
  with: { owner: "acme", repo: "runeflow" }
}

output {
  count: steps.count_prs.count
}
\`\`\`
`);

  const run = await runRuneflow(
    parsed,
    {},
    {
      tools: {
        "github.count_open_prs": async () => ({ count: "seven" }),
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "failed");
  assert.match(run.error.message, /Tool output failed validation/);
  assert.match(run.error.message, /expected number/);
});

test("hooks: beforeStep receives step and state, afterStep receives stepRun outputs", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: hooks-observe
description: Hook observation
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step work type=tool {
  tool: mock.work
  out: { value: string }
}

output {
  value: steps.work.value
}
\`\`\`
`);

  const beforeCalls = [];
  const afterCalls = [];

  const run = await runRuneflow(parsed, {}, {
    tools: { "mock.work": async () => ({ value: "done" }) },
    hooks: {
      beforeStep: async ({ step, state }) => { beforeCalls.push({ id: step.id, inputs: state.inputs }); },
      afterStep: async ({ stepRun }) => { afterCalls.push({ id: stepRun.id, outputs: stepRun.outputs }); },
    },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.deepEqual(beforeCalls, [{ id: "work", inputs: {} }]);
  assert.deepEqual(afterCalls, [{ id: "work", outputs: { value: "done" } }]);
});

test("hooks: beforeStep abort stops the run with the abort reason", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: hooks-abort
description: Hook abort
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step work type=tool {
  tool: mock.work
  out: { value: string }
}

output {
  value: steps.work.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {
    tools: { "mock.work": async () => ({ value: "done" }) },
    hooks: {
      beforeStep: async () => ({ abort: true, reason: "policy denied" }),
    },
  }, { runsDir });

  assert.equal(run.status, "failed");
  assert.match(run.error.message, /policy denied/);
  assert.equal(run.steps.length, 0);
});

test("hooks: onStepError fires after retries are exhausted", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: hooks-error
description: Hook error
version: 0.1
inputs: {}
outputs:
  value: string
llm:
  provider: mock-default
  router: false
  model: baseline
---

\`\`\`runeflow
step draft type=llm retry=1 {
  prompt: "write"
  schema: { value: string }
}

output {
  value: steps.draft.value
}
\`\`\`
`);

  const errorCalls = [];

  const run = await runRuneflow(parsed, {}, {
    llms: { "mock-default": async () => ({ value: 42 }) },
    hooks: {
      onStepError: async ({ step, attempts }) => { errorCalls.push({ id: step.id, attempts }); },
    },
  }, { runsDir });

  assert.equal(run.status, "failed");
  assert.deepEqual(errorCalls, [{ id: "draft", attempts: 2 }]);
});

test("hooks: hook errors are non-fatal and recorded in step artifact", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: hooks-safe
description: Hook error safety
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step work type=tool {
  tool: mock.work
  out: { value: string }
}

output {
  value: steps.work.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {
    tools: { "mock.work": async () => ({ value: "ok" }) },
    hooks: {
      afterStep: async () => { throw new Error("telemetry failed"); },
    },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.outputs.value, "ok");
  assert.ok(run.steps[0].hook_events?.some((e) => e.error?.message === "telemetry failed"));
});

test("doc blocks: llm step with docs receives named block, not full docs", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: doc-projection
description: Doc block projection
version: 0.1
inputs: {}
outputs:
  title: string
llm:
  provider: mock-default
  router: false
  model: base
---

# General guidance

This is the full docs section.

:::guidance[pr-tone]
Keep PR titles under 72 chars. Use imperative mood.
:::

\`\`\`runeflow
step draft type=llm {
  docs: pr-tone
  prompt: "Draft a PR title."
  schema: { title: string }
}

output {
  title: steps.draft.title
}
\`\`\`
`);

  let receivedDocs = null;

  const run = await runRuneflow(parsed, {}, {
    llms: {
      "mock-default": async ({ docs }) => {
        receivedDocs = docs;
        return { title: "Add runtime doc projection" };
      },
    },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.match(receivedDocs, /imperative mood/);
  assert.doesNotMatch(receivedDocs, /full docs section/);
  assert.match(run.steps[0].projected_docs, /imperative mood/);
});

test("doc blocks: llm step without docs receives full docs", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: doc-fallback
description: Doc fallback
version: 0.1
inputs: {}
outputs:
  title: string
llm:
  provider: mock-default
  router: false
  model: base
---

# Full guidance

This is the full docs section.

:::guidance[pr-tone]
Keep PR titles short.
:::

\`\`\`runeflow
step draft type=llm {
  prompt: "Draft a PR title."
  schema: { title: string }
}

output {
  title: steps.draft.title
}
\`\`\`
`);

  let receivedDocs = null;

  const run = await runRuneflow(parsed, {}, {
    llms: {
      "mock-default": async ({ docs }) => {
        receivedDocs = docs;
        return { title: "Add runtime doc projection" };
      },
    },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.match(receivedDocs, /Full guidance/);
  assert.doesNotMatch(receivedDocs, /Keep PR titles short/);
});

test("transform: filters and maps tool output for downstream llm step", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: transform-filter
description: Transform step filters data
version: 0.1
inputs: {}
outputs:
  summary: string
llm:
  provider: mock-default
  router: false
  model: base
---

\`\`\`runeflow
step fetch type=tool {
  tool: mock.fetch
  out: { items: [{ id: number, state: string }] }
}

step filter type=transform {
  input: steps.fetch.items
  expr: "input.filter(x => x.state === 'open').map(x => x.id)"
  out: [number]
}

step draft type=llm {
  prompt: "Summarize open items."
  input: { ids: steps.filter }
  schema: { summary: string }
}

output {
  summary: steps.draft.summary
}
\`\`\`
`);

  let receivedInput = null;

  const run = await runRuneflow(parsed, {}, {
    tools: {
      "mock.fetch": async () => ({
        items: [
          { id: 1, state: "open" },
          { id: 2, state: "closed" },
          { id: 3, state: "open" },
        ],
      }),
    },
    llms: {
      "mock-default": async ({ input }) => {
        receivedInput = input;
        return { summary: "2 open items" };
      },
    },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.deepEqual(receivedInput.ids, [1, 3]);
  assert.equal(run.outputs.summary, "2 open items");
});

test("transform: output is validated against out schema", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: transform-bad-out
description: Transform output validation
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step reshape type=transform {
  input: "hello"
  expr: "42"
  out: { value: string }
}

output {
  value: steps.reshape.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir });

  assert.equal(run.status, "failed");
  assert.match(run.error.message, /Transform output failed validation/);
});

test("transform: malformed expression produces clean RuntimeError", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: transform-bad-expr
description: Transform bad expression
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step reshape type=transform {
  input: "hello"
  expr: "input.notAFunction((("
  out: { value: string }
}

output {
  value: steps.reshape.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir });

  assert.equal(run.status, "failed");
  assert.match(run.error.message, /transform 'reshape' expression failed/);
});

test("runRuneflow resolves type=block steps using named block templates", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: block-runtime
description: Block runtime
version: 0.1
inputs:
  name: string
outputs:
  greeting: string
llm:
  provider: mock
  router: false
  model: demo
---

\`\`\`runeflow
block greet_template type=llm {
  prompt: "Greet {{ inputs.name }}"
  schema: { greeting: string }
}

step greet type=block {
  block: greet_template
}

output {
  greeting: steps.greet.greeting
}
\`\`\`
`);

  const run = await runRuneflow(
    parsed,
    { name: "Ada" },
    {
      llms: {
        mock: async ({ prompt }) => {
          assert.match(prompt, /Greet Ada/);
          return { greeting: "Hello Ada" };
        },
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.greeting, "Hello Ada");
});

test("runRuneflow uses builtin file.exists without out when registry provides outputSchema", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-file-reg-"));
  await fs.writeFile(path.join(tempDir, "marker.txt"), "ok\n");

  const parsed = parseRuneflow(`---
name: file-builtin-registry
description: file.exists via registry
version: 0.1
inputs: {}
outputs:
  exists: boolean
---

\`\`\`runeflow
step check type=tool {
  tool: file.exists
  with: { path: "./marker.txt" }
}

output {
  exists: steps.check.exists
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir, cwd: tempDir });

  assert.equal(run.status, "success");
  assert.equal(run.outputs.exists, true);
});

test("transform: RUNEFLOW_DISABLE_TRANSFORM=1 blocks execution", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: transform-off
description: Transform disabled
version: 0.1
inputs: {}
outputs:
  n: number
---

\`\`\`runeflow
step t type=transform {
  input: {}
  expr: "1"
  out: { n: number }
}

output {
  n: steps.t.n
}
\`\`\`
`);

  const prev = process.env.RUNEFLOW_DISABLE_TRANSFORM;
  process.env.RUNEFLOW_DISABLE_TRANSFORM = "1";
  try {
    const run = await runRuneflow(parsed, {}, {}, { runsDir });
    assert.equal(run.status, "failed");
    assert.match(run.error.message, /Transform steps are disabled/);
  } finally {
    if (prev === undefined) {
      delete process.env.RUNEFLOW_DISABLE_TRANSFORM;
    } else {
      process.env.RUNEFLOW_DISABLE_TRANSFORM = prev;
    }
  }
});
