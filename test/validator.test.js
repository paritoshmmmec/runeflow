import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { validateRuneflow } from "../src/validator.js";

test("validateRuneflow accepts a valid hybrid runeflow", () => {
  const parsed = parseRuneflow(`---
name: valid
description: Valid skill
version: 0.1
inputs:
  enabled: boolean
outputs:
  done: boolean
---

\`\`\`runeflow
step check type=tool {
  tool: mock.check
  out: { ok: boolean }
}

branch choose {
  if: steps.check.ok
  then: finish
  else: finish
}

step finish type=tool {
  tool: mock.finish
  out: { done: boolean }
}

output {
  done: steps.finish.done
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("validateRuneflow rejects forward references and missing llm schema", () => {
  const parsed = parseRuneflow(`---
name: invalid
description: Invalid skill
version: 0.1
inputs:
  flag: boolean
outputs:
  result: string
---

\`\`\`runeflow
step write type=llm {
  prompt: "hi"
}

step use type=tool {
  tool: mock.use
  with: { title: steps.future.title }
  out: { result: string }
}

step future type=tool {
  tool: mock.future
  out: { title: string }
}

output {
  result: steps.use.result
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /must declare a schema/);
  assert.match(validation.issues.join("\n"), /unknown or forward step reference/);
});
