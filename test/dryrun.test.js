import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { dryrunRuneflow } from "../src/dryrun.js";

test("dryrunRuneflow shows resolved bindings without executing", async () => {
  const parsed = parseRuneflow(`---
name: dryrun-test
description: Dryrun test
version: 0.1
inputs:
  base_branch: string
outputs:
  title: string
  body: string
llm:
  provider: mock
  model: test
---

\`\`\`runeflow
step diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}

step draft type=llm {
  prompt: "Draft a PR for {{ steps.diff.base }}."
  input: { summary: steps.diff.summary }
  schema: { title: string, body: string }
}

output {
  title: steps.draft.title
  body: steps.draft.body
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { base_branch: "main" });

  assert.equal(result.valid, true);
  assert.equal(result.steps.length, 2);

  // Tool step resolves inputs correctly
  assert.equal(result.steps[0].id, "diff");
  assert.equal(result.steps[0].kind, "tool");
  assert.equal(result.steps[0].status, "would_execute");
  assert.deepEqual(result.steps[0].resolved_with, { base: "main" });
  assert.equal(result.steps[0].resolve_error, null);

  // LLM step resolves prompt with placeholder from prior step
  assert.equal(result.steps[1].id, "draft");
  assert.equal(result.steps[1].kind, "llm");
  assert.equal(result.steps[1].status, "would_execute");
  assert.equal(result.steps[1].resolved_prompt, "Draft a PR for <string>.");
  assert.deepEqual(result.steps[1].resolved_input, { summary: "<string>" });
  assert.deepEqual(result.steps[1].schema, { title: "string", body: "string" });
});

test("dryrunRuneflow resolves branch conditions and routes correctly", async () => {
  const parsed = parseRuneflow(`---
name: branch-dryrun
description: Branch dryrun
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
  next: done
}

step secondary type=tool {
  tool: mock.secondary
  out: { result: string }
}

step done type=tool {
  tool: util.complete
  with: { result: "done" }
  out: { result: string }
}

output {
  result: steps.primary.result
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { use_primary: true });

  assert.equal(result.valid, true);

  const branchStep = result.steps.find((s) => s.id === "choose");
  assert.equal(branchStep.status, "would_branch");
  assert.equal(branchStep.resolved_condition, true);
  assert.equal(branchStep.target, "primary");

  const primaryStep = result.steps.find((s) => s.id === "primary");
  assert.equal(primaryStep.status, "would_execute");

  const secondaryStep = result.steps.find((s) => s.id === "secondary");
  assert.equal(secondaryStep, undefined); // never visited — branch jumped directly to primary

  const doneStep = result.steps.find((s) => s.id === "done");
  assert.equal(doneStep.status, "would_execute");
});

test("dryrunRuneflow resolves cli commands", async () => {
  const parsed = parseRuneflow(`---
name: cli-dryrun
description: CLI dryrun
version: 0.1
inputs:
  title: string
outputs:
  stdout: string
---

\`\`\`runeflow
step create type=cli cache=false {
  command: "gh pr create --title '{{ inputs.title }}'"
  out: { stdout: string, stderr: string, exit_code: number }
}

output {
  stdout: steps.create.stdout
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { title: "Fix bug" });

  assert.equal(result.valid, true);
  assert.equal(result.steps[0].kind, "cli");
  assert.equal(result.steps[0].status, "would_execute");
  assert.equal(result.steps[0].resolved_command, "gh pr create --title 'Fix bug'");
  assert.equal(result.steps[0].cache, false);
});

test("dryrunRuneflow evaluates transform expressions when input is resolvable", async () => {
  const parsed = parseRuneflow(`---
name: transform-dryrun
description: Transform dryrun
version: 0.1
inputs:
  items:
    - string
outputs:
  count: number
---

\`\`\`runeflow
step count type=transform {
  input: inputs.items
  expr: "{ count: input.length }"
  out: { count: number }
}

output {
  count: steps.count.count
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { items: ["a", "b", "c"] });

  assert.equal(result.valid, true);
  assert.equal(result.steps[0].kind, "transform");
  assert.deepEqual(result.steps[0].computed_outputs, { count: 3 });
  assert.equal(result.output.count, 3);
});

test("dryrunRuneflow returns validation errors for invalid skills", async () => {
  const parsed = parseRuneflow(`---
name: invalid
description: Invalid skill
version: 0.1
inputs: {}
outputs: {}
---

\`\`\`runeflow
step missing type=tool {
  tool: nonexistent.tool
  with: { x: steps.future_step.value }
  out: { y: string }
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, {});

  assert.equal(result.valid, false);
  assert.ok(result.validation.issues.length > 0);
  assert.equal(result.steps.length, 0);
});

test("dryrunRuneflow handles skip_if correctly", async () => {
  const parsed = parseRuneflow(`---
name: skip-dryrun
description: Skip dryrun
version: 0.1
inputs:
  skip: boolean
outputs:
  result: string
---

\`\`\`runeflow
step maybe type=tool {
  skip_if: inputs.skip
  tool: mock.do
  out: { result: string }
}

output {
  result: steps.maybe.result
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { skip: true });

  assert.equal(result.valid, true);
  assert.equal(result.steps[0].status, "skipped");
  assert.match(result.steps[0].reason, /skip_if/);
});

test("dryrunRuneflow resolves block templates", async () => {
  const parsed = parseRuneflow(`---
name: block-dryrun
description: Block dryrun
version: 0.1
inputs:
  name: string
outputs:
  greeting: string
llm:
  provider: mock
  model: test
---

\`\`\`runeflow
block greet_template type=llm {
  prompt: "Say hello to {{ inputs.name }}."
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

  const result = await dryrunRuneflow(parsed, { name: "Alice" });

  assert.equal(result.valid, true);
  assert.equal(result.steps[0].id, "greet");
  assert.equal(result.steps[0].kind, "llm");
  assert.equal(result.steps[0].resolved_prompt, "Say hello to Alice.");
});
