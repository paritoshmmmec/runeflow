import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";

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
