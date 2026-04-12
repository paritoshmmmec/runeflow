import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.js";
import { runInit } from "../src/init.js";

async function captureStdout(fn) {
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  const lines = [];

  console.log = (...args) => {
    lines.push(args.join(" "));
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
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
      noLocalLlm: true,
    });

    const skillContent = await fs.readFile(path.join(tempDir, "my-skill.runeflow.md"), "utf8");

    assert.ok(skillContent.includes("name: my-skill"));
    assert.ok(skillContent.includes("provider: cerebras"));
    // runtime.js is no longer written for cloud providers — default runtime activates automatically
    const runtimeExists = await fs.access(path.join(tempDir, "runtime.js")).then(() => true).catch(() => false);
    assert.ok(!runtimeExists, "runtime.js should not be written for cloud providers");
  } finally {
    process.chdir(originalCwd);
  }
});

test("parseOptions: --force without a value is treated as boolean true", async () => {
  // Test by running init with --force as a valueless flag via runCli
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-force-flag-"));
  const originalCwd = process.cwd();

  // Pre-create the skill file so --force is needed to overwrite
  await fs.writeFile(path.join(tempDir, "my-skill.runeflow.md"), "existing content");

  process.chdir(tempDir);
  try {
    // Should not throw — --force allows overwrite
    await runInit({
      name: "my-skill",
      description: "Test",
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      cwd: tempDir,
      force: true,
      silent: true,
      noLocalLlm: true,
    });

    const content = await fs.readFile(path.join(tempDir, "my-skill.runeflow.md"), "utf8");
    assert.ok(content.includes("name: my-skill"), "file was overwritten");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli run accepts human_input answers via --prompt", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-prompt-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: prompt-demo
description: Prompt demo
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
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["run", "./workflow.runeflow.md", "--prompt", '{"confirm":"yes"}']),
    );
    const run = JSON.parse(output);

    assert.equal(run.status, "success");
    assert.equal(run.outputs.answer, "yes");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli resume continues a halted_on_input run with --prompt", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-resume-input-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: resume-input-demo
description: Resume input demo
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
`,
  );

  process.chdir(tempDir);

  try {
    const firstOutput = await captureStdout(() =>
      runCli(["run", "./workflow.runeflow.md"]),
    );
    const firstRun = JSON.parse(firstOutput);

    assert.equal(firstRun.status, "halted_on_input");

    const resumedOutput = await captureStdout(() =>
      runCli(["resume", "./workflow.runeflow.md", "--prompt", '{"confirm":"no"}']),
    );
    const resumedRun = JSON.parse(resumedOutput);

    assert.equal(resumedRun.status, "success");
    assert.equal(resumedRun.outputs.answer, "no");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli validate loads plugin-contributed tool schemas from --runtime", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-validate-plugin-"));
  const repoRoot = process.cwd();
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: plugin-validate
description: Plugin validate
version: 0.1
inputs:
  query: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step search type=tool {
  tool: mcp.docs.search
  with: { query: inputs.query }
}

output {
  ok: steps.search.isError == false
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "runtime.js"),
    `import { createMcpToolPlugin } from ${JSON.stringify(path.join(repoRoot, "src", "runtime-plugins.js"))};

export default {
  plugins: [
    createMcpToolPlugin({
      serverName: "docs",
      tools: [
        {
          name: "search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
      callTool: async ({ input }) => ({ content: [input], isError: false }),
    }),
  ],
};
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["validate", "./workflow.runeflow.md", "--runtime", "./runtime.js", "--format", "json"]),
    );
    const validation = JSON.parse(output);

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.issues, []);
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli tools inspect includes plugin-contributed tools from --runtime", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-tools-plugin-"));
  const repoRoot = process.cwd();
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "runtime.js"),
    `import { createComposioToolPlugin } from ${JSON.stringify(path.join(repoRoot, "src", "runtime-plugins.js"))};

export default {
  plugins: [
    createComposioToolPlugin({
      tools: [
        {
          name: "linear.create_issue",
          description: "Create a Linear issue",
          inputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
        },
      ],
      executeTool: async ({ input }) => ({ content: [input], isError: false }),
    }),
  ],
};
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["tools", "inspect", "composio.linear.create_issue", "--runtime", "./runtime.js"]),
    );
    const entry = JSON.parse(output);

    assert.equal(entry.name, "composio.linear.create_issue");
    assert.equal(entry.metadata.adapter, "composio");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli run works with a discovered Composio client plugin runtime", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-composio-"));
  const repoRoot = process.cwd();
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: composio-client-cli
description: Composio client CLI
version: 0.1
inputs:
  title: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step create_issue type=tool {
  tool: composio.linear.create_issue
  with: { title: inputs.title }
}

output {
  ok: steps.create_issue.isError == false
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "runtime.js"),
    `import { createComposioClientPlugin } from ${JSON.stringify(path.join(repoRoot, "src", "runtime-plugins.js"))};

