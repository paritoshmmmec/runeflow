import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import {
  createComposioClientPlugin,
  createComposioToolPlugin,
  createMcpClientPlugin,
  createMcpToolPlugin,
} from "../src/runtime-plugins.js";
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

test("runRuneflow accepts plugin-contributed tools and schemas", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-plugin-tools-"));
  const parsed = parseRuneflow(`---
name: plugin-tool
description: Plugin-backed tool
version: 0.1
inputs:
  message: string
outputs:
  message: string
---

\`\`\`runeflow
step echo type=tool {
  tool: plugin.echo
  with: { message: inputs.message }
}

output {
  message: steps.echo.message
}
\`\`\`
`);

  const run = await runRuneflow(
    parsed,
    { message: "hello" },
    {
      plugins: [
        {
          name: "custom-plugin",
          tools: {
            "plugin.echo": async ({ message }) => ({ message: `${message}:plugin` }),
          },
          toolRegistry: [
            {
              name: "plugin.echo",
              inputSchema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                },
                required: ["message"],
              },
              outputSchema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                },
                required: ["message"],
              },
            },
          ],
        },
      ],
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.message, "hello:plugin");
});

test("runRuneflow executes MCP adapter tools through the plugin layer", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-mcp-plugin-"));
  const parsed = parseRuneflow(`---
name: mcp-plugin
description: MCP plugin
version: 0.1
inputs:
  query: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step search type=tool {
  tool: mcp.docs.search
  with: { query: inputs.query }
}

output {
  ok: steps.search.isError == false
}
\`\`\`
`);

  const calls = [];
  const run = await runRuneflow(
    parsed,
    { query: "runeflow" },
    {
      plugins: [
        createMcpToolPlugin({
          serverName: "docs",
          tools: [
            {
              name: "search",
              description: "Search docs",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
                required: ["query"],
              },
            },
          ],
          callTool: async ({ server, name, input }) => {
            calls.push({ server, name, input });
            return {
              content: [{ text: `match:${input.query}` }],
              isError: false,
            };
          },
        }),
      ],
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.ok, true);
  assert.deepEqual(calls, [{
    server: "docs",
    name: "search",
    input: { query: "runeflow" },
  }]);
});

test("runRuneflow executes Composio adapter tools through the plugin layer", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-composio-plugin-"));
  const parsed = parseRuneflow(`---
name: composio-plugin
description: Composio plugin
version: 0.1
inputs:
  title: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step create_issue type=tool {
  tool: composio.linear.create_issue
  with: { title: inputs.title }
}

output {
  ok: steps.create_issue.isError == false
}
\`\`\`
`);

  const calls = [];
  const run = await runRuneflow(
    parsed,
    { title: "Investigate bug" },
    {
      plugins: [
        createComposioToolPlugin({
          tools: [
            {
              name: "linear.create_issue",
              description: "Create a Linear issue",
              inputSchema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                },
                required: ["title"],
              },
            },
          ],
          executeTool: async ({ name, input }) => {
            calls.push({ name, input });
            return {
              content: [{ id: "ISSUE-123" }],
              isError: false,
            };
          },
        }),
      ],
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.ok, true);
  assert.deepEqual(calls, [{
    name: "linear.create_issue",
    input: { title: "Investigate bug" },
  }]);
});

test("runRuneflow executes a discovered Composio client plugin end to end", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-composio-client-"));
  const parsed = parseRuneflow(`---
name: composio-client-plugin
description: Composio client plugin
version: 0.1
inputs:
  title: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step create_issue type=tool {
  tool: composio.linear.create_issue
  with: { title: inputs.title }
}

output {
  ok: steps.create_issue.isError == false
}
\`\`\`
`);

  const queries = [];
  const calls = [];
  const plugin = await createComposioClientPlugin({
    toolkits: ["linear"],
    executeDefaults: {
      connectedAccountId: "acct_123",
    },
    createClient: async () => ({
      tools: {
        getRawComposioTools: async (query) => {
          queries.push(query);
          return {
            items: [
              {
                slug: "LINEAR_CREATE_ISSUE",
                toolkit: { slug: "linear" },
                description: "Create a Linear issue",
                inputParameters: {
                  type: "object",
                  properties: {
                    title: { type: "string", minLength: 1 },
                  },
                  required: ["title"],
                  $schema: "http://json-schema.org/draft-07/schema#",
                },
              },
            ],
          };
        },
        execute: async (name, request) => {
          calls.push({ name, request });
          return {
            id: "ISSUE-123",
            title: request.arguments.title,
          };
        },
      },
    }),
  });

  const run = await runRuneflow(
    parsed,
    { title: "Investigate bug" },
    {
      plugins: [plugin],
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.ok, true);
  assert.deepEqual(queries, [{
    toolkits: ["linear"],
  }]);
  assert.deepEqual(calls, [{
    name: "LINEAR_CREATE_ISSUE",
    request: {
      connectedAccountId: "acct_123",
      arguments: { title: "Investigate bug" },
    },
  }]);
  assert.equal(run.steps[0].outputs.raw.id, "ISSUE-123");
});

