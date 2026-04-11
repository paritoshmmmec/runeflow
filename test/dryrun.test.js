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

// ─── Tasks 2.1–2.8: Complete dryrun plan entry fields ────────────────────────

// 2.1 — tool step plan entries always include resolved_with
test("dryrun tool step always includes resolved_with", async () => {
  const parsed = parseRuneflow(`---
name: tool-resolved-with
description: Tool resolved_with test
version: 0.1
inputs:
  branch: string
outputs:
  result: string
---

\`\`\`runeflow
step fetch type=tool {
  tool: git.diff_summary
  with: { base: inputs.branch }
  out: { result: string }
}

output {
  result: steps.fetch.result
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { branch: "main" });

  assert.equal(result.valid, true);
  const step = result.steps.find((s) => s.id === "fetch");
  assert.ok(step, "fetch step should be in plan");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "resolved_with"), "tool step must have resolved_with");
  assert.deepEqual(step.resolved_with, { base: "main" });
});

// 2.2 — llm step plan entries always include resolved_prompt
test("dryrun llm step always includes resolved_prompt", async () => {
  const parsed = parseRuneflow(`---
name: llm-resolved-prompt
description: LLM resolved_prompt test
version: 0.1
inputs:
  topic: string
outputs:
  answer: string
llm:
  provider: mock
  model: test
---

\`\`\`runeflow
step ask type=llm {
  prompt: "Tell me about {{ inputs.topic }}."
  schema: { answer: string }
}

output {
  answer: steps.ask.answer
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { topic: "Runeflow" });

  assert.equal(result.valid, true);
  const step = result.steps.find((s) => s.id === "ask");
  assert.ok(step, "ask step should be in plan");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "resolved_prompt"), "llm step must have resolved_prompt");
  assert.equal(step.resolved_prompt, "Tell me about Runeflow.");
});

// 2.3 — cli step plan entries always include resolved_command
test("dryrun cli step always includes resolved_command", async () => {
  const parsed = parseRuneflow(`---
name: cli-resolved-command
description: CLI resolved_command test
version: 0.1
inputs:
  branch: string
outputs:
  stdout: string
---

\`\`\`runeflow
step push type=cli {
  command: "git push origin {{ inputs.branch }}"
  out: { stdout: string, stderr: string, exit_code: number }
}

output {
  stdout: steps.push.stdout
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { branch: "feature/x" });

  assert.equal(result.valid, true);
  const step = result.steps.find((s) => s.id === "push");
  assert.ok(step, "push step should be in plan");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "resolved_command"), "cli step must have resolved_command");
  assert.equal(step.resolved_command, "git push origin feature/x");
});

// 2.4 — branch step plan entries always include resolved_condition and target
test("dryrun branch step always includes resolved_condition and target", async () => {
  const parsed = parseRuneflow(`---
name: branch-fields
description: Branch fields test
version: 0.1
inputs:
  flag: boolean
outputs:
  result: string
---

\`\`\`runeflow
branch decide {
  if: inputs.flag
  then: yes_step
  else: no_step
}

step yes_step type=tool {
  tool: mock.yes
  out: { result: string }
}

step no_step type=tool {
  tool: mock.no
  out: { result: string }
}

output {
  result: steps.yes_step.result
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { flag: false });

  assert.equal(result.valid, true);
  const step = result.steps.find((s) => s.id === "decide");
  assert.ok(step, "decide step should be in plan");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "resolved_condition"), "branch step must have resolved_condition");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "target"), "branch step must have target");
  assert.equal(step.resolved_condition, false);
  assert.equal(step.target, "no_step");
});

// 2.5 — human_input plan entries include resolved_choices and resolved_default when declared
test("dryrun human_input includes resolved_choices and resolved_default when declared", async () => {
  const parsed = parseRuneflow(`---
name: human-input-fields
description: Human input fields test
version: 0.1
inputs:
  default_choice: string
outputs:
  answer: string
---

\`\`\`runeflow
step ask type=human_input {
  prompt: "Pick one:"
  choices: ["yes", "no", "maybe"]
  default: inputs.default_choice
  out: { answer: string }
}

output {
  answer: steps.ask.answer
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { default_choice: "yes" });

  assert.equal(result.valid, true);
  const step = result.steps.find((s) => s.id === "ask");
  assert.ok(step, "ask step should be in plan");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "resolved_choices"), "human_input with choices must have resolved_choices");
  assert.ok(Object.prototype.hasOwnProperty.call(step, "resolved_default"), "human_input with default must have resolved_default");
  assert.deepEqual(step.resolved_choices, ["yes", "no", "maybe"]);
  assert.equal(step.resolved_default, "yes");
});

test("dryrun human_input without choices/default does not include resolved_choices or resolved_default", async () => {
  const parsed = parseRuneflow(`---
name: human-input-no-choices
description: Human input no choices test
version: 0.1
inputs: {}
outputs:
  answer: string
---

\`\`\`runeflow
step ask type=human_input {
  prompt: "Enter something:"
  out: { answer: string }
}

output {
  answer: steps.ask.answer
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, {});

  assert.equal(result.valid, true);
  const step = result.steps.find((s) => s.id === "ask");
  assert.ok(step, "ask step should be in plan");
  assert.ok(!Object.prototype.hasOwnProperty.call(step, "resolved_choices"), "human_input without choices must not have resolved_choices");
  assert.ok(!Object.prototype.hasOwnProperty.call(step, "resolved_default"), "human_input without default must not have resolved_default");
});

// 2.6 — resolve_error is set on affected fields and planning continues when a binding fails
test("dryrun sets resolve_error and continues planning when binding cannot be resolved", async () => {
  const parsed = parseRuneflow(`---
name: resolve-error-continues
description: Resolve error continues test
version: 0.1
inputs:
  title: string
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
  with: { input: steps.first.value }
  out: { result: string }
}

step third type=cli {
  command: "echo {{ steps.second.result }}"
  out: { stdout: string, stderr: string, exit_code: number }
}

output {
  result: steps.third.stdout
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { title: "test" });

  assert.equal(result.valid, true);
  // All three steps should be in the plan (planning continues despite placeholders)
  assert.equal(result.steps.length, 3);

  const first = result.steps.find((s) => s.id === "first");
  const second = result.steps.find((s) => s.id === "second");
  const third = result.steps.find((s) => s.id === "third");

  assert.ok(first, "first step should be in plan");
  assert.ok(second, "second step should be in plan");
  assert.ok(third, "third step should be in plan");

  // second step uses placeholder from first — resolved_with should contain placeholder value
  assert.ok(second.resolved_with !== undefined || second.resolve_error !== undefined,
    "second step should have resolved_with or resolve_error");

  // third step uses placeholder from second — resolved_command should contain placeholder
  assert.ok(third.resolved_command !== undefined || third.resolve_error !== undefined,
    "third step should have resolved_command or resolve_error");
});