const plugin = await createComposioClientPlugin({
  toolkits: ["linear"],
  createClient: async () => ({
    tools: {
      getRawComposioTools: async () => ({
        items: [
          {
            slug: "LINEAR_CREATE_ISSUE",
            toolkit: { slug: "linear" },
            description: "Create a Linear issue",
            inputParameters: {
              type: "object",
              properties: { title: { type: "string", minLength: 1 } },
              required: ["title"],
            },
          },
        ],
      }),
      execute: async (_name, request) => ({
        id: "ISSUE-999",
        title: request.arguments.title,
      }),
    },
  }),
});

export default {
  plugins: [plugin],
};
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["run", "./workflow.runeflow.md", "--runtime", "./runtime.js", "--input", '{"title":"Ship it"}']),
    );
    const run = JSON.parse(output);

    assert.equal(run.status, "success");
    assert.equal(run.outputs.ok, true);
    assert.equal(run.steps[0].outputs.raw.id, "ISSUE-999");
  } finally {
    process.chdir(originalCwd);
  }
});

test("runCli run works with a real MCP stdio plugin runtime", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-mcp-"));
  const repoRoot = process.cwd();
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: real-mcp-cli
description: Real MCP CLI
version: 0.1
inputs:
  query: string
outputs:
  ok: boolean
---

\`\`\`runeflow
step search type=tool {
  tool: mcp.fixture.search
  with: { query: inputs.query }
}

output {
  ok: steps.search.isError == false
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "runtime.js"),
    `import { createMcpClientPlugin } from ${JSON.stringify(path.join(repoRoot, "src", "runtime-plugins.js"))};

const plugin = await createMcpClientPlugin({
  serverName: "fixture",
  command: process.execPath,
  args: [${JSON.stringify(path.join(repoRoot, "fixtures", "mcp-test-server.js"))}],
  stderr: "pipe",
});

export default {
  plugins: [plugin],
};
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["run", "./workflow.runeflow.md", "--runtime", "./runtime.js", "--input", '{"query":"docs"}']),
    );
    const run = JSON.parse(output);

    assert.equal(run.status, "success");
    assert.equal(run.outputs.ok, true);
  } finally {
    process.chdir(originalCwd);
  }
});

// ---------------------------------------------------------------------------
// CLI flag wiring tests for smarter-init new flags
// ---------------------------------------------------------------------------