test("runRuneflow executes a real MCP stdio plugin end to end", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-mcp-stdio-"));
  const parsed = parseRuneflow(`---
name: real-mcp-plugin
description: Real MCP plugin
version: 0.1
inputs:
  query: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step search type=tool {
  tool: mcp.fixture.search
  with: { query: inputs.query }
}

output {
  ok: steps.search.isError == false
}
\`\`\`
`);

  const plugin = await createMcpClientPlugin({
    serverName: "fixture",
    command: process.execPath,
    args: [path.resolve("fixtures/mcp-test-server.js")],
    stderr: "pipe",
  });

  const run = await runRuneflow(
    parsed,
    { query: "runeflow" },
    {
      plugins: [plugin],
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(run.outputs.ok, true);
  assert.equal(run.steps[0].outputs.content[0].text, "match:runeflow");
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

  assert.equal(run.status, "halted_on_error");
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

  assert.equal(run.status, "halted_on_error");
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

  assert.equal(run.status, "halted_on_error");
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

  assert.equal(run.status, "halted_on_error");
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
    assert.equal(run.status, "halted_on_error");
    assert.match(run.error.message, /Transform steps are disabled/);
  } finally {
    if (prev === undefined) {
      delete process.env.RUNEFLOW_DISABLE_TRANSFORM;
    } else {
      process.env.RUNEFLOW_DISABLE_TRANSFORM = prev;
    }
  }
});

test("const: frontmatter const values resolve in prompts, inputs, and tool args", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: const-test
description: Const resolution
version: 0.1
inputs: {}
outputs:
  result: string
const:
  greeting: "hello"
  max_items: 5
llm:
  provider: mock-default
  router: false
  model: base
---

\`\`\`runeflow
step draft type=llm {
  prompt: "{{ const.greeting }} — summarize up to {{ const.max_items }} items."
  input: { limit: const.max_items }
  schema: { result: string }
}

output {
  result: steps.draft.result
}
\`\`\`
`);

  let receivedPrompt = null;
  let receivedInput = null;

  const run = await runRuneflow(parsed, {}, {
    llms: {
      "mock-default": async ({ prompt, input }) => {
        receivedPrompt = prompt;
        receivedInput = input;
        return { result: "done" };
      },
    },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(receivedPrompt, "hello — summarize up to 5 items.");
  assert.deepEqual(receivedInput, { limit: 5 });
});

