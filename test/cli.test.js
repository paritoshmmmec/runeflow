import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.js";
import { runInit } from "../src/init.js";

async function captureStdout(fn) {
  const originalLog = console.log;
  const lines = [];

  console.log = (...args) => {
    lines.push(args.join(" "));
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
  }

  return lines.join("\n");
}

test("runCli inspect-run reads artifacts from the default runeflow runs directory", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: cli-demo
description: CLI demo
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step finish type=tool {
  tool: mock.finish
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "runtime.js"),
    `export const tools = {
  "mock.finish": async () => ({ result: "ok" }),
};
`,
  );

  process.chdir(tempDir);

  try {
    const runOutput = await captureStdout(() =>
      runCli(["run", "./workflow.runeflow.md", "--runtime", "./runtime.js"]),
    );
    const run = JSON.parse(runOutput);

    assert.match(run.artifact_path, /\.runeflow-runs\/.+\.json$/);

    const inspectOutput = await captureStdout(() => runCli(["inspect-run", run.run_id]));
    const inspectedRun = JSON.parse(inspectOutput);

    assert.equal(inspectedRun.run_id, run.run_id);
    assert.equal(inspectedRun.outputs.result, "ok");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli inspect-run falls back to legacy skill runs when no runeflow artifact exists", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-legacy-"));
  const originalCwd = process.cwd();
  const runId = "run_legacy_demo";
  const legacyRunsDir = path.join(tempDir, ".skill-runs");

  await fs.mkdir(legacyRunsDir, { recursive: true });
  await fs.writeFile(
    path.join(legacyRunsDir, `${runId}.json`),
    JSON.stringify({
      run_id: runId,
      status: "success",
      outputs: { result: "legacy-ok" },
    }),
  );

  process.chdir(tempDir);

  try {
    const inspectOutput = await captureStdout(() => runCli(["inspect-run", runId]));
    const inspectedRun = JSON.parse(inspectOutput);

    assert.equal(inspectedRun.run_id, runId);
    assert.equal(inspectedRun.outputs.result, "legacy-ok");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli run uses built-in tools without a custom runtime module", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-builtins-"));
  const originalCwd = process.cwd();

  await fs.writeFile(path.join(tempDir, "present.txt"), "ready\n");
  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: builtin-demo
description: Built-in tool demo
version: 0.1
inputs: {}
outputs:
  exists: boolean
---

\`\`\`runeflow
step check type=tool {
  tool: file.exists
  with: { path: "./present.txt" }
  out: { exists: boolean }
}

output {
  exists: steps.check.exists
}
\`\`\`
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() => runCli(["run", "./workflow.runeflow.md"]));
    const run = JSON.parse(output);

    assert.equal(run.status, "success");
    assert.equal(run.outputs.exists, true);
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli resume: retries from halted step, replaying prior successful steps from cache", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-resume-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: resume-demo
description: Resume demo
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
  with: { value: steps.first.value }
  out: { result: string }
}

output {
  result: steps.second.result
}
\`\`\`
`,
  );

  // Runtime that fails on first attempt of second step, succeeds on second
  let secondCallCount = 0;
  await fs.writeFile(
    path.join(tempDir, "runtime.js"),
    `export const tools = {
  "mock.first": async () => ({ value: "step-one-done" }),
  "mock.second": async ({ value }) => {
    // Always succeed in this runtime (simulates fixed service)
    return { result: "resumed:" + value };
  },
};
`,
  );

  process.chdir(tempDir);

  try {
    // Manually create a halted run artifact to simulate a prior failed run
    const runsDir = path.join(tempDir, ".runeflow-runs");
    await fs.mkdir(runsDir, { recursive: true });
    const stepsDir = path.join(runsDir, "run_20260101000000_aaaaaa", "steps");
    await fs.mkdir(stepsDir, { recursive: true });

    const firstStepArtifact = {
      id: "first",
      kind: "tool",
      status: "success",
      attempts: 1,
      inputs: {},
      outputs: { value: "step-one-done" },
      error: null,
      input_hash: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    };
    const firstStepPath = path.join(stepsDir, "first.json");
    await fs.writeFile(firstStepPath, JSON.stringify(firstStepArtifact));
    firstStepArtifact.artifact_path = firstStepPath;

    const secondStepArtifact = {
      id: "second",
      kind: "tool",
      status: "failed",
      attempts: 1,
      inputs: { value: "step-one-done" },
      outputs: null,
      error: { name: "Error", message: "network timeout", stack: null },
    };
    const secondStepPath = path.join(stepsDir, "second.json");
    await fs.writeFile(secondStepPath, JSON.stringify(secondStepArtifact));
    secondStepArtifact.artifact_path = secondStepPath;

    const haltedRun = {
      run_id: "run_20260101000000_aaaaaa",
      runeflow: { name: "resume-demo", version: "0.1" },
      status: "halted_on_error",
      halted_step_id: "second",
      inputs: {},
      steps: [firstStepArtifact, secondStepArtifact],
      outputs: {},
      error: { name: "Error", message: "network timeout", stack: null },
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(runsDir, "run_20260101000000_aaaaaa.json"),
      JSON.stringify(haltedRun),
    );

    const output = await captureStdout(() =>
      runCli(["resume", "./workflow.runeflow.md", "--runtime", "./runtime.js"]),
    );
    const run = JSON.parse(output);

    assert.equal(run.status, "success");
    assert.equal(run.steps.length, 2);
    // first step was replayed from cache (input_hash matched)
    assert.equal(run.steps[0].id, "first");
    assert.equal(run.steps[0].cached, true);
    // second step was re-executed
    assert.equal(run.steps[1].id, "second");
    assert.equal(run.steps[1].cached, undefined);
    assert.equal(run.outputs.result, "resumed:step-one-done");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli init: creates skill file and runtime.js non-interactively", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-init-"));
  const originalCwd = process.cwd();

  process.chdir(tempDir);

  try {
    await runInit({
      name: "my-skill",
      description: "Test skill",
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      cwd: tempDir,
      silent: true,
    });

    const skillContent = await fs.readFile(path.join(tempDir, "my-skill.runeflow.md"), "utf8");
    const runtimeContent = await fs.readFile(path.join(tempDir, "runtime.js"), "utf8");

    assert.ok(skillContent.includes("name: my-skill"));
    assert.ok(skillContent.includes("provider: cerebras"));
    assert.ok(skillContent.includes("Test skill"));
    assert.ok(runtimeContent.includes("createDefaultRuntime"));
    assert.ok(runtimeContent.includes("CEREBRAS_API_KEY"));
  } finally {
    process.chdir(originalCwd);
  }
});
