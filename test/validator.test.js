import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("validateRuneflow includes available input field names in unknown inputs.* error", () => {
  const parsed = parseRuneflow(`---
name: inputs-hint
description: Inputs hint test
version: 0.1
inputs:
  repo: string
  owner: string
outputs:
  result: string
---

\`\`\`runeflow
step fetch type=tool {
  tool: mock.fetch
  with: { name: inputs.typo }
  out: { result: string }
}

output {
  result: steps.fetch.result
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  const errorMsg = validation.issues.join("\n");
  assert.match(errorMsg, /unknown input reference 'inputs\.typo'/);
  // Must always include available input field names
  assert.match(errorMsg, /available inputs:/);
  assert.match(errorMsg, /repo/);
  assert.match(errorMsg, /owner/);
});

test("validateRuneflow step reference error always includes did-you-mean or available steps", () => {
  // Case 1: similar step exists → did you mean
  const parsedTypo = parseRuneflow(`---
name: step-hint-typo
description: Step hint typo test
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step fetch_data type=tool {
  tool: mock.fetch
  out: { result: string }
}

step use type=tool {
  tool: mock.use
  with: { val: steps.fetch_dta.result }
  out: { result: string }
}

output {
  result: steps.use.result
}
\`\`\`
`);

  const v1 = validateRuneflow(parsedTypo);
  assert.equal(v1.valid, false);
  const msg1 = v1.issues.join("\n");
  assert.match(msg1, /unknown or forward step reference 'steps\.fetch_dta\.result'/);
  assert.match(msg1, /did you mean 'steps\.fetch_data/);

  // Case 2: no similar step → list available steps
  const parsedNoMatch = parseRuneflow(`---
name: step-hint-list
description: Step hint list test
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step alpha type=tool {
  tool: mock.alpha
  out: { result: string }
}

step beta type=tool {
  tool: mock.beta
  with: { val: steps.zzz_unknown.result }
  out: { result: string }
}

output {
  result: steps.beta.result
}
\`\`\`
`);

  const v2 = validateRuneflow(parsedNoMatch);
  assert.equal(v2.valid, false);
  const msg2 = v2.issues.join("\n");
  assert.match(msg2, /unknown or forward step reference 'steps\.zzz_unknown\.result'/);
  assert.match(msg2, /available steps:/);
  assert.match(msg2, /alpha/);

  // Case 3: no steps available yet (forward reference from first step) → available steps: none
  const parsedNoSteps = parseRuneflow(`---
name: step-hint-none
description: Step hint none test
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step first type=tool {
  tool: mock.first
  with: { val: steps.nonexistent.result }
  out: { result: string }
}

output {
  result: steps.first.result
}
\`\`\`
`);

  const v3 = validateRuneflow(parsedNoSteps);
  assert.equal(v3.valid, false);
  const msg3 = v3.issues.join("\n");
  assert.match(msg3, /unknown or forward step reference 'steps\.nonexistent\.result'/);
  // Must always include a hint — never a bare message
  assert.match(msg3, /available steps:/);
  assert.match(msg3, /none/);
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

test("validateRuneflow accepts llm step with valid docs reference", () => {
  const parsed = parseRuneflow(`---
name: docs-valid
description: Valid docs reference
version: 0.1
inputs: {}
outputs:
  title: string
llm:
  provider: mock
  router: false
  model: base
---

:::guidance[pr-tone]
Keep titles short.
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

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, true);
});

test("validateRuneflow rejects llm step with unknown docs reference", () => {
  const parsed = parseRuneflow(`---
name: docs-invalid
description: Invalid docs reference
version: 0.1
inputs: {}
outputs:
  title: string
llm:
  provider: mock
  router: false
  model: base
---

\`\`\`runeflow
step draft type=llm {
  docs: nonexistent-block
  prompt: "Draft a PR title."
  schema: { title: string }
}

output {
  title: steps.draft.title
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /unknown block 'nonexistent-block'/);
});

test("validateRuneflow accepts a valid transform step", () => {
  const parsed = parseRuneflow(`---
name: transform-valid
description: Valid transform
version: 0.1
inputs: {}
outputs:
  count: number
---

\`\`\`runeflow
step fetch type=tool {
  tool: util.complete
  with: { items: ["a", "b"] }
  out: { items: [string] }
}

step count type=transform {
  input: steps.fetch.items
  expr: "input.length"
  out: { count: number }
}

output {
  count: steps.count.count
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, true);
});

test("validateRuneflow rejects transform step missing expr or out", () => {
  const parsed = parseRuneflow(`---
name: transform-invalid
description: Invalid transform
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step reshape type=transform {
  input: "hello"
}

output {
  value: steps.reshape.value
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /must declare an expr/);
  assert.match(validation.issues.join("\n"), /must declare an out schema/);
});

test("validateRuneflow rejects invalid references in transform step input", () => {
  const parsed = parseRuneflow(`---
name: transform-bad-input-ref
description: Bad transform input ref
version: 0.1
inputs: {}
outputs:
  n: number
---

\`\`\`runeflow
step bad type=transform {
  input: steps.missing.x
  expr: "1"
  out: { n: number }
}

output {
  n: steps.bad.n
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /unknown or forward step reference/);
});

test("validateRuneflow accepts a valid cli step", () => {
  const parsed = parseRuneflow(`---
name: cli-valid
description: Valid cli step
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step run type=cli {
  command: "echo done"
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { result: steps.run.stdout }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateRuneflow rejects cli step missing command", () => {
  const parsed = parseRuneflow(`---
name: cli-no-command
description: Missing command
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step run type=cli {
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { result: steps.run.stdout }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("must declare a command")));
});

test("validateRuneflow checks interpolated references in cli command", () => {
  const parsed = parseRuneflow(`---
name: cli-bad-ref
description: Bad reference in command
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step run type=cli {
  command: "echo {{ inputs.nonexistent }}"
  out: { stdout: string, stderr: string, exit_code: number }
}

step finish type=tool {
  tool: util.complete
  with: { result: steps.run.stdout }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("nonexistent")));
});

test("validateRuneflow accepts a valid parallel tool block", () => {
  const parsed = parseRuneflow(`---
name: parallel-valid
description: Valid parallel block
version: 0.1
inputs: {}
outputs:
  results:
    - any
  first: string
---

\`\`\`runeflow
parallel gather {
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
  results: steps.gather.results
  first: steps.gather.by_step.fetch_one.value
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateRuneflow rejects invalid parallel child wiring", () => {
  const parsed = parseRuneflow(`---
name: parallel-invalid
description: Invalid parallel block
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
parallel gather {
  steps: [fetch_one, fetch_two]
  out: { results: [any] }
}

step fetch_one type=tool {
  tool: mock.one
  with: { value: steps.fetch_two.value }
  out: { value: string }
}

step fetch_two type=tool {
  tool: mock.two
  next: finish
  out: { value: string }
}

step finish type=tool {
  tool: mock.finish
  with: { value: steps.fetch_one.value }
  out: { value: string }
}

output {
  value: steps.finish.value
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /may not declare next/);
  assert.match(result.issues.join("\n"), /may not reference sibling step 'fetch_two'/);
});

test("validateRuneflow accepts a valid human_input step", () => {
  const parsed = parseRuneflow(`---
name: input-valid
description: Valid human input
version: 0.1
inputs: {}
outputs:
  answer: string
---

\`\`\`runeflow
step confirm type=human_input {
  prompt: "Deploy?"
  choices: ["yes", "no"]
}

output {
  answer: steps.confirm.answer
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateRuneflow rejects invalid human_input choices", () => {
  const parsed = parseRuneflow(`---
name: input-invalid
description: Invalid human input
version: 0.1
inputs: {}
outputs:
  answer: string
---

\`\`\`runeflow
step confirm type=human_input {
  prompt: "Deploy?"
  choices: []
}

output {
  answer: steps.confirm.answer
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /choices must be a non-empty array/);
});

test("validateRuneflow rejects mcp_servers entry without command or url", () => {
  const parsed = parseRuneflow(`---
name: bad-mcp-server
description: Bad MCP server config
version: 0.1
inputs: {}
outputs:
  result: string
mcp_servers:
  github:
    env:
      TOKEN: abc
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

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("must declare either 'command' (stdio) or 'url' (HTTP)")));
});

test("validateRuneflow rejects mcp_servers entry with both command and url", () => {
  const parsed = parseRuneflow(`---
name: both-mcp
description: Both command and url
version: 0.1
inputs: {}
outputs:
  result: string
mcp_servers:
  github:
    command: npx
    url: "https://example.com/mcp"
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

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("must declare 'command' OR 'url', not both")));
});

test("validateRuneflow rejects composio without tools or toolkits", () => {
  const parsed = parseRuneflow(`---
name: bad-composio
description: Composio without tools
version: 0.1
inputs: {}
outputs:
  result: string
composio:
  entity_id: "default"
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

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("must declare at least one of 'tools' or 'toolkits'")));
});

test("validateRuneflow catches mcp.* tool referencing undeclared server in mcp_servers", () => {
  const parsed = parseRuneflow(`---
name: undeclared-mcp
description: Undeclared MCP server
version: 0.1
inputs: {}
outputs:
  result: string
mcp_servers:
  github:
    command: npx
---

\`\`\`runeflow
step search type=tool {
  tool: mcp.slack.search
  with: { query: "hello" }
  out: { content: [any], isError: boolean, raw: any }
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

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("not declared in mcp_servers")));
});

test("validateRuneflow loads and merges cross-file imported blocks", async () => {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-imports-"));
  const importedFile = path.join(tmpdir, "shared.runeflow.md");
  const mainFile = path.join(tmpdir, "main.runeflow.md");

  await fs.writeFile(importedFile, `---
name: shared
description: Shared blocks
version: 0.1
inputs: {}
outputs: {}
---
\`\`\`runeflow
block hello_template type=tool {
  tool: mock.hello
  out: { msg: string }
}
\`\`\`
`);

  await fs.writeFile(mainFile, `---
name: main
description: Main skill
version: 0.1
inputs: {}
outputs:
  greeting: string
---
\`\`\`runeflow
import blocks from "./shared.runeflow.md"

step greet type=block {
  block: hello_template
}

output {
  greeting: steps.greet.msg
}
\`\`\`
`);

  const source = await fs.readFile(mainFile, "utf8");
  const parsed = parseRuneflow(source, { sourcePath: mainFile });
  const validation = validateRuneflow(parsed, { sourcePath: mainFile });

  assert.equal(validation.valid, true, `Validation failed: ${validation.issues.join(", ")}`);
  assert.deepEqual(validation.issues, []);
});

test("validateRuneflow rejects invalid import paths", async () => {
  const parsed = parseRuneflow(`---
name: invalid-import
description: Invalid import path
version: 0.1
inputs: {}
outputs:
  greeting: string
---
\`\`\`runeflow
import blocks from "./does-not-exist.runeflow.md"

step greet type=block {
  block: hello_template
}

output {
  greeting: steps.greet.msg
}
\`\`\`
`);

  const validation = validateRuneflow(parsed, { sourcePath: "/mock/main.runeflow.md" });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((i) => i.includes("Imported file not found")));
  // Cascading "Unknown block" noise should be suppressed when the root cause is a missing import
  assert.ok(!validation.issues.some((i) => i.includes("Unknown block 'hello_template'")));
});

test("validateRuneflow accepts parallel llm and cli children", () => {
  const parsed = parseRuneflow(`---
name: parallel-mixed
description: Parallel with llm and cli children
version: 0.1
inputs: {}
outputs:
  ok: boolean
llm:
  provider: mock
  router: false
  model: base
---

\`\`\`runeflow
parallel checks {
  steps: [draft, run_cmd]
}

step draft type=llm {
  prompt: "Write something."
  schema: { title: string }
}

step run_cmd type=cli {
  command: "echo hello"
}

step finish type=tool {
  tool: util.complete
  with: { ok: true }
  out: { ok: boolean }
}

output {
  ok: steps.finish.ok
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateRuneflow rejects disallowed parallel child kinds", () => {
  const parsed = parseRuneflow(`---
name: parallel-bad-kind
description: Parallel with disallowed child kind
version: 0.1
inputs: {}
outputs:
  ok: boolean
---

\`\`\`runeflow
parallel checks {
  steps: [transform_step]
}

step transform_step type=transform {
  input: "hello"
  expr: "input.toUpperCase()"
  out: string
}

step finish type=tool {
  tool: util.complete
  with: { ok: true }
  out: { ok: boolean }
}

output {
  ok: steps.finish.ok
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /must be a tool, llm, or cli step/);
});

test("validateRuneflow parallel ordering error includes expected and actual order", () => {
  const parsed = parseRuneflow(`---
name: parallel-order-hint
description: Parallel ordering error includes expected and actual order
version: 0.1
inputs: {}
outputs:
  ok: boolean
---

\`\`\`runeflow
parallel gather {
  steps: [fetch_one, fetch_two]
}

step fetch_two type=tool {
  tool: mock.two
  out: { value: string }
}

step fetch_one type=tool {
  tool: mock.one
  out: { value: string }
}

step finish type=tool {
  tool: mock.finish
  out: { ok: boolean }
}

output {
  ok: steps.finish.ok
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);
  const orderingIssue = result.issues.find((i) => i.includes("child steps must be declared immediately after"));
  assert.ok(orderingIssue, "should have a parallel ordering issue");
  assert.match(orderingIssue, /expected: \[fetch_one, fetch_two\]/);
  assert.match(orderingIssue, /actual: \[fetch_two, fetch_one\]/);
});

test("validateRuneflow deduplicates issues so a single root cause produces at most one error message", () => {
  // When parallel children are declared before the parallel block, the ordering check
  // and the per-child "must point forward" check both fire for the same root cause.
  // The validator must deduplicate so no identical string appears twice.
  const parsed = parseRuneflow(`---
name: dedup-test
description: Deduplication test
version: 0.1
inputs: {}
outputs:
  ok: boolean
---

\`\`\`runeflow
step fetch_one type=tool {
  tool: mock.one
  out: { value: string }
}

step fetch_two type=tool {
  tool: mock.two
  out: { value: string }
}

parallel gather {
  steps: [fetch_one, fetch_two]
}

step finish type=tool {
  tool: mock.finish
  out: { ok: boolean }
}

output {
  ok: steps.finish.ok
}
\`\`\`
`);

  const result = validateRuneflow(parsed);
  assert.equal(result.valid, false);

  // No duplicate strings in the issues array
  const unique = new Set(result.issues);
  assert.equal(result.issues.length, unique.size, `Duplicate issues found: ${result.issues.join("; ")}`);
});

test("validateRuneflow branch target error includes missing target name and available step ids", () => {
  const parsed = parseRuneflow(`---
name: branch-target-hint
description: Branch target hint test
version: 0.1
inputs:
  flag: boolean
outputs:
  result: string
---

\`\`\`runeflow
step check type=tool {
  tool: mock.check
  out: { ok: boolean }
}

branch decide {
  if: steps.check.ok
  then: nonexistent_step
  else: finish
}

step finish type=tool {
  tool: mock.finish
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, false);
  const errorMsg = validation.issues.join("\n");
  // Must include the missing target name
  assert.match(errorMsg, /nonexistent_step/);
  // Must include available steps list
  assert.match(errorMsg, /available steps:/);
  // Must include at least one of the declared step ids
  assert.match(errorMsg, /check|decide|finish/);
});