test("matches: branch routes correctly on regex pattern", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: matches-test
description: Matches operator
version: 0.1
inputs:
  branch: string
outputs:
  result: string
---

\`\`\`runeflow
step get_branch type=tool {
  tool: util.complete
  with: { branch: inputs.branch }
  out: { branch: string }
}

branch check {
  if: steps.get_branch.branch matches "^feat/"
  then: feature
  else: other
}

step feature type=tool {
  tool: util.complete
  with: { result: "feature branch" }
  out: { result: string }
  next: finish
}

step other type=tool {
  tool: util.complete
  with: { result: "other branch" }
  out: { result: string }
  next: finish
}

step finish type=tool {
  tool: util.complete
  with: { result: "done" }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const run = await runRuneflow(parsed, { branch: "feat/my-feature" }, {}, { runsDir });
  assert.equal(run.status, "success");
  assert.deepEqual(run.steps.map((s) => s.id), ["get_branch", "check", "feature", "finish"]);

  const run2 = await runRuneflow(parsed, { branch: "main" }, {}, { runsDir });
  assert.equal(run2.status, "success");
  assert.deepEqual(run2.steps.map((s) => s.id), ["get_branch", "check", "other", "finish"]);
});

test("skip_if: step is skipped when condition is true", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: skip-if-test
description: skip_if
version: 0.1
inputs:
  count: number
outputs:
  value: string
llm:
  provider: mock-default
  router: false
  model: base
---

\`\`\`runeflow
step draft type=llm {
  skip_if: inputs.count == 0
  prompt: "Draft something."
  schema: { value: string }
}

step fallback type=tool {
  tool: util.complete
  with: { value: "nothing to draft" }
  out: { value: string }
}

output {
  value: steps.fallback.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, { count: 0 }, {
    llms: { "mock-default": async () => ({ value: "drafted" }) },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.steps[0].status, "skipped");
  assert.equal(run.steps[0].outputs, null);
  assert.equal(run.outputs.value, "nothing to draft");
});

test("skip_if: step executes normally when condition is false", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: skip-if-false
description: skip_if false
version: 0.1
inputs:
  count: number
outputs:
  value: string
llm:
  provider: mock-default
  router: false
  model: base
---

\`\`\`runeflow
step draft type=llm {
  skip_if: inputs.count == 0
  prompt: "Draft something."
  schema: { value: string }
}

output {
  value: steps.draft.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, { count: 3 }, {
    llms: { "mock-default": async () => ({ value: "drafted" }) },
  }, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.steps[0].status, "success");
  assert.equal(run.outputs.value, "drafted");
});

test("halted_on_error: run status is halted_on_error with halted_step_id when step fails with no fallback", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: halt-test
description: Halt on error
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step first type=tool {
  tool: mock.first
  out: { value: string }
}

step second type=tool {
  tool: mock.second
  out: { result: string }
}

output {
  result: steps.second.result
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {
    tools: {
      "mock.first": async () => ({ value: "ok" }),
      "mock.second": async () => { throw new Error("network timeout"); },
    },
  }, { runsDir });

  assert.equal(run.status, "halted_on_error");
  assert.equal(run.halted_step_id, "second");
  assert.match(run.error.message, /network timeout/);
  assert.equal(run.steps[0].status, "success");
  assert.equal(run.steps[1].status, "failed");

  const artifact = JSON.parse(await fs.readFile(run.artifact_path, "utf8"));
  assert.equal(artifact.status, "halted_on_error");
  assert.equal(artifact.halted_step_id, "second");
});

test("input-hash caching: step with matching input hash is replayed from prior run", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cache-test
description: Input hash caching
version: 0.1
inputs:
  value: string
outputs:
  result: string
---

\`\`\`runeflow
step work type=tool {
  tool: mock.work
  with: { value: inputs.value }
  out: { result: string }
}

output {
  result: steps.work.result
}
\`\`\`
`);

  let callCount = 0;
  const runtime = {
    tools: {
      "mock.work": async ({ value }) => {
        callCount += 1;
        return { result: `done:${value}` };
      },
    },
  };

  // First run — executes normally
  const run1 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir });
  assert.equal(run1.status, "success");
  assert.equal(callCount, 1);
  assert.ok(run1.steps[0].input_hash);

  // Second run with same inputs and priorSteps — should use cache
  const priorSteps = { work: run1.steps[0] };
  const run2 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir, priorSteps });
  assert.equal(run2.status, "success");
  assert.equal(callCount, 1); // not called again
  assert.equal(run2.steps[0].cached, true);
  assert.equal(run2.outputs.result, "done:hello");
});

test("input-hash caching: changed inputs bypass cache and re-execute", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cache-miss-test
description: Cache miss on changed inputs
version: 0.1
inputs:
  value: string
outputs:
  result: string
---

\`\`\`runeflow
step work type=tool {
  tool: mock.work
  with: { value: inputs.value }
  out: { result: string }
}

output {
  result: steps.work.result
}
\`\`\`
`);

  let callCount = 0;
  const runtime = {
    tools: {
      "mock.work": async ({ value }) => {
        callCount += 1;
        return { result: `done:${value}` };
      },
    },
  };

  const run1 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir });
  assert.equal(callCount, 1);

  // Different input — cache miss, re-executes
  const priorSteps = { work: run1.steps[0] };
  const run2 = await runRuneflow(parsed, { value: "world" }, runtime, { runsDir, priorSteps });
  assert.equal(run2.status, "success");
  assert.equal(callCount, 2);
  assert.equal(run2.steps[0].cached, undefined);
  assert.equal(run2.outputs.result, "done:world");
});

