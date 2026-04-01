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