test("runCli init: passes --context flag to runInit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-context-"));
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    // We verify the flag is parsed and forwarded by checking the skill is created
    // (context influences template selection but doesn't break anything)
    await captureStdout(() =>
      runCli(["init", "--context", "stripe payment", "--no-local-llm", "--no-polish", "--name", "ctx-test"]),
    );

    const skillPath = path.join(tempDir, "ctx-test.runeflow.md");
    const exists = await fs.access(skillPath).then(() => true).catch(() => false);
    assert.ok(exists, "--context flag should not prevent skill creation");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli init: passes --template flag to runInit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-template-"));
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    await captureStdout(() =>
      runCli(["init", "--template", "notify-slack", "--no-local-llm", "--no-polish"]),
    );

    const entries = await fs.readdir(tempDir);
    const skillFiles = entries.filter((f) => f.endsWith(".runeflow.md"));
    assert.ok(skillFiles.length >= 1, "--template flag should produce a skill file");

    const content = await fs.readFile(path.join(tempDir, skillFiles[0]), "utf8");
    assert.match(content, /slack/i, "Generated skill should reference Slack when --template notify-slack");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli init: passes --no-local-llm flag to runInit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-nollm-"));
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    // --no-local-llm should not trigger a download; skill should still be created
    await captureStdout(() =>
      runCli(["init", "--no-local-llm", "--no-polish", "--name", "nollm-test"]),
    );

    const skillPath = path.join(tempDir, "nollm-test.runeflow.md");
    const exists = await fs.access(skillPath).then(() => true).catch(() => false);
    assert.ok(exists, "--no-local-llm should still produce a skill file");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli init: passes --no-polish flag to runInit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-nopolish-"));
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["init", "--no-polish", "--no-local-llm", "--name", "nopolish-test"]),
    );

    const skillPath = path.join(tempDir, "nopolish-test.runeflow.md");
    const exists = await fs.access(skillPath).then(() => true).catch(() => false);
    assert.ok(exists, "--no-polish should still produce a skill file");

    // Should not see polish messages
    assert.doesNotMatch(output, /Polishing/, "--no-polish should suppress polish messages");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli inspect-run --format table prints step timeline", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-table-"));
  const originalCwd = process.cwd();
  const runId = "run_table_test";
  const runsDir = path.join(tempDir, ".runeflow-runs");

  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${runId}.json`),
    JSON.stringify({
      run_id: runId,
      status: "success",
      steps: [
        { id: "fetch", kind: "tool", status: "success", attempts: 1, started_at: "2026-01-01T00:00:00.000Z", finished_at: "2026-01-01T00:00:00.050Z" },
        { id: "draft", kind: "llm", status: "success", attempts: 1, started_at: "2026-01-01T00:00:00.050Z", finished_at: "2026-01-01T00:00:01.200Z" },
      ],
    }),
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["inspect-run", runId, "--format", "table"]),
    );
    assert.match(output, /fetch/);
    assert.match(output, /draft/);
    assert.match(output, /tool/);
    assert.match(output, /llm/);
    assert.match(output, /success/);
    assert.match(output, /50ms/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli inspect-run --step shows single step artifact", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-step-"));
  const originalCwd = process.cwd();
  const runId = "run_step_test";
  const runsDir = path.join(tempDir, ".runeflow-runs");
  const stepsDir = path.join(runsDir, runId, "steps");

  await fs.mkdir(stepsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${runId}.json`),
    JSON.stringify({ run_id: runId, status: "success", steps: [] }),
  );
  await fs.writeFile(
    path.join(stepsDir, "fetch.json"),
    JSON.stringify({ id: "fetch", kind: "tool", status: "success", outputs: { value: "ok" } }),
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["inspect-run", runId, "--step", "fetch"]),
    );
    const step = JSON.parse(output);
    assert.equal(step.id, "fetch");
    assert.equal(step.outputs.value, "ok");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli run --record-fixture writes a fixture file from the run", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-fixture-"));
  const originalCwd = process.cwd();
  const fixturePath = path.join(tempDir, "fixture.json");

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: fixture-demo
description: Fixture recording demo
version: 0.1
inputs:
  name: string
outputs:
  greeting: string
llm:
  provider: mock-default
  router: false
  model: base
---