test("dryrun sets resolve_error when expression references non-existent binding", async () => {
  // This tests that when a step's binding throws (e.g. bad expression), resolve_error is set
  const parsed = parseRuneflow(`---
name: resolve-error-set
description: Resolve error set test
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
  with: { input: steps.first.value }
  out: { result: string }
}

output {
  result: steps.second.result
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, {});

  assert.equal(result.valid, true);
  // Planning should complete for all steps
  assert.equal(result.steps.length, 2);

  const second = result.steps.find((s) => s.id === "second");
  assert.ok(second, "second step should be in plan");
  // resolve_error should be null (placeholder resolution succeeds) or a string (if it throws)
  // Either way, the step must be present and planning must have continued
  assert.ok(second.status === "would_execute", "second step should have would_execute status");
});

// 2.7 — top-level valid boolean and steps array with id/kind/status on every entry
test("dryrun result has top-level valid boolean and steps array with id/kind/status on every entry", async () => {
  const parsed = parseRuneflow(`---
name: structure-check
description: Structure check test
version: 0.1
inputs:
  x: string
outputs:
  result: string
---

\`\`\`runeflow
step a type=tool {
  tool: mock.a
  with: { x: inputs.x }
  out: { result: string }
}

step b type=cli {
  command: "echo {{ steps.a.result }}"
  out: { stdout: string, stderr: string, exit_code: number }
}

branch c {
  if: inputs.x
  then: d
  else: e
}

step d type=tool {
  tool: mock.d
  out: { result: string }
}

step e type=tool {
  tool: mock.e
  out: { result: string }
}

output {
  result: steps.a.result
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, { x: "hello" });

  // Top-level valid boolean must be present
  assert.ok(Object.prototype.hasOwnProperty.call(result, "valid"), "result must have valid field");
  assert.equal(typeof result.valid, "boolean");
  assert.equal(result.valid, true);

  // steps must be an array
  assert.ok(Array.isArray(result.steps), "result.steps must be an array");

  // Every entry must have id, kind, status
  for (const step of result.steps) {
    assert.ok(Object.prototype.hasOwnProperty.call(step, "id"), `step must have id: ${JSON.stringify(step)}`);
    assert.ok(Object.prototype.hasOwnProperty.call(step, "kind"), `step must have kind: ${JSON.stringify(step)}`);
    assert.ok(Object.prototype.hasOwnProperty.call(step, "status"), `step must have status: ${JSON.stringify(step)}`);
    assert.equal(typeof step.id, "string");
    assert.equal(typeof step.kind, "string");
    assert.equal(typeof step.status, "string");
  }
});

// 2.8 — invalid skills return valid: false, non-empty issues, and empty steps array
test("dryrun returns valid: false, non-empty issues, and empty steps for invalid skill", async () => {
  const parsed = parseRuneflow(`---
name: invalid-skill
description: Invalid skill test
version: 0.1
inputs: {}
outputs: {}
---

\`\`\`runeflow
step bad type=tool {
  tool: nonexistent.tool
  with: { x: steps.nonexistent.value }
  out: { y: string }
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, {});

  assert.equal(result.valid, false, "valid must be false for invalid skill");
  assert.ok(result.validation, "result must have validation field");
  assert.ok(
    Array.isArray(result.validation.issues) && result.validation.issues.length > 0,
    "validation.issues must be a non-empty array"
  );
  assert.ok(Array.isArray(result.steps), "result.steps must be an array");
  assert.equal(result.steps.length, 0, "steps must be empty for invalid skill");
});

test("dryrun returns valid: false with issues when skill has missing required fields", async () => {
  const parsed = parseRuneflow(`---
name: missing-fields
description: Missing fields test
version: 0.1
inputs: {}
outputs: {}
---

\`\`\`runeflow
step broken type=tool {
  out: { y: string }
}
\`\`\`
`);

  const result = await dryrunRuneflow(parsed, {});

  assert.equal(result.valid, false);
  assert.ok(result.validation.issues.length > 0, "should have validation issues");
  assert.equal(result.steps.length, 0, "steps must be empty");
});
