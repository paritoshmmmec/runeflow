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