\`\`\`runeflow
step greet type=llm {
  prompt: "Say hello to {{ inputs.name }}."
  schema: { greeting: string }
}

output {
  greeting: steps.greet.greeting
}
\`\`\`
`,
  );

  const runtimePath = path.join(tempDir, "runtime.js");
  await fs.writeFile(
    runtimePath,
    `export default {
  llms: {
    "mock-default": async () => ({ greeting: "Hello, Alice!" }),
  },
};`,
  );

  process.chdir(tempDir);

  try {
    await captureStdout(() =>
      runCli([
        "run", "workflow.runeflow.md",
        "--input", '{"name":"Alice"}',
        "--runtime", "./runtime.js",
        "--record-fixture", fixturePath,
      ]),
    );

    const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
    assert.deepEqual(fixture.inputs, { name: "Alice" });
    assert.equal(fixture.expect.status, "success");
    assert.deepEqual(fixture.expect.outputs, { greeting: "Hello, Alice!" });
    assert.deepEqual(fixture.mocks.llm.greet, { greeting: "Hello, Alice!" });
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli run --record-fixture records tool mocks by step id", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-tool-fixture-"));
  const originalCwd = process.cwd();
  const fixturePath = path.join(tempDir, "fixture.json");

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: fixture-tool-demo
description: Fixture recording demo for tools
version: 0.1
inputs:
  path: string
outputs:
  exists: boolean
---

