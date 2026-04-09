import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { SkillSyntaxError } from "../src/errors.js";

const source = `---
name: demo
description: Demo skill
version: 0.1
inputs:
  flag: boolean
outputs:
  result: string
---

# Demo

Docs live here.

\`\`\`runeflow
step first type=tool {
  tool: file.exists
  with: { path: "README.md" }
  out: { exists: boolean }
}

output {
  result: "ok"
}
\`\`\`
`;

test("parseRuneflow extracts metadata docs and workflow", () => {
  const parsed = parseRuneflow(source);

  assert.equal(parsed.metadata.name, "demo");
  assert.match(parsed.docs, /Docs live here/);
  assert.equal(parsed.workflow.steps.length, 1);
  assert.equal(parsed.workflow.steps[0].id, "first");
  assert.equal(parsed.workflow.steps[0].tool, "file.exists");
});

test("parseRuneflow preserves default and step-level llm config", () => {
  const parsed = parseRuneflow(`---
name: llm-config
description: LLM config parsing
llm:
  provider: anthropic
  router: false
  model: sonnet
---

\`\`\`runeflow
step draft type=llm {
  llm: {
    provider: cerebras,
    router: false,
    model: qwen
  }
  prompt: "hi"
  schema: { title: string }
}

output {
}
\`\`\`
`);

  assert.deepEqual(parsed.metadata.llm, {
    provider: "anthropic",
    router: false,
    model: "sonnet",
  });
  assert.deepEqual(parsed.workflow.steps[0].llm, {
    provider: "cerebras",
    router: false,
    model: "qwen",
  });
});

test("parseRuneflow accepts legacy skill blocks for compatibility", () => {
  const parsed = parseRuneflow(`---
name: legacy
description: Legacy format
---

\`\`\`skill
step first type=tool {
  tool: mock.first
  out: { ok: boolean }
}

output {
}
\`\`\`
`);

  assert.equal(parsed.workflow.steps.length, 1);
  assert.equal(parsed.workflow.steps[0].id, "first");
});

test("parseRuneflow extracts named guidance blocks and removes them from docs", () => {
  const parsed = parseRuneflow(`---
name: doc-blocks
description: Named doc blocks
---

# Overview

General context here.

:::guidance[pr-tone]
Keep PR titles under 72 chars. Use imperative mood.
:::

:::guidance[diff-context]
Focus on behavioral changes, not style fixes.
:::

Some trailing prose.

\`\`\`runeflow
step work type=tool {
  tool: util.complete
  with: { ok: true }
  out: { ok: boolean }
}

output {
}
\`\`\`
`);

  assert.deepEqual(Object.keys(parsed.docBlocks), ["pr-tone", "diff-context"]);
  assert.match(parsed.docBlocks["pr-tone"], /imperative mood/);
  assert.match(parsed.docBlocks["diff-context"], /behavioral changes/);
  assert.doesNotMatch(parsed.docs, /imperative mood/);
  assert.doesNotMatch(parsed.docs, /behavioral changes/);
  assert.match(parsed.docs, /General context here/);
  assert.match(parsed.docs, /trailing prose/);
});

test("parseRuneflow returns empty docBlocks when no guidance blocks are present", () => {
  const parsed = parseRuneflow(`---
name: no-blocks
description: No blocks
---

Just docs.

\`\`\`runeflow
step work type=tool {
  tool: util.complete
  with: { ok: true }
  out: { ok: boolean }
}

output {
}
\`\`\`
`);

  assert.deepEqual(parsed.docBlocks, {});
  assert.match(parsed.docs, /Just docs/);
});

test("parseRuneflow expands block references into concrete steps", () => {
  const parsed = parseRuneflow(`---
name: block-parse
description: Block expansion
version: 0.1
inputs:
  name: string
outputs:
  greeting: string
llm:
  provider: mock
  router: false
  model: x
---

\`\`\`runeflow
block greet_template type=llm {
  prompt: "Hello {{ inputs.name }}"
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

  assert.equal(parsed.workflow.steps.length, 1);
  assert.equal(parsed.workflow.steps[0].id, "greet");
  assert.equal(parsed.workflow.steps[0].kind, "llm");
  assert.equal(parsed.workflow.steps[0].prompt, "Hello {{ inputs.name }}");
  assert.deepEqual(parsed.workflow.steps[0].schema, { greeting: "string" });
});

test("parseRuneflow throws when a block reference is unknown", () => {
  assert.throws(
    () =>
      parseRuneflow(`---
name: bad-block
description: Missing block
version: 0.1
inputs: {}
outputs: {}
---

\`\`\`runeflow
step x type=block {
  block: no_such_block
}

output {}
\`\`\`
`),
    (error) => error instanceof SkillSyntaxError && /Unknown block 'no_such_block'/.test(error.message),
  );
});

test("parseRuneflow throws on duplicate block ids", () => {
  assert.throws(
    () =>
      parseRuneflow(`---
name: dup-block
description: Dup
version: 0.1
inputs: {}
outputs: {}
---

\`\`\`runeflow
block a type=tool {
  tool: util.complete
  with: { x: 1 }
  out: { x: number }
}

block a type=llm {
  prompt: "x"
  schema: { y: string }
}

output {}
\`\`\`
`),
    (error) => error instanceof SkillSyntaxError && /Duplicate block id 'a'/.test(error.message),
  );
});

test("parseRuneflow extracts mcp_servers and composio from frontmatter into metadata", () => {
  const parsed = parseRuneflow(`---
name: mcp-frontmatter-test
description: Test mcp_servers and composio parsing
version: 0.1
inputs: {}
outputs:
  result: string
mcp_servers:
  github:
    command: npx
    args: ["-y", "@github/mcp-server"]
  slack:
    url: "https://mcp.composio.dev/slack"
    headers:
      x-api-key: "\${SLACK_KEY}"
composio:
  tools: ["GITHUB_LIST_BRANCHES"]
  entity_id: "\${COMPOSIO_ENTITY_ID}"
---

\`\`\`runeflow
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

  assert.deepEqual(parsed.metadata.mcp_servers, {
    github: { command: "npx", args: ["-y", "@github/mcp-server"] },
    slack: { url: "https://mcp.composio.dev/slack", headers: { "x-api-key": "${SLACK_KEY}" } },
  });
  assert.deepEqual(parsed.metadata.composio, {
    tools: ["GITHUB_LIST_BRANCHES"],
    entity_id: "${COMPOSIO_ENTITY_ID}",
  });
});

test("parseRuneflow returns null for mcp_servers and composio when not declared", () => {
  const parsed = parseRuneflow(`---
name: no-mcp
description: No MCP
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
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

  assert.equal(parsed.metadata.mcp_servers, null);
  assert.equal(parsed.metadata.composio, null);
});
