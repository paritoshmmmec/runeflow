import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { runTest } from "../src/test-runner.js";

test("runTest passes when all assertions match", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-pass-"));
  const definition = parseRuneflow(`---
name: test-pass
description: A passing test
inputs:
  base: string
outputs:
  title: string
llm:
  provider: mock
  model: baseline
---
\`\`\`runeflow
step branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step draft type=llm {
  prompt: "draft for {{ steps.branch.branch }}"
  schema: { title: string }
}

output {
  title: steps.draft.title
}
\`\`\`
`);

  const fixture = {
    inputs: { base: "main" },
    mocks: {
      tools: {
        "git.current_branch": { branch: "feat/mock" }
      },
      llm: {
        "draft": { title: "Mock PR Title" }
      }
    },
    expect: {
      status: "success",
      outputs: { title: "Mock PR Title" },
      steps: {
        branch: { status: "success", outputs: { branch: "feat/mock" } },
        draft: { status: "success", outputs: { title: "Mock PR Title" } }
      }
    }
  };

  const result = await runTest(definition, fixture, { runsDir });

  if (result.run && result.run.status !== "success") {
    const failedStep = result.run.steps.find(s => s.status === "failed");
    if (failedStep) {
        console.error("Failed step error:", JSON.stringify(failedStep.error, null, 2));
    } else {
        console.error("Run error:", JSON.stringify(result.run.error, null, 2));
    }
  }

  assert.equal(result.pass, true, `Failures: ${JSON.stringify(result.failures)}`);
  assert.equal(result.failures.length, 0);
  assert.equal(result.run.status, "success");
  assert.deepEqual(result.toolCalls["git.current_branch"], [{}]);
  assert.equal(result.llmCalls["draft"][0].prompt, "draft for feat/mock");
});

test("runTest fails when status mismatch", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-fail-status-"));
  const definition = parseRuneflow(`---
name: test-fail-status
description: Fails by design
inputs: {}
outputs: {}
---
\`\`\`runeflow
step fail_step type=fail { message: "error" }
\`\`\`
`);

  const fixture = {
    expect: {
      status: "success"
    }
  };

  const result = await runTest(definition, fixture, { runsDir });

  assert.equal(result.pass, false);
  assert.equal(result.failures[0].path, "status");
  assert.equal(result.failures[0].expected, "success");
  assert.equal(result.failures[0].actual, "halted_on_error");
});

test("runTest fails when output mismatch", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-fail-output-"));
  const definition = parseRuneflow(`---
name: test-fail-output
description: Output mismatch
inputs: {}
outputs:
  val: number
---
\`\`\`runeflow
step calc type=transform {
  input: 1
  expr: "({ val: input + 1 })"
  out: { val: number }
}
output { val: steps.calc.val }
\`\`\`
`);

  const fixture = {
    expect: {
      outputs: { val: 3 }
    }
  };

  const result = await runTest(definition, fixture, { runsDir });

  assert.equal(result.pass, false);
  assert.equal(result.failures[0].path, "outputs.val");
  assert.equal(result.failures[0].expected, 3);
  assert.equal(result.failures[0].actual, 2);
});

test("runTest failures include missing steps", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-missing-step-"));
  const definition = parseRuneflow(`---
name: test-missing-step
description: Missing step
inputs: {}
outputs: {}
---
\`\`\`runeflow
step only_step type=tool {
  tool: util.complete
  with: { x: 1 }
  out: { x: number }
}
\`\`\`
`);

  const fixture = {
    mocks: { tools: { "util.complete": (v) => v } },
    expect: {
      steps: {
        other_step: { status: "success" }
      }
    }
  };

  const result = await runTest(definition, fixture, { runsDir });

  assert.equal(result.pass, false);
  assert.ok(result.failures.some(f => f.path === "steps.other_step"));
});