test("cache: false opt-out bypasses input-hash caching", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cache-opt-out
description: cache false opt-out
version: 0.1
inputs:
  value: string
outputs:
  result: string
---

\`\`\`runeflow
step work type=tool cache=false {
  tool: mock.work
  with: { value: inputs.value }
  out: { result: string }
}

output {
  result: steps.work.result
}
\`\`\`
`);

  let callCount = 0;
  const runtime = {
    tools: {
      "mock.work": async ({ value }) => {
        callCount += 1;
        return { result: `done:${value}` };
      },
    },
  };

  const run1 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir });
  assert.equal(callCount, 1);
  assert.equal(run1.steps[0].input_hash, undefined);

  // Even with priorSteps, cache=false forces re-execution
  const priorSteps = { work: run1.steps[0] };
  const run2 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir, priorSteps });
  assert.equal(run2.status, "success");
  assert.equal(callCount, 2);
  assert.equal(run2.steps[0].cached, undefined);
});

test("cli step: executes shell command and captures stdout/stderr/exit_code", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cli-basic
description: Basic cli step
version: 0.1
inputs: {}
outputs:
  message: string
---

\`\`\`runeflow
step greet type=cli {
  command: "echo hello-runeflow"
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { message: steps.greet.stdout }
  out: { message: string }
}

output {
  message: steps.finish.message
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir });

  assert.equal(run.status, "success");
  assert.match(run.outputs.message, /hello-runeflow/);
  assert.equal(run.steps[0].outputs.exit_code, 0);
});

test("cli step: interpolates inputs and prior step outputs into command", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cli-interpolate
description: cli interpolation
version: 0.1
inputs:
  name: string
outputs:
  result: string
---

\`\`\`runeflow
step greet type=cli {
  command: "echo hello-{{ inputs.name }}"
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { result: steps.greet.stdout }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const run = await runRuneflow(parsed, { name: "world" }, {}, { runsDir });

  assert.equal(run.status, "success");
  assert.match(run.outputs.result, /hello-world/);
});

test("cli step: non-zero exit code halts run by default", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cli-fail
description: cli failure
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step bad type=cli {
  command: "exit 1"
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { result: "done" }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir });

  assert.equal(run.status, "halted_on_error");
  assert.equal(run.halted_step_id, "bad");
  assert.match(run.error.message, /exited with code/);
});

test("cli step: allow_failure=true captures non-zero exit without halting", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: cli-allow-fail
description: cli allow failure
version: 0.1
inputs: {}
outputs:
  code: number
---

\`\`\`runeflow
step check type=cli {
  command: "exit 2"
  allow_failure: true
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { code: steps.check.exit_code }
  out: { code: number }
}

output {
  code: steps.finish.code
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.outputs.code, 2);
});

test("--force bypasses input-hash cache and re-executes steps", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: force-test
description: Force bypass cache
version: 0.1
inputs:
  value: string
outputs:
  result: string
---

\`\`\`runeflow
step work type=tool {
  tool: mock.work
  with: { value: inputs.value }
  out: { result: string }
}

output {
  result: steps.work.result
}
\`\`\`
`);

  let callCount = 0;
  const runtime = {
    tools: {
      "mock.work": async ({ value }) => {
        callCount += 1;
        return { result: `done:${value}` };
      },
    },
  };

  const run1 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir });
  assert.equal(callCount, 1);

  // With priorSteps but force=true — should re-execute despite matching hash
  const priorSteps = { work: run1.steps[0] };
  const run2 = await runRuneflow(parsed, { value: "hello" }, runtime, { runsDir, priorSteps, force: true });
  assert.equal(run2.status, "success");
  assert.equal(callCount, 2);
  assert.equal(run2.steps[0].cached, undefined);
});

