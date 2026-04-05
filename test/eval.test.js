import test from "node:test";
import assert from "node:assert/strict";
import { createTrackedLlmHandlers, estimateLlmInvocationTokens, estimateTokenCount, summarizeLlmRecords } from "../eval/utils.js";

test("estimateTokenCount returns zero for empty input and a positive count otherwise", () => {
  assert.equal(estimateTokenCount(""), 0);
  assert.equal(estimateTokenCount(null), 0);
  assert.ok(estimateTokenCount("abcd") >= 1);
  assert.ok(estimateTokenCount({ ok: true }) >= 1);
});

test("estimateLlmInvocationTokens includes input and output estimates", () => {
  const estimates = estimateLlmInvocationTokens(
    {
      prompt: "Draft a PR",
      docs: "Operator notes",
      input: { branch: "feature/demo" },
      schema: { title: "string" },
      context: { metadata: { name: "demo" } },
    },
    { title: "Demo", body: "Body" },
  );

  assert.ok(estimates.estimatedInputTokens > 0);
  assert.ok(estimates.estimatedOutputTokens > 0);
  assert.equal(
    estimates.estimatedTotalTokens,
    estimates.estimatedInputTokens + estimates.estimatedOutputTokens,
  );
});

test("createTrackedLlmHandlers records invocation summaries", async () => {
  const records = [];
  const tracked = createTrackedLlmHandlers(
    {
      mock: async () => ({ title: "Demo" }),
    },
    records,
  );

  const result = await tracked.mock({
    llm: { model: "test-model" },
    prompt: "hello",
    input: { ok: true },
    docs: "docs",
    schema: { title: "string" },
    context: { metadata: { name: "demo" } },
  });

  assert.deepEqual(result, { title: "Demo" });
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, "mock");
  assert.equal(records[0].model, "test-model");

  const summary = summarizeLlmRecords(records);
  assert.equal(summary.llmCalls, 1);
  assert.ok(summary.estimatedTotalTokens > 0);
});