test("runTest supports tool mocks keyed by step id and call assertions", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-step-mock-"));
  const definition = parseRuneflow(`---
name: test-step-tool-mock
description: Tool step id mocks
inputs:
  name: string
outputs:
  greeting: string
llm:
  provider: mock
  model: baseline
---
\`\`\`runeflow
step read_name type=tool {
  tool: file.read
  with: { path: inputs.name }
  out: { content: string }
}

step draft type=llm {
  prompt: "Greet {{ steps.read_name.content }}"
  input: { content: steps.read_name.content }
  schema: { greeting: string }
}

output {
  greeting: steps.draft.greeting
}
\`\`\`
`);

  const fixture = {
    inputs: { name: "Alice" },
    mocks: {
      tools: {
        read_name: { content: "Alice" }
      },
      llm: {
        draft: { greeting: "Hello, Alice!" }
      }
    },
    expect: {
      status: "success",
      outputs: { greeting: "Hello, Alice!" },
      calls: {
        tools: {
          read_name: [{ path: "Alice" }]
        },
        llm: {
          draft: [{
            step: "draft",
            prompt: "Greet Alice",
            input: { content: "Alice" }
          }]
        }
      }
    }
  };

  const result = await runTest(definition, fixture, { runsDir });

  assert.equal(result.pass, true, `Failures: ${JSON.stringify(result.failures)}`);
  assert.deepEqual(result.toolCallsByStep.read_name, [{ path: "Alice" }]);
  assert.deepEqual(result.toolCalls["file.read"], [{ path: "Alice" }]);
});

// ─── Task 3.3: Missing tool mock error includes step id and fixture key path ──

test("runTest throws descriptive error when tool mock is missing (step id + fixture path)", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-missing-tool-mock-"));
  const definition = parseRuneflow(`---
name: test-missing-tool-mock
description: Missing tool mock
inputs: {}
outputs:
  val: string
---
\`\`\`runeflow
step fetch type=tool {
  tool: file.read
  with: { path: "x.txt" }
  out: { val: string }
}
output { val: steps.fetch.val }
\`\`\`
`);

  const fixture = {
    inputs: {},
    mocks: { tools: {}, llm: {} },
    expect: { status: "success" },
  };

  const result = await runTest(definition, fixture, { runsDir });

  // The run should fail — the error message surfaces in the run error or step error
  assert.equal(result.pass, false);
  // The error message is in the run error or the step that failed
  const runErrorMsg = result.run?.error?.message ?? result.failures[0]?.actual?.error ?? "";
  const stepErrorMsg = result.run?.steps?.find((s) => s.status === "failed")?.error?.message ?? "";
  const errorMsg = runErrorMsg || stepErrorMsg;
  assert.match(errorMsg, /fetch/);
  assert.match(errorMsg, /fixture\.mocks\.tools\.fetch/);
});

// ─── Task 3.4: Missing LLM mock error includes step id and fixture key path ───

test("runTest throws descriptive error when llm mock is missing (step id + fixture path)", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-missing-llm-mock-"));
  const definition = parseRuneflow(`---
name: test-missing-llm-mock
description: Missing llm mock
inputs: {}
outputs:
  title: string
llm:
  provider: mock
  model: base
---
\`\`\`runeflow
step draft type=llm {
  prompt: "Write a title"
  schema: { title: string }
}
output { title: steps.draft.title }
\`\`\`
`);

  const fixture = {
    inputs: {},
    mocks: { tools: {}, llm: {} },
    expect: { status: "success" },
  };

  const result = await runTest(definition, fixture, { runsDir });

  assert.equal(result.pass, false);
  const runErrorMsg = result.run?.error?.message ?? result.failures[0]?.actual?.error ?? "";
  const stepErrorMsg = result.run?.steps?.find((s) => s.status === "failed")?.error?.message ?? "";
  const errorMsg = runErrorMsg || stepErrorMsg;
  assert.match(errorMsg, /draft/);
  assert.match(errorMsg, /fixture\.mocks\.llm\.draft/);
});

// ─── Task 3.6: Call assertion failures include step id, expected, and actual ──

