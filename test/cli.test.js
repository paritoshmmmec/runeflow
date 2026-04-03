import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.js";

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
