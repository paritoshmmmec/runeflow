import test from "node:test";
import assert from "node:assert/strict";
import { parseSkill } from "../src/parser.js";

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

\`\`\`skill
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

test("parseSkill extracts metadata docs and workflow", () => {
  const parsed = parseSkill(source);

  assert.equal(parsed.metadata.name, "demo");
  assert.match(parsed.docs, /Docs live here/);
  assert.equal(parsed.workflow.steps.length, 1);
  assert.equal(parsed.workflow.steps[0].id, "first");
  assert.equal(parsed.workflow.steps[0].tool, "file.exists");
});