test("runTest call assertion failure includes step id, expected inputs, and actual inputs", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-call-assert-"));
  const definition = parseRuneflow(`---
name: test-call-assert
description: Call assertion mismatch
inputs:
  name: string
outputs:
  content: string
---
\`\`\`runeflow
step read type=tool {
  tool: file.read
  with: { path: inputs.name }
  out: { content: string }
}
output { content: steps.read.content }
\`\`\`
`);

  const fixture = {
    inputs: { name: "actual.txt" },
    mocks: {
      tools: { read: { content: "hello" } },
      llm: {},
    },
    expect: {
      status: "success",
      calls: {
        tools: {
          // Expect a different path than what was actually called
          read: [{ path: "expected.txt" }],
        },
      },
    },
  };

  const result = await runTest(definition, fixture, { runsDir });

  assert.equal(result.pass, false);
  // Find the failure for the call assertion
  const callFailure = result.failures.find((f) => f.path.startsWith("calls.tools.read"));
  assert.ok(callFailure, "Should have a failure for calls.tools.read");
  // The path encodes the step id
  assert.match(callFailure.path, /read/);
  // expected and actual are present
  assert.ok(callFailure.expected !== undefined);
  assert.ok(callFailure.actual !== undefined);
});

// ─── Task 4.3: LLM mock entries keyed by step id ─────────────────────────────

test("runTest uses llm mocks keyed by step id (not provider)", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-llm-step-key-"));
  const definition = parseRuneflow(`---
name: test-llm-step-key
description: LLM mock keyed by step id
inputs: {}
outputs:
  title: string
llm:
  provider: mock
  model: base
---
\`\`\`runeflow
step draft type=llm {
  prompt: "Write a title"
  schema: { title: string }
}
output { title: steps.draft.title }
\`\`\`
`);

  const fixture = {
    inputs: {},
    mocks: {
      tools: {},
      llm: {
        draft: { title: "feat: keyed by step id" },
      },
    },
    expect: {
      status: "success",
      outputs: { title: "feat: keyed by step id" },
    },
  };

  const result = await runTest(definition, fixture, { runsDir });
  assert.equal(result.pass, true, `Failures: ${JSON.stringify(result.failures)}`);
  assert.deepEqual(result.run.outputs.title, "feat: keyed by step id");
});

// ─── Task 4.4: loadFixture validates required fields ─────────────────────────

import { loadFixture } from "../src/test-runner.js";

test("loadFixture throws descriptive error when 'inputs' field is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-fixture-validate-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  await fs.writeFile(fixturePath, JSON.stringify({ mocks: {}, expect: {} }));

  await assert.rejects(
    () => loadFixture(fixturePath),
    (err) => {
      assert.match(err.message, /inputs/);
      assert.match(err.message, /missing required field/);
      return true;
    },
  );
});

test("loadFixture throws descriptive error when 'mocks' field is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-fixture-validate-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  await fs.writeFile(fixturePath, JSON.stringify({ inputs: {}, expect: {} }));

  await assert.rejects(
    () => loadFixture(fixturePath),
    (err) => {
      assert.match(err.message, /mocks/);
      assert.match(err.message, /missing required field/);
      return true;
    },
  );
});

test("loadFixture throws descriptive error when 'expect' field is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-fixture-validate-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  await fs.writeFile(fixturePath, JSON.stringify({ inputs: {}, mocks: {} }));

  await assert.rejects(
    () => loadFixture(fixturePath),
    (err) => {
      assert.match(err.message, /expect/);
      assert.match(err.message, /missing required field/);
      return true;
    },
  );
});

test("loadFixture returns parsed fixture when all required fields are present", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-fixture-validate-ok-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  const data = { inputs: { x: 1 }, mocks: { tools: {}, llm: {} }, expect: { status: "success" } };
  await fs.writeFile(fixturePath, JSON.stringify(data));

  const fixture = await loadFixture(fixturePath);
  assert.deepEqual(fixture, data);
});
