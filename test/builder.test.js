import test from "node:test";
import assert from "node:assert/strict";
import { buildRuneflow } from "../src/builder.js";

test("buildRuneflow generates markdown using mock llm provider", async () => {
  const mockSkillContent = `---
name: mock-skill
description: Generated mock skill
---
\`\`\`runeflow
step x type=tool { tool: util.complete }
\`\`\`
`.trim();

  const runtime = {
    llms: {
      mock: async ({ prompt }) => {
        assert.ok(prompt.includes("translate the following description"));
        assert.ok(prompt.includes("A very simple skill"));
        return { skill: mockSkillContent };
      }
    }
  };

  const output = await buildRuneflow("A very simple skill", {
    provider: "mock",
    model: "dummy",
    runtime
  });

  assert.equal(output, mockSkillContent);
});

test("buildRuneflow throws if no provider specified", async () => {
  await assert.rejects(
    () => buildRuneflow("test"),
    /A provider is required/
  );
});
