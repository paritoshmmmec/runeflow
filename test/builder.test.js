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

test("buildRuneflow preserves double-brace syntax in the prompt example and user description", async () => {
  const description = "Build a skill that copies {{ inputs.path }} into {{ steps.read.content }}.";
  const runtime = {
    llms: {
      mock: async ({ prompt }) => {
        assert.ok(prompt.includes('{{ steps.read.content }}'));
        assert.ok(prompt.includes("Use the double-brace syntax for referencing step outputs, e.g., {{ steps.id.field }}."));
        assert.ok(prompt.includes(`Description: ${description}`));
        assert.ok(!prompt.includes("{ { steps.read.content }}"));
        return { skill: "---\nname: ok\n---\n```runeflow\n```" };
      }
    }
  };

  await buildRuneflow(description, {
    provider: "mock",
    model: "dummy",
    runtime
  });
});

test("buildRuneflow throws if no provider specified", async () => {
  await assert.rejects(
    () => buildRuneflow("test"),
    /A provider is required/
  );
});
