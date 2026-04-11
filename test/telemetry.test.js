import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createTelemetryEmitter } from "../src/telemetry.js";

test("createTelemetryEmitter writes OTLP JSON spans to a file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-telemetry-"));
  const outputPath = path.join(tmpDir, "spans.jsonl");

  const emitter = createTelemetryEmitter({ output: outputPath });

  emitter.emitStep({
    runId: "run_test_123",
    step: { id: "fetch", kind: "tool", tool: "git.current_branch" },
    stepRun: {
      id: "fetch",
      kind: "tool",
      status: "success",
      attempts: 1,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:00.050Z",
    },
  });

  emitter.emitStep({
    runId: "run_test_123",
    step: { id: "draft", kind: "llm" },
    stepRun: {
      id: "draft",
      kind: "llm",
      status: "success",
      attempts: 1,
      started_at: "2026-01-01T00:00:00.050Z",
      finished_at: "2026-01-01T00:00:01.200Z",
      token_usage: { prompt_tokens: 120, completion_tokens: 45 },
    },
  });

  await emitter.flush();

  const lines = (await fs.readFile(outputPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);

  const span1 = JSON.parse(lines[0]);
  const spans1 = span1.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans1[0].name, "runeflow.step.fetch");
  assert.equal(spans1[0].status.code, 1); // OK
  assert.ok(spans1[0].attributes.some((a) => a.key === "runeflow.step.tool" && a.value.stringValue === "git.current_branch"));

  const span2 = JSON.parse(lines[1]);
  const spans2 = span2.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans2[0].name, "runeflow.step.draft");
  assert.ok(spans2[0].attributes.some((a) => a.key === "llm.usage.prompt_tokens" && a.value.intValue === 120));
  assert.ok(spans2[0].attributes.some((a) => a.key === "llm.usage.completion_tokens" && a.value.intValue === 45));

  // All spans share the same traceId
  assert.equal(spans1[0].traceId, spans2[0].traceId);
  assert.equal(emitter.traceId, spans1[0].traceId);
});

test("createTelemetryEmitter emits error spans with error.message attribute", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-telemetry-err-"));
  const outputPath = path.join(tmpDir, "spans.jsonl");

  const emitter = createTelemetryEmitter({ output: outputPath });

  emitter.emitStep({
    runId: "run_err_456",
    step: { id: "push", kind: "tool", tool: "git.push_current_branch" },
    stepRun: {
      id: "push",
      kind: "tool",
      status: "failed",
      attempts: 3,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:02.000Z",
      error: { message: "remote rejected" },
    },
  });

  await emitter.flush();

  const line = (await fs.readFile(outputPath, "utf8")).trim();
  const envelope = JSON.parse(line);
  const span = envelope.resourceSpans[0].scopeSpans[0].spans[0];

  assert.equal(span.status.code, 2); // ERROR
  assert.ok(span.attributes.some((a) => a.key === "error.message" && a.value.stringValue === "remote rejected"));
  assert.ok(span.attributes.some((a) => a.key === "runeflow.step.attempts" && a.value.intValue === 3));
});

import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";

test("runRuneflow emits OTLP spans for all steps on success", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-telemetry-run-"));
  const outputPath = path.join(runsDir, "spans.jsonl");

  const parsed = parseRuneflow(`---
name: telemetry-success
description: Telemetry integration test
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step fetch type=tool {
  tool: mock.fetch
  out: { value: string }
}

step process type=tool {
  tool: mock.process
  with: { value: steps.fetch.value }
  out: { value: string }
}

output {
  value: steps.process.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {
    tools: {
      "mock.fetch": async () => ({ value: "raw" }),
      "mock.process": async ({ value }) => ({ value: `${value}:processed` }),
    },
  }, { runsDir, telemetry: true, telemetryOutput: outputPath });

  assert.equal(run.status, "success");

  const lines = (await fs.readFile(outputPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);

  const names = lines.map((l) => JSON.parse(l).resourceSpans[0].scopeSpans[0].spans[0].name);
  assert.deepEqual(names, ["runeflow.step.fetch", "runeflow.step.process"]);

  // All spans share the same traceId
  const traceIds = lines.map((l) => JSON.parse(l).resourceSpans[0].scopeSpans[0].spans[0].traceId);
  assert.equal(traceIds[0], traceIds[1]);
});

test("runRuneflow emits spans on halted_on_error path", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-telemetry-halt-"));
  const outputPath = path.join(runsDir, "spans.jsonl");

  const parsed = parseRuneflow(`---
name: telemetry-halt
description: Telemetry halt test
version: 0.1
inputs: {}
outputs:
  value: string
---

\`\`\`runeflow
step ok type=tool {
  tool: mock.ok
  out: { value: string }
}

step fail type=tool {
  tool: mock.fail
  out: { value: string }
}

output {
  value: steps.ok.value
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {
    tools: {
      "mock.ok": async () => ({ value: "ok" }),
      "mock.fail": async () => { throw new Error("boom"); },
    },
  }, { runsDir, telemetry: true, telemetryOutput: outputPath });

  assert.equal(run.status, "halted_on_error");

  const lines = (await fs.readFile(outputPath, "utf8")).trim().split("\n");
  // Both steps ran — ok succeeded, fail failed
  assert.equal(lines.length, 2);

  const spans = lines.map((l) => JSON.parse(l).resourceSpans[0].scopeSpans[0].spans[0]);
  assert.equal(spans[0].name, "runeflow.step.ok");
  assert.equal(spans[0].status.code, 1); // OK
  assert.equal(spans[1].name, "runeflow.step.fail");
  assert.equal(spans[1].status.code, 2); // ERROR
});
