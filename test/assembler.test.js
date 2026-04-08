import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { assembleRuneflow } from "../src/assembler.js";

const BASE_SKILL = `---
name: test-skill
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  body: string
llm:
  provider: cerebras
  router: false
  model: test-model
---

# Operator guidance

Use the diff to write a concise PR.

\`\`\`runeflow
step branch type=tool {
  tool: mock.branch
  out: { branch: string }
}

step diff type=tool {
  tool: mock.diff
  with: { base: inputs.base_branch }
  out: { summary: string }
}

step draft type=llm {
  prompt: |
    Draft a PR for {{ steps.branch.branch }} targeting {{ inputs.base_branch }}.
    Diff: {{ steps.diff.summary }}
  input: {
    branch: steps.branch.branch,
    diff_summary: steps.diff.summary
  }
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
\`\`\`
`;

test("assembleRuneflow: runs tool steps and resolves prompt with real values", async () => {
  const definition = parseRuneflow(BASE_SKILL);
  const runtime = {
    tools: {
      "mock.branch": async () => ({ branch: "feat/my-feature" }),
      "mock.diff": async ({ base }) => ({ summary: `3 files changed vs ${base}` }),
    },
  };

  const result = await assembleRuneflow(definition, "draft", { base_branch: "main" }, runtime);

  assert.ok(result.includes("feat/my-feature"), "resolved branch in prompt");
  assert.ok(result.includes("3 files changed vs main"), "resolved diff in prompt");
  assert.ok(result.includes("main"), "resolved base_branch input");
  assert.ok(result.includes('"title"'), "output schema present");
  assert.ok(result.includes('"body"'), "output schema present");
  assert.ok(result.includes("Operator guidance"), "docs included");
  assert.ok(!result.includes("```runeflow"), "no runeflow block in output");
  assert.ok(!result.includes("step branch"), "no step declarations in output");
});

test("assembleRuneflow: resolved input section is included", async () => {
  const definition = parseRuneflow(BASE_SKILL);
  const runtime = {
    tools: {
      "mock.branch": async () => ({ branch: "main" }),
      "mock.diff": async () => ({ summary: "no changes" }),
    },
  };

  const result = await assembleRuneflow(definition, "draft", { base_branch: "main" }, runtime);

  assert.ok(result.includes("Resolved input"), "resolved input section present");
  assert.ok(result.includes("diff_summary"), "resolved input contains diff_summary key");
});

test("assembleRuneflow: uses named doc block when step has docs:", async () => {
  const skill = `---
name: doc-block-skill
version: 0.1
inputs: {}
outputs:
  result: string
llm:
  provider: cerebras
  router: false
  model: test
---

# Full docs

:::guidance[pr-tone]
Keep titles short. Use imperative mood.
:::

\`\`\`runeflow
step draft type=llm {
  docs: pr-tone
  prompt: "Draft something."
  schema: { result: string }
}

output {
  result: steps.draft.result
}
\`\`\`
`;

  const definition = parseRuneflow(skill);
  const result = await assembleRuneflow(definition, "draft", {}, {});

  assert.ok(result.includes("imperative mood"), "named doc block content present");
  assert.ok(!result.includes("Full docs"), "full docs not included when named block used");
});

test("assembleRuneflow: transform steps are executed before target", async () => {
  const skill = `---
name: transform-skill
version: 0.1
inputs: {}
outputs:
  summary: string
llm:
  provider: cerebras
  router: false
  model: test
---

\`\`\`runeflow
step fetch type=tool {
  tool: mock.fetch
  out: { items: [string] }
}

step filter type=transform {
  input: steps.fetch.items
  expr: "input.filter(x => x.startsWith('feat'))"
  out: [string]
}

step draft type=llm {
  prompt: "Summarize: {{ steps.filter }}"
  input: { items: steps.filter }
  schema: { summary: string }
}

output {
  summary: steps.draft.summary
}
\`\`\`
`;

  const definition = parseRuneflow(skill);
  const runtime = {
    tools: {
      "mock.fetch": async () => ({ items: ["feat/a", "fix/b", "feat/c"] }),
    },
  };

  const result = await assembleRuneflow(definition, "draft", {}, runtime);

  assert.ok(result.includes("feat/a"), "transform output resolved in prompt");
  assert.ok(result.includes("feat/c"), "transform output resolved in prompt");
  assert.ok(!result.includes("fix/b"), "filtered item not in output");
});

test("assembleRuneflow: throws on unknown step id", async () => {
  const definition = parseRuneflow(BASE_SKILL);
  const runtime = {
    tools: {
      "mock.branch": async () => ({ branch: "main" }),
      "mock.diff": async () => ({ summary: "x" }),
    },
  };

  await assert.rejects(
    () => assembleRuneflow(definition, "nonexistent", {}, runtime),
    /not found/,
  );
});

test("assembleRuneflow: throws when target step is not llm", async () => {
  const definition = parseRuneflow(BASE_SKILL);
  const runtime = {
    tools: {
      "mock.branch": async () => ({ branch: "main" }),
      "mock.diff": async () => ({ summary: "x" }),
    },
  };

  await assert.rejects(
    () => assembleRuneflow(definition, "branch", {}, runtime),
    /only works on 'llm' steps/,
  );
});

test("assembleRuneflow: throws when a pre-step tool is not registered", async () => {
  const definition = parseRuneflow(BASE_SKILL);

  await assert.rejects(
    () => assembleRuneflow(definition, "draft", { base_branch: "main" }, {}),
    /not registered/,
  );
});

test("assembleRuneflow: supports plugin-contributed tools", async () => {
  const runtime = {
    plugins: [
      {
        name: "plugin-tools",
        tools: {
          "plugin.branch": async () => ({ branch: "feat/plugin" }),
          "plugin.diff": async ({ base }) => ({ summary: `plugin diff vs ${base}` }),
        },
      },
    ],
  };

  const pluginDefinition = parseRuneflow(BASE_SKILL
    .replaceAll("mock.branch", "plugin.branch")
    .replaceAll("mock.diff", "plugin.diff"));

  const result = await assembleRuneflow(pluginDefinition, "draft", { base_branch: "main" }, runtime);

  assert.ok(result.includes("feat/plugin"));
  assert.ok(result.includes("plugin diff vs main"));
});

test("assembleRuneflow: output contains skill name and step id in header", async () => {
  const definition = parseRuneflow(BASE_SKILL);
  const runtime = {
    tools: {
      "mock.branch": async () => ({ branch: "main" }),
      "mock.diff": async () => ({ summary: "x" }),
    },
  };

  const result = await assembleRuneflow(definition, "draft", { base_branch: "main" }, runtime);

  assert.ok(result.includes("test-skill"), "skill name in header");
  assert.ok(result.includes("`draft`"), "step id in header");
});