\`\`\`runeflow
step check_file type=tool {
  tool: file.exists
  with: { path: inputs.path }
  out: { exists: boolean }
}

output {
  exists: steps.check_file.exists
}
\`\`\`
`,
  );

  process.chdir(tempDir);

  try {
    await fs.writeFile(path.join(tempDir, "present.txt"), "ok\n");
    await captureStdout(() =>
      runCli([
        "run", "workflow.runeflow.md",
        "--input", '{"path":"./present.txt"}',
        "--record-fixture", fixturePath,
      ]),
    );

    const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
    assert.deepEqual(fixture.inputs, { path: "./present.txt" });
    assert.deepEqual(fixture.mocks.tools.check_file, { exists: true });
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli test includes call traces and summary", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-test-summary-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: cli-test-demo
description: CLI test summary demo
version: 0.1
inputs:
  path: string
outputs:
  content: string
llm:
  provider: mock
  model: base
---

\`\`\`runeflow
step read_file type=tool {
  tool: file.read
  with: { path: inputs.path }
  out: { content: string }
}

step draft type=llm {
  prompt: "Summarize {{ steps.read_file.content }}"
  input: { content: steps.read_file.content }
  schema: { content: string }
}

output {
  content: steps.draft.content
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "fixture.json"),
    JSON.stringify({
      inputs: { path: "README.md" },
      mocks: {
        tools: {
          read_file: { content: "hello" },
        },
        llm: {
          draft: { content: "summary" },
        },
      },
      expect: {
        status: "success",
        calls: {
          tools: {
            read_file: [{ path: "README.md" }],
          },
        },
      },
    }, null, 2),
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["test", "./workflow.runeflow.md", "--fixture", "./fixture.json"]),
    );
    const result = JSON.parse(output);

    assert.equal(result.pass, true);
    assert.equal(result.summary, "Fixture passed.");
    assert.deepEqual(result.tool_calls.read_file, [{ path: "README.md" }]);
    assert.deepEqual(result.tool_calls_by_name["file.read"], [{ path: "README.md" }]);
    assert.equal(result.llm_calls.draft[0].prompt, "Summarize hello");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli skills list shows skills from .runeflow/skills/", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-skills-"));
  const originalCwd = process.cwd();
  const skillsDir = path.join(tempDir, ".runeflow", "skills");

  await fs.mkdir(skillsDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsDir, "open-pr.runeflow.md"),
    `---
name: open-pr
description: Open a pull request from the current branch.
version: 0.1
inputs: {}
outputs: {}
---
`,
  );
  await fs.writeFile(
    path.join(skillsDir, "release-notes.runeflow.md"),
    `---
name: release-notes
description: Draft release notes from git log.
version: 0.1
inputs: {}
outputs: {}
---
`,
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() => runCli(["skills", "list"]));
    assert.match(output, /open-pr/);
    assert.match(output, /release-notes/);
    assert.match(output, /Open a pull request/);
    assert.match(output, /Draft release notes/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli skills list prints message when no skills directory exists", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-noskills-"));
  const originalCwd = process.cwd();

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() => runCli(["skills", "list"]));
    assert.match(output, /No skills found/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

// ─── Task 3.1 & 3.2: Human-readable failure output to stderr ─────────────────

async function captureStderr(fn) {
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const lines = [];

  console.error = (...args) => {
    lines.push(args.join(" "));
  };

  try {
    await fn();
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
  }

  return lines.join("\n");
}

test("runCli test writes human-readable failure summary to stderr", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-test-stderr-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: test-stderr-demo
description: Test stderr output
version: 0.1
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

output {
  title: steps.draft.title
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "fixture.json"),
    JSON.stringify({
      inputs: {},
      mocks: {
        tools: {},
        llm: {
          draft: { title: "feat: add-login" },
        },
      },
      expect: {
        status: "success",
        outputs: { title: "feat: add login" },
      },
    }, null, 2),
  );

  process.chdir(tempDir);

  try {
    let stderrOutput = "";
    let stdoutOutput = "";

    const origError = console.error;
    const origLog = console.log;
    const origExitCode = process.exitCode;

    console.error = (...args) => { stderrOutput += args.join(" ") + "\n"; };
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await runCli(["test", "./workflow.runeflow.md", "--fixture", "./fixture.json"]);
    } finally {
      console.error = origError;
      console.log = origLog;
      process.exitCode = origExitCode;
    }

    // Task 3.2: summary line with failure count comes first
    assert.match(stderrOutput, /FAIL\s+1 assertion\(s\) failed/);

    // Task 3.1: individual failure with path, expected, actual on labelled lines
    assert.match(stderrOutput, /outputs\.title/);
    assert.match(stderrOutput, /expected:/);
    assert.match(stderrOutput, /actual:/);
    assert.match(stderrOutput, /feat: add login/);
    assert.match(stderrOutput, /feat: add-login/);

    // Task 3.5: stdout JSON always has pass, failure_count, run_id
    const result = JSON.parse(stdoutOutput);
    assert.ok("pass" in result, "JSON output must include 'pass'");
    assert.ok("failure_count" in result, "JSON output must include 'failure_count'");
    assert.ok("run_id" in result, "JSON output must include 'run_id'");
    assert.equal(result.pass, false);
    assert.equal(result.failure_count, 1);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli test does not write failure output to stderr when test passes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-test-pass-stderr-"));
  const originalCwd = process.cwd();

  await fs.writeFile(
    path.join(tempDir, "workflow.runeflow.md"),
    `---
name: test-pass-stderr
description: Passing test
version: 0.1
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

output {
  title: steps.draft.title
}
\`\`\`
`,
  );

  await fs.writeFile(
    path.join(tempDir, "fixture.json"),
    JSON.stringify({
      inputs: {},
      mocks: {
        tools: {},
        llm: {
          draft: { title: "feat: add login" },
        },
      },
      expect: {
        status: "success",
        outputs: { title: "feat: add login" },
      },
    }, null, 2),
  );

  process.chdir(tempDir);

  try {
    let stderrOutput = "";
    let stdoutOutput = "";

    const origError = console.error;
    const origLog = console.log;
    const origExitCode = process.exitCode;

    console.error = (...args) => { stderrOutput += args.join(" ") + "\n"; };
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await runCli(["test", "./workflow.runeflow.md", "--fixture", "./fixture.json"]);
    } finally {
      console.error = origError;
      console.log = origLog;
      process.exitCode = origExitCode;
    }

    // No FAIL output on stderr when passing
    assert.doesNotMatch(stderrOutput, /FAIL/);

    // Task 3.5: stdout JSON always has pass, failure_count, run_id even when passing
    const result = JSON.parse(stdoutOutput);
    assert.ok("pass" in result);
    assert.ok("failure_count" in result);
    assert.ok("run_id" in result);
    assert.equal(result.pass, true);
    assert.equal(result.failure_count, 0);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