test("runRuneflow executes parallel tool children and joins their outputs", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-parallel-"));
  const parsed = parseRuneflow(`---
name: parallel-tools
description: Parallel tool workflow
version: 0.1
inputs: {}
outputs:
  first: string
  results:
    - any
---

\`\`\`runeflow
parallel gather {
  steps: [fetch_one, fetch_two]
  out: { results: [any] }
}

step fetch_one type=tool {
  tool: mock.one
  out: { value: string }
}

step fetch_two type=tool {
  tool: mock.two
  out: { value: string }
}

output {
  first: steps.fetch_one.value
  results: steps.gather.results
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.one": async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { value: "one" };
      },
      "mock.two": async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { value: "two" };
      },
    },
  };

  const startedAt = Date.now();
  const run = await runRuneflow(parsed, {}, runtime, { runsDir });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(run.status, "success");
  assert.deepEqual(run.steps.map((step) => step.id), ["fetch_one", "fetch_two", "gather"]);
  assert.deepEqual(run.outputs, {
    first: "one",
    results: [{ value: "one" }, { value: "two" }],
  });
  assert.deepEqual(run.steps[2].outputs.by_step, {
    fetch_one: { value: "one" },
    fetch_two: { value: "two" },
  });
  assert.ok(
    Date.parse(run.steps[2].started_at) <= Date.parse(run.steps[0].finished_at),
    "parallel parent should start before children finish",
  );
  assert.ok(elapsedMs < 110, `expected parallel execution, got ${elapsedMs}ms`);
});

test("runRuneflow honors skip_if on parallel steps", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-parallel-skip-"));
  const parsed = parseRuneflow(`---
name: parallel-skip
description: Parallel skip workflow
version: 0.1
inputs:
  enabled: boolean
outputs:
  skipped: boolean
---

\`\`\`runeflow
parallel gather {
  skip_if: not inputs.enabled
  steps: [fetch_one, fetch_two]
}

step fetch_one type=tool {
  tool: mock.one
  out: { value: string }
}

step fetch_two type=tool {
  tool: mock.two
  out: { value: string }
}

step finish type=tool {
  tool: util.complete
  with: { skipped: steps.gather.status == "skipped" }
  out: { skipped: boolean }
}

output {
  skipped: steps.finish.skipped
}
\`\`\`
`);

  let childCalls = 0;
  const run = await runRuneflow(
    parsed,
    { enabled: false },
    {
      tools: {
        "mock.one": async () => {
          childCalls += 1;
          return { value: "one" };
        },
        "mock.two": async () => {
          childCalls += 1;
          return { value: "two" };
        },
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(childCalls, 0);
  assert.deepEqual(run.steps.map((step) => [step.id, step.status]), [
    ["gather", "skipped"],
    ["finish", "success"],
  ]);
  assert.equal(run.outputs.skipped, true);
});

test("runRuneflow honors retry on parallel steps", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-parallel-retry-"));
  const parsed = parseRuneflow(`---
name: parallel-retry
description: Parallel retry workflow
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
parallel gather retry=1 {
  steps: [fetch_one, fetch_two]
}

step fetch_one type=tool {
  tool: mock.one
  out: { value: string }
}

step fetch_two type=tool {
  tool: mock.two
  out: { value: string }
}

output {
  result: steps.gather.by_step.fetch_two.value
}
\`\`\`
`);

  let attempts = 0;
  const run = await runRuneflow(
    parsed,
    {},
    {
      tools: {
        "mock.one": async () => ({ value: "one" }),
        "mock.two": async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("temporary failure");
          }
          return { value: "two" };
        },
      },
    },
    { runsDir },
  );

  assert.equal(run.status, "success");
  assert.equal(attempts, 2);
  assert.equal(run.steps[2].id, "gather");
  assert.equal(run.steps[2].attempts, 2);
  assert.equal(run.outputs.result, "two");
});

test("runRuneflow halts on human_input when no answer is provided", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-human-input-"));
  const parsed = parseRuneflow(`---
name: approval
description: Approval workflow
version: 0.1
inputs: {}
outputs:
  answer: string
---

\`\`\`runeflow
step confirm type=human_input {
  prompt: "Deploy to production?"
  choices: ["yes", "no"]
}

output {
  answer: steps.confirm.answer
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir });

  assert.equal(run.status, "halted_on_input");
  assert.equal(run.halted_step_id, "confirm");
  assert.equal(run.pending_input.prompt, "Deploy to production?");
  assert.deepEqual(run.pending_input.choices, ["yes", "no"]);
  assert.equal(run.steps[0].status, "waiting_for_input");
});

test("runRuneflow accepts human_input answers through promptValues", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-human-input-answer-"));
  const parsed = parseRuneflow(`---
name: approval-answer
description: Approval workflow
version: 0.1
inputs: {}
outputs:
  answer: string
---

\`\`\`runeflow
step confirm type=human_input {
  prompt: "Deploy to production?"
  choices: ["yes", "no"]
}

output {
  answer: steps.confirm.answer
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, {
    runsDir,
    promptValues: {
      confirm: "yes",
    },
  });

  assert.equal(run.status, "success");
  assert.equal(run.outputs.answer, "yes");
  assert.equal(run.steps[0].outputs.answer, "yes");
});
