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

test("validateRuneflow checks interpolated references in prompts outputs and fail messages", () => {
  const parsed = parseRuneflow(`---
name: interpolated
description: Interpolated references
version: 0.1
inputs:
  branch: string
outputs:
  message: string
---

\`\`\`runeflow
step first type=tool {
  tool: mock.first
  out: { ok: boolean }
}

step draft type=llm {
  prompt: "Draft {{ steps.future.title }} for {{ inputs.branch }}"
  input: { ready: "{{ steps.first.ok }}" }
  schema: { title: string }
  fail_message: "Unable to draft for {{ inputs.unknown }}"
}

output {
  message: "Prepared {{ steps.draft.missing }}"
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);

  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /unknown or forward step reference 'steps\.future\.title'/);
  assert.match(validation.issues.join("\n"), /unknown input reference 'inputs\.unknown'/);
  assert.match(validation.issues.join("\n"), /unknown step output path 'steps\.draft\.missing'/);
});

test("validateRuneflow enforces metadata and step llm config rules", () => {
  const parsed = parseRuneflow(`---
name: llm-config
description: LLM config validation
version: 0.1
inputs: {}
outputs:
  result: string
llm:
  provider: anthropic
  router: false
---

\`\`\`runeflow
step review type=tool {
  llm: {
    provider: cerebras
  }
  tool: mock.review
  out: { result: string }
}

step draft type=llm {
  llm: { provider: cerebras, router: "sometimes" }
  prompt: "hi"
  schema: { result: string }
}

output {
  result: steps.review.result
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);

  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /metadata\.llm\.model is required when router is false/);
  assert.match(validation.issues.join("\n"), /step 'review' may only declare llm config when kind is 'llm'/);
  assert.match(validation.issues.join("\n"), /step 'draft' llm\.router must be a boolean/);
});

test("validateRuneflow accepts registered tool output schema when out is omitted", () => {
  const parsed = parseRuneflow(`---
name: registry-backed
description: Registry-backed tool contract
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

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("validateRuneflow rejects tool step without out when no registry contract exists", () => {
  const parsed = parseRuneflow(`---
name: missing-out
description: Missing tool output schema
version: 0.1
inputs: {}
outputs:
  count: number
---

\`\`\`runeflow
step count_prs type=tool {
  tool: github.unknown_tool
  with: {}
}

output {
  count: steps.count_prs.count
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /must declare an out schema or reference a registered tool with an outputSchema/);
});