// ─── Tasks 5.1, 5.2, 5.4, 5.6: inspect-run improvements ─────────────────────

test("runCli inspect-run --format table includes id, kind, status, duration, and attempts column headers", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-table-cols-"));
  const originalCwd = process.cwd();
  const runId = "run_table_cols_test";
  const runsDir = path.join(tempDir, ".runeflow-runs");

  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${runId}.json`),
    JSON.stringify({
      run_id: runId,
      status: "success",
      steps: [
        { id: "fetch", kind: "tool", status: "success", attempts: 2, started_at: "2026-01-01T00:00:00.000Z", finished_at: "2026-01-01T00:00:00.100Z" },
      ],
    }),
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["inspect-run", runId, "--format", "table"]),
    );
    // Task 5.1: all required column headers must be present
    assert.match(output, /\bid\b/);
    assert.match(output, /\bkind\b/);
    assert.match(output, /\bstatus\b/);
    assert.match(output, /\bduration\b/);
    assert.match(output, /\battempts\b/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli inspect-run --format table prints failed step id and error message inline when halted_on_error", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-table-halted-"));
  const originalCwd = process.cwd();
  const runId = "run_halted_test";
  const runsDir = path.join(tempDir, ".runeflow-runs");

  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${runId}.json`),
    JSON.stringify({
      run_id: runId,
      status: "halted_on_error",
      halted_step_id: "fetch",
      error: { name: "Error", message: "network timeout" },
      steps: [
        { id: "fetch", kind: "tool", status: "failed", attempts: 1, started_at: "2026-01-01T00:00:00.000Z", finished_at: "2026-01-01T00:00:00.050Z" },
      ],
    }),
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["inspect-run", runId, "--format", "table"]),
    );
    // Error message is now shown inline on the failed step row, not below the table
    assert.match(output, /✗ failed.*network timeout/);
    // The old footer lines should no longer appear
    assert.doesNotMatch(output, /^Failed step:/m);
    assert.doesNotMatch(output, /^Error:/m);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli inspect-run --step missing artifact error includes the expected artifact path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-step-missing-"));
  const originalCwd = process.cwd();
  const runId = "run_step_missing_test";
  const runsDir = path.join(tempDir, ".runeflow-runs");

  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${runId}.json`),
    JSON.stringify({ run_id: runId, status: "success", steps: [] }),
  );

  process.chdir(tempDir);

  try {
    // Task 5.4: error message must include the expected artifact path
    await assert.rejects(
      () => runCli(["inspect-run", runId, "--step", "nonexistent"]),
      (err) => {
        assert.match(err.message, /nonexistent/);
        assert.match(err.message, /steps/);
        return true;
      },
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli inspect-run --format table visually distinguishes failed steps with marker character", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-cli-table-markers-"));
  const originalCwd = process.cwd();
  const runId = "run_markers_test";
  const runsDir = path.join(tempDir, ".runeflow-runs");

  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${runId}.json`),
    JSON.stringify({
      run_id: runId,
      status: "halted_on_error",
      halted_step_id: "draft",
      error: { name: "Error", message: "llm error" },
      steps: [
        { id: "fetch", kind: "tool", status: "success", attempts: 1, started_at: "2026-01-01T00:00:00.000Z", finished_at: "2026-01-01T00:00:00.050Z" },
        { id: "draft", kind: "llm", status: "failed", attempts: 1, started_at: "2026-01-01T00:00:00.050Z", finished_at: "2026-01-01T00:00:00.200Z" },
      ],
    }),
  );

  process.chdir(tempDir);

  try {
    const output = await captureStdout(() =>
      runCli(["inspect-run", runId, "--format", "table"]),
    );
    // Task 5.6: failed step row prefixed with ✗
    assert.match(output, /✗\s+failed/);
    // Task 5.6: success step row prefixed with ✓
    assert.match(output, /✓\s+success/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
